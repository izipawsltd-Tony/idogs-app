import { PLUS_PROMOTION_END } from '../../shared/plus-promotion.js'

// Transactional per-account checkout attempt; concurrent requests reuse the
// same timestamp and Stripe idempotency key, including after an ambiguous I/O.
export function promotionSessionStore(db) {
  return {
    getPromotionAttempt: (uid, now, verifiedCustomer = null) => db.runTransaction(async tx => {
      const ref = db.collection('plusPromotionCheckouts').doc(uid)
      const snapshot = await tx.get(db.collection('users').doc(uid))
      const ledger = await tx.get(ref)
      const profile = snapshot.data()
      if (!snapshot.exists || profile.stripeSubscriptionId || (profile.stripeCustomerId || null) !== verifiedCustomer || ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'].includes(profile.subscriptionStatus)) throw new Error('Billing account requires review')
      const previous = ledger.data()
      if (previous && Number.isFinite(previous.createdAt) && previous.expiresAt > now + 31 * 60_000) return previous
      // Do not replace a still-open checkout just because it is close to
      // expiry: that would permit two payable sessions for the same account.
      if (previous?.expiresAt > now) throw new Error('Existing checkout is closing; retry after it expires')
      const attempt = { createdAt: now, expiresAt: Math.min(now + 23 * 60 * 60_000, PLUS_PROMOTION_END - 60_000) }
      tx.set(ref, attempt)
      return attempt
    }),
    savePromotionSession: (uid, attempt, session) => db.runTransaction(async tx => {
      const ref = db.collection('plusPromotionCheckouts').doc(uid)
      const snapshot = await tx.get(ref)
      if (snapshot.data()?.createdAt !== attempt.createdAt) throw new Error('Checkout attempt changed')
      if (!session?.id || !session?.url) throw new Error('Checkout session missing')
      tx.set(ref, { ...attempt, sessionId: session.id, url: session.url })
    }),
  }
}
