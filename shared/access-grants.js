// shared/access-grants.js — time-limited iDogs Plus access that is NOT a
// Stripe subscription: the one-off Founding Member purchase and the
// kennel gift for past puppy buyers (Owner decision, 12 Nov 2026).
//
// The grant lives on users/{uid}.accessGrant and is written ONLY by
// trusted Admin SDK code (api/_lib/access-grant-store.js). firestore.rules
// lists `accessGrant` in userBillingFields(), so a browser can never
// create, extend or clear it. Server code additionally ignores grants
// unless IDOGS_ACCESS_GRANTS_ENABLED=true, so this code can ship before
// the hardened rules are deployed without opening a self-grant path.
//
// Shape (all strings are ISO-8601 UTC):
//   { granted: true, kind: 'founding' | 'gift', offerId, grantedAt,
//     expiresAt, lastSourceId }
// A grant never renews and never charges anyone: when expiresAt passes,
// the account simply falls back to whatever its own plan is.

export const FOUNDING_OFFER = Object.freeze({
  id: 'founding-member-2026',
  kind: 'founding',
  priceCents: 4900,
  currency: 'aud',
  months: 15,
  seats: 20,
  // Sales window (Adelaide midnight 31 Dec 2026 = 13:30 UTC).
  salesStart: Date.parse('2026-11-12T00:00:00Z'),
  salesEnd: Date.parse('2026-12-31T13:30:00Z'),
  productName: 'iDogs Plus – Founding Member (15 months)',
  terms: 'One-off payment of A$49 including GST for 15 months of iDogs Plus. No subscription and no automatic renewal. Limited to the first 20 Founding Members.',
})

export const GIFT_OFFER = Object.freeze({
  id: 'kennel-gift-2026',
  kind: 'gift',
  months: 12,
  maxRedemptions: 100,
  // Redeem window (Adelaide midnight 31 Mar 2027 = 13:30 UTC).
  redeemStart: Date.parse('2026-11-12T00:00:00Z'),
  redeemEnd: Date.parse('2027-03-31T13:30:00Z'),
})

export const ACCESS_GRANT_KINDS = Object.freeze(['founding', 'gift'])

// Calendar-month addition in UTC; a day that does not exist in the target
// month (31 Jan + 1 month) clamps to that month's last day.
export function addMonthsUTC(fromMs, months) {
  const from = new Date(fromMs)
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const day = Math.min(from.getUTCDate(), lastDay)
  return Date.UTC(y, m, day, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds())
}

// Fail-closed: anything malformed is "no grant".
export function accessGrantExpiryMs(grant) {
  if (!grant || typeof grant !== 'object' || grant.granted !== true) return null
  if (!ACCESS_GRANT_KINDS.includes(grant.kind)) return null
  if (typeof grant.expiresAt !== 'string') return null
  const ms = Date.parse(grant.expiresAt)
  return Number.isFinite(ms) ? ms : null
}

export function hasValidAccessGrant(profile, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : now
  const expiry = accessGrantExpiryMs(profile?.accessGrant)
  return expiry !== null && nowMs < expiry
}

// New expiry when `months` are added: stacks on top of a still-valid grant,
// otherwise starts now. Never shortens an existing grant.
export function extendedGrantExpiryMs(existingGrant, months, nowMs) {
  const current = accessGrantExpiryMs(existingGrant)
  const base = current !== null && current > nowMs ? current : nowMs
  return addMonthsUTC(base, months)
}
