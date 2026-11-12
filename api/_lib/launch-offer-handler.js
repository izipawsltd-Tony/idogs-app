// api/_lib/launch-offer-handler.js — public launch campaign: 1 year of Plus free for 100 accounts
// of iDogs Plus until 31 Dec 2026 (Adelaide), for verified accounts that have
// added at least one dog. Plus a public, cache-friendly status endpoint whose
// "remaining" figure is the real counter (no fake scarcity, no reset).
import { FOUNDING_OFFER, LAUNCH_OFFER, hasValidAccessGrant } from '../../shared/access-grants.js'
import { ACCESS_GRANT_COUNTERS, GIFT_REDEMPTIONS, buildAccessGrant, counterCount } from './access-grant-store.js'
import { getOwnedActiveDogsSorted } from './dog-cap.js'
import { logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'

const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])

export function launchOfferState({ claimed, nowMs, offer = LAUNCH_OFFER }) {
  const remaining = Math.max(0, offer.maxRedemptions - claimed)
  const open = nowMs >= offer.claimStart && nowMs < offer.claimEnd
  return { active: open && remaining > 0, remaining, endsAt: new Date(offer.claimEnd).toISOString() }
}

export function createOfferStatusHandler({
  getLaunchClaimed,
  launchEnabled = () => process.env.LAUNCH_OFFER_ENABLED === 'true',
  passEnabled = () => process.env.FOUNDING_CHECKOUT_ENABLED === 'true',
  now = Date.now,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    const t = now()
    try {
      const launch = launchEnabled()
        ? launchOfferState({ claimed: await getLaunchClaimed(), nowMs: t })
        : { active: false, remaining: 0, endsAt: new Date(LAUNCH_OFFER.claimEnd).toISOString() }
      // The 15-month pass is offered once the free places are gone (or the
      // campaign is off), within its own sales window.
      const passOpen = passEnabled() && t >= FOUNDING_OFFER.salesStart && t < FOUNDING_OFFER.salesEnd && !launch.active
      res.setHeader?.('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
      return res.status(200).json({
        // Owner decision 12 Nov 2026: while the voucher campaign is switched on
        // (and afterwards, until the flag is removed) the A$0 subscription
        // promotion is not offered to new customers — the voucher is better.
        promotionSuperseded: launchEnabled(),
        launch: { ...launch, showRemaining: launch.active && launch.remaining <= LAUNCH_OFFER.showRemainingAtOrBelow },
        pass: { active: passOpen, endsAt: new Date(FOUNDING_OFFER.salesEnd).toISOString() },
      })
    } catch (err) {
      logSanitizedError('offer-status', 'OFFER_STATUS_FAILED', { code: err?.code, message: err?.message })
      return res.status(500).json({ error: 'Offer status unavailable' })
    }
  }
}

export function createLaunchClaimHandler({
  verifyIdToken,
  db,
  isEnabled = () => process.env.LAUNCH_OFFER_ENABLED === 'true',
  countOwnedActiveDogs = async (tx, uid) => (await getOwnedActiveDogsSorted(tx, db, uid)).length,
  now = Date.now,
  offer = LAUNCH_OFFER,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const authHeader = req.headers?.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return res.status(401).json({ error: 'Missing Authorization header' })
    let identity
    try { identity = await verifyIdToken(token) } catch {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    const uid = typeof identity?.uid === 'string' ? identity.uid : ''
    if (!uid) return res.status(401).json({ error: 'Authenticated identity is incomplete' })
    const verified = identity.email_verified === true || (typeof identity.phone_number === 'string' && identity.phone_number.length > 0)
    if (!verified) return res.status(403).json({ error: 'Please verify your email address first.', code: 'LAUNCH_IDENTITY_UNVERIFIED' })

    if (!isEnabled()) {
      logConfigError('claim-launch-offer', 'LAUNCH_OFFER_DISABLED')
      return res.status(503).json({ error: 'This offer is not open.', code: 'LAUNCH_OFFER_DISABLED' })
    }
    const t = now()
    if (!(t >= offer.claimStart && t < offer.claimEnd)) {
      return res.status(409).json({ error: 'This offer ended on 31 December 2026.', code: 'LAUNCH_CLOSED' })
    }

    const redemptionRef = db.collection(GIFT_REDEMPTIONS).doc(`${offer.id}_${uid}`)
    const counterRef = db.collection(ACCESS_GRANT_COUNTERS).doc(offer.id)
    const userRef = db.collection('users').doc(uid)

    try {
      const result = await db.runTransaction(async tx => {
        const [redemptionSnap, counterSnap, userSnap] = await Promise.all([tx.get(redemptionRef), tx.get(counterRef), tx.get(userRef)])
        if (!userSnap.exists) return { status: 409, body: { error: 'Account details are not ready. Please try again in a minute.' } }
        if (redemptionSnap.exists) {
          return { status: 409, body: { error: 'This account has already claimed its free year.', code: 'LAUNCH_ALREADY_CLAIMED', grantedUntil: redemptionSnap.data()?.grantedUntil || null } }
        }
        const profile = userSnap.data()
        // One free pass at a time: a kennel gift or 15-month pass already
        // covers this account.
        if (hasValidAccessGrant(profile, t)) {
          return { status: 409, body: { error: 'You already have an iDogs Plus pass.', code: 'LAUNCH_HAS_PASS', grantedUntil: profile.accessGrant.expiresAt } }
        }
        const count = counterCount(counterSnap)
        if (!(count < offer.maxRedemptions)) {
          return { status: 409, body: { error: 'All 100 free places have been claimed.', code: 'LAUNCH_SOLD_OUT' } }
        }
        if ((await countOwnedActiveDogs(tx, uid)) < 1) {
          return { status: 409, body: { error: 'Add your first dog, then claim your free year.', code: 'LAUNCH_NEEDS_DOG' } }
        }
        const grant = buildAccessGrant({ existing: profile?.accessGrant, offer, sourceId: redemptionRef.id, nowMs: t })
        tx.set(redemptionRef, { userId: uid, offerId: offer.id, grantedUntil: grant.expiresAt, createdAt: new Date(t).toISOString() })
        tx.set(counterRef, { count: count + 1, updatedAt: new Date(t).toISOString() }, { merge: true })
        tx.set(userRef, { accessGrant: grant }, { merge: true })
        const hasSubscription = Boolean(profile?.stripeSubscriptionId) || LIVE_SUBSCRIPTION_STATUSES.has(profile?.subscriptionStatus)
        return { status: 200, body: { ok: true, grantedUntil: grant.expiresAt, hasSubscription, remaining: offer.maxRedemptions - count - 1 } }
      })
      return res.status(result.status).json(result.body)
    } catch (err) {
      logSanitizedError('claim-launch-offer', 'LAUNCH_CLAIM_FAILED', { code: err?.code, message: err?.message })
      return res.status(500).json({ error: 'Could not claim the offer. Please try again.' })
    }
  }
}
