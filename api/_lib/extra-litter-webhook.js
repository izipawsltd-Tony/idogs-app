import { breederIdentity } from './breeder-profile.js'
import { EXTRA_LITTER_PRICE_CENTS } from './litter-quota.js'

function customerIdOf(value) {
  if (typeof value === 'string') return value
  return value?.id || null
}

export function isExtraLitterCheckoutEvent(event) {
  return event?.type === 'checkout.session.completed' &&
    event?.data?.object?.metadata?.purchaseType === 'extra_litter'
}

// Runs only after Stripe signature verification in api/stripe-webhook.js.
// The credit document id is the immutable Checkout Session id, making this
// idempotent across Stripe retries even though the existing subscription
// webhook core intentionally treats one-time Checkout sessions as a no-op.
export async function grantExtraLitterCreditFromVerifiedEvent({ db, event, now = () => new Date() }) {
  if (!isExtraLitterCheckoutEvent(event)) return { handled: false }

  const session = event.data.object
  const userId = session?.metadata?.userId
  const breederProfileId = session?.metadata?.breederProfileId

  if (
    session.mode !== 'payment' ||
    session.payment_status !== 'paid' ||
    session.currency !== 'aud' ||
    session.amount_total !== EXTRA_LITTER_PRICE_CENTS ||
    typeof userId !== 'string' || !userId ||
    typeof breederProfileId !== 'string' || !/^bp_[a-f0-9]{32}$/.test(breederProfileId) ||
    typeof session.id !== 'string' || !session.id
  ) {
    throw new Error('INVALID_EXTRA_LITTER_CHECKOUT')
  }

  const creditRef = db.collection('litterQuotaCredits').doc(session.id)
  const userRef = db.collection('users').doc(userId)

  const result = await db.runTransaction(async tx => {
    const creditSnap = await tx.get(creditRef)
    const userSnap = await tx.get(userRef)

    if (!userSnap.exists) throw new Error('EXTRA_LITTER_USER_NOT_FOUND')
    const profile = userSnap.data()
    if (profile?.stripeCustomerId && customerIdOf(session.customer) !== profile.stripeCustomerId) {
      throw new Error('EXTRA_LITTER_CUSTOMER_MISMATCH')
    }

    // The server generated this metadata. Re-derive it from the trusted
    // profile as a second integrity check before granting entitlement.
    const expectedProfileId = breederIdentity(profile, { uid: userId, authEmail: profile?.email || '' }).breederProfileId
    if (expectedProfileId !== breederProfileId) {
      throw new Error('EXTRA_LITTER_BREEDER_PROFILE_MISMATCH')
    }

    if (creditSnap.exists) {
      const existing = creditSnap.data()
      if (
        existing.checkoutSessionId !== session.id ||
        existing.purchasedByUid !== userId ||
        existing.breederProfileId !== breederProfileId
      ) {
        throw new Error('EXTRA_LITTER_CREDIT_CONFLICT')
      }
      return { created: false, creditId: creditRef.id }
    }

    tx.set(creditRef, {
      breederProfileId,
      purchasedByUid: userId,
      checkoutSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
      amountAudCents: EXTRA_LITTER_PRICE_CENTS,
      currency: 'aud',
      status: 'available',
      purchasedAt: now().toISOString(),
      consumedByLitterId: null,
      consumedAt: null,
      stripeEventId: event.id,
    })
    return { created: true, creditId: creditRef.id }
  })

  return { handled: true, ...result }
}
