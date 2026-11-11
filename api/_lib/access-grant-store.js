// api/_lib/access-grant-store.js — the ONLY writer of users/{uid}.accessGrant
// (see shared/access-grants.js). Every function runs inside a Firestore
// transaction the caller owns, after its own verification.
import { extendedGrantExpiryMs } from '../../shared/access-grants.js'

export const ACCESS_GRANT_COUNTERS = 'accessGrantCounters'
export const FOUNDING_PURCHASES = 'foundingPurchases'
export const GIFT_REDEMPTIONS = 'giftRedemptions'

export function counterCount(snap) {
  const count = snap?.exists ? snap.data()?.count : 0
  return typeof count === 'number' && count >= 0 ? count : 0
}

// Returns the new accessGrant object. Stacks on a still-valid grant and
// never shortens one; a later grant of either kind takes the latest kind.
export function buildAccessGrant({ existing, offer, sourceId, nowMs }) {
  const expiresAtMs = extendedGrantExpiryMs(existing, offer.months, nowMs)
  return {
    granted: true,
    kind: offer.kind,
    offerId: offer.id,
    grantedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    lastSourceId: sourceId,
  }
}
