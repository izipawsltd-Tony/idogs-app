// api/_lib/founding-webhook.js — grants 15 months of Plus after a verified,
// fully-paid Founding Member Checkout. Runs only after Stripe signature
// verification in api/stripe-webhook.js. Idempotent: the purchase document
// id is the immutable Checkout Session id.
import { FOUNDING_OFFER } from '../../shared/access-grants.js'
import { ACCESS_GRANT_COUNTERS, FOUNDING_PURCHASES, buildAccessGrant, counterCount } from './access-grant-store.js'

export function isFoundingCheckoutEvent(event) {
  return ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event?.type) &&
    event?.data?.object?.metadata?.purchaseType === 'founding_member'
}

export async function grantFoundingFromVerifiedEvent({ db, event, now = () => Date.now(), offer = FOUNDING_OFFER }) {
  if (!isFoundingCheckoutEvent(event)) return { handled: false }

  const session = event.data.object
  // Card payment not settled yet (e.g. async methods): wait for
  // checkout.session.async_payment_succeeded rather than failing.
  if (session?.mode === 'payment' && session?.payment_status === 'unpaid') return { handled: false, pending: true }

  const userId = session?.metadata?.userId
  if (
    session.mode !== 'payment' ||
    session.payment_status !== 'paid' ||
    session.currency !== offer.currency ||
    session.amount_total !== offer.priceCents ||
    session.metadata?.offerId !== offer.id ||
    typeof userId !== 'string' || !userId ||
    session.client_reference_id !== userId ||
    typeof session.id !== 'string' || !session.id
  ) {
    throw new Error('INVALID_FOUNDING_CHECKOUT')
  }

  const purchaseRef = db.collection(FOUNDING_PURCHASES).doc(session.id)
  const counterRef = db.collection(ACCESS_GRANT_COUNTERS).doc(offer.id)
  const userRef = db.collection('users').doc(userId)

  return db.runTransaction(async tx => {
    const [purchaseSnap, counterSnap, userSnap] = await Promise.all([tx.get(purchaseRef), tx.get(counterRef), tx.get(userRef)])
    if (purchaseSnap.exists) return { handled: true, duplicate: true }
    if (!userSnap.exists) throw new Error('FOUNDING_USER_NOT_FOUND')

    const nowMs = now()
    // The customer has paid, so the grant is honoured even if a race let
    // more than `seats` checkouts start; the count records the real total.
    const grant = buildAccessGrant({ existing: userSnap.data()?.accessGrant, offer, sourceId: session.id, nowMs })
    tx.set(purchaseRef, {
      checkoutSessionId: session.id,
      userId,
      offerId: offer.id,
      amountTotal: session.amount_total,
      currency: session.currency,
      livemode: session.livemode === true,
      grantedUntil: grant.expiresAt,
      createdAt: new Date(nowMs).toISOString(),
    })
    tx.set(counterRef, { count: counterCount(counterSnap) + 1, updatedAt: new Date(nowMs).toISOString() }, { merge: true })
    tx.set(userRef, { accessGrant: grant }, { merge: true })
    return { handled: true, grantedUntil: grant.expiresAt }
  })
}
