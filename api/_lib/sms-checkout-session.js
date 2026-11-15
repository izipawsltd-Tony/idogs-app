import { createHash, randomUUID } from 'node:crypto'

// A durable attempt outlives ambiguous Stripe responses. Never rotate while a
// session can still be paid; subscription enumeration precedes every attempt.
export function smsSessionStore(db) {
  return {
    getSmsAttempt: (uid, profile, origin, priceId, now = Date.now()) => db.runTransaction(async tx => {
      const ref = db.collection('smsAddonCheckouts').doc(uid)
      const [user, ledger] = await Promise.all([tx.get(db.collection('users').doc(uid)), tx.get(ref)])
      const current = user.data()
      if (!user.exists || current.stripeCustomerId !== profile.stripeCustomerId ||
          current.stripeSubscriptionId !== profile.stripeSubscriptionId ||
          !['active', 'trialing'].includes(current.subscriptionStatus)) throw new Error('SMS_BILLING_CHANGED')
      const previous = ledger.data()
      if (previous?.expiresAt > now) {
        if (previous.customerId !== current.stripeCustomerId || previous.baseSubscriptionId !== current.stripeSubscriptionId ||
            previous.origin !== origin || previous.priceId !== priceId || previous.expiresAt < now + 31 * 60_000) throw new Error('SMS_CHECKOUT_PENDING')
        return previous
      }
      const attempt = { id: randomUUID(), customerId: current.stripeCustomerId,
        baseSubscriptionId: current.stripeSubscriptionId, origin, priceId, expiresAt: now + 23 * 60 * 60_000 }
      tx.set(ref, attempt)
      return attempt
    }),
    saveSmsSession: (uid, attempt, session) => db.runTransaction(async tx => {
      const ref = db.collection('smsAddonCheckouts').doc(uid)
      if ((await tx.get(ref)).data()?.id !== attempt.id || !session?.id || !session?.url) throw new Error('SMS_CHECKOUT_CHANGED')
      tx.set(ref, { sessionId: session.id, url: session.url }, { merge: true })
    }),
  }
}

export async function createSeparateSmsCheckout({ uid, profile, priceId, origin, listSubscriptions,
  createSession, getSmsAttempt, saveSmsSession }) {
  const all = await listSubscriptions({ customer: profile.stripeCustomerId, status: 'all', limit: 100 })
  if (!all || all.has_more || !Array.isArray(all.data)) throw new Error('SMS_SUBSCRIPTIONS_UNVERIFIED')
  if (all.data.some(sub => !['canceled', 'incomplete_expired'].includes(sub.status) &&
      sub.items?.data?.some(item => item.price?.id === priceId))) throw new Error('SMS_ALREADY_EXISTS')
  const attempt = await getSmsAttempt(uid, profile, origin, priceId)
  const metadata = { purchaseType: 'sms_addon', userId: uid,
    baseSubscriptionId: profile.stripeSubscriptionId, checkoutAttempt: attempt.id }
  const session = await createSession({
    integration_identifier: `idogs_sms_checkout_${Array.from(createHash('sha256').update(attempt.id).digest().subarray(0, 8), n => String.fromCharCode(97 + n % 26)).join('')}`,
    mode: 'subscription', customer: profile.stripeCustomerId, client_reference_id: uid,
    line_items: [{ price: priceId, quantity: 1 }], automatic_tax: { enabled: true },
    customer_update: { address: 'auto' },
    expires_at: Math.floor(attempt.expiresAt / 1000),
    success_url: `${origin}/app/billing?sms_success=1`, cancel_url: `${origin}/app/billing?sms_cancelled=1`,
    metadata, subscription_data: { metadata },
    custom_text: { submit: { message: 'SMS is A$3/month including GST for 20 credits each billing month. Renews until cancelled. Your Plus promotion is unchanged.' } },
  }, { idempotencyKey: `sms-addon:${uid}:${attempt.id}` })
  await saveSmsSession(uid, attempt, session)
  return session
}
