// api/_lib/gift-redeem-handler.js — the kennel gift for past puppy buyers:
// one free year of iDogs Plus per account, claimed with a campaign code the
// Owner sends by SMS. No payment details, no renewal, no charge.
import { createHash, timingSafeEqual } from 'node:crypto'
import { GIFT_OFFER } from '../../shared/access-grants.js'
import { ACCESS_GRANT_COUNTERS, GIFT_REDEMPTIONS, buildAccessGrant, counterCount } from './access-grant-store.js'
import { logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'

const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])

export function normaliseGiftCode(value) {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : ''
}

// Constant-time comparison of SHA-256 digests (equal length by design).
export function giftCodeMatches(submitted, configured) {
  const a = normaliseGiftCode(submitted)
  const b = normaliseGiftCode(configured)
  if (!a || b.length < 8) return false
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

function parseBody(req) {
  if (typeof req.body !== 'string') return req.body || {}
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

export function createGiftRedeemHandler({
  verifyIdToken,
  db,
  checkRateLimit = async () => ({ allowed: true }),
  getConfiguredCode = () => process.env.IDOGS_GIFT_CODE,
  isEnabled = () => process.env.GIFT_REDEMPTION_ENABLED === 'true',
  now = Date.now,
  offer = GIFT_OFFER,
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
    // Past buyers may use email or SMS sign-in; either must be verified.
    const verified = identity.email_verified === true || (typeof identity.phone_number === 'string' && identity.phone_number.length > 0)
    if (!verified) return res.status(403).json({ error: 'Please verify your email address first, then claim your gift.', code: 'GIFT_IDENTITY_UNVERIFIED' })

    if (!isEnabled()) {
      logConfigError('redeem-gift', 'GIFT_REDEMPTION_DISABLED')
      return res.status(503).json({ error: 'Gift claims are not open yet.', code: 'GIFT_REDEMPTION_DISABLED' })
    }
    const configured = getConfiguredCode()
    if (normaliseGiftCode(configured).length < 8) {
      logConfigError('redeem-gift', 'GIFT_CODE_NOT_CONFIGURED')
      return res.status(503).json({ error: 'Gift claims are not open yet.', code: 'GIFT_REDEMPTION_DISABLED' })
    }

    const t = now()
    if (!(t >= offer.redeemStart && t < offer.redeemEnd)) {
      return res.status(409).json({ error: 'This gift has expired.', code: 'GIFT_CLOSED' })
    }

    const limit = await checkRateLimit(createHash('sha256').update(uid).digest('hex'))
    if (!limit?.allowed) {
      res.setHeader?.('Retry-After', String(limit?.retryAfterSeconds || 60))
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.', code: 'GIFT_RATE_LIMITED' })
    }

    const body = parseBody(req)
    if (Object.keys(body).some(key => key !== 'code')) return res.status(400).json({ error: 'Unsupported fields' })
    if (!giftCodeMatches(body.code, configured)) {
      return res.status(400).json({ error: 'That gift code is not valid. Please check the code in your SMS.', code: 'GIFT_CODE_INVALID' })
    }

    const redemptionRef = db.collection(GIFT_REDEMPTIONS).doc(`${offer.id}_${uid}`)
    const counterRef = db.collection(ACCESS_GRANT_COUNTERS).doc(offer.id)
    const userRef = db.collection('users').doc(uid)

    try {
      const result = await db.runTransaction(async tx => {
        const [redemptionSnap, counterSnap, userSnap] = await Promise.all([tx.get(redemptionRef), tx.get(counterRef), tx.get(userRef)])
        if (!userSnap.exists) return { status: 409, body: { error: 'Account details are not ready. Please try again in a minute.' } }
        if (redemptionSnap.exists) {
          return { status: 409, body: { error: 'This account has already claimed the gift.', code: 'GIFT_ALREADY_CLAIMED', grantedUntil: redemptionSnap.data()?.grantedUntil || null } }
        }
        const count = counterCount(counterSnap)
        if (!(count < offer.maxRedemptions)) {
          return { status: 409, body: { error: 'All gifts in this campaign have been claimed.', code: 'GIFT_SOLD_OUT' } }
        }
        const profile = userSnap.data()
        const grant = buildAccessGrant({ existing: profile?.accessGrant, offer, sourceId: redemptionRef.id, nowMs: t })
        tx.set(redemptionRef, { userId: uid, offerId: offer.id, grantedUntil: grant.expiresAt, createdAt: new Date(t).toISOString() })
        tx.set(counterRef, { count: count + 1, updatedAt: new Date(t).toISOString() }, { merge: true })
        tx.set(userRef, { accessGrant: grant }, { merge: true })
        const hasSubscription = Boolean(profile?.stripeSubscriptionId) || LIVE_SUBSCRIPTION_STATUSES.has(profile?.subscriptionStatus)
        return { status: 200, body: { ok: true, grantedUntil: grant.expiresAt, hasSubscription } }
      })
      return res.status(result.status).json(result.body)
    } catch (err) {
      logSanitizedError('redeem-gift', 'GIFT_REDEEM_FAILED', { code: err?.code, message: err?.message })
      return res.status(500).json({ error: 'Could not claim the gift. Please try again.' })
    }
  }
}
