const DAY = 86400000
const ELIGIBLE = new Set(['REAL_CUSTOMER', 'LIKELY_REAL'])
const EXCLUDED = new Set(['INTERNAL', 'TEST_QA'])
const CHANNELS = new Map([
  ['facebook', 'meta'], ['fb', 'meta'], ['meta', 'meta'], ['instagram', 'meta'], ['ig', 'meta'],
  ['google', 'google'], ['bing', 'bing'], ['direct', 'direct'],
])
function timestamp(value) {
  try {
    const date = value?.toDate instanceof Function ? value.toDate()
      : value instanceof Date ? value
      : typeof value === 'string' ? new Date(value)
      : typeof value?.seconds === 'number' ? new Date(value.seconds * 1000) : null
    return date && Number.isFinite(date.getTime()) ? date.getTime() : null
  } catch { return null }
}

function countAccountsWithDatedRecords(records, signupDates, nowMs) {
  if (!records) return null
  const accountIds = new Set()
  for (const record of records) {
    const signup = signupDates.get(record.tenantId)
    const created = timestamp(record.createdAt)
    if (signup !== undefined && created !== null && created >= signup && created <= nowMs) {
      accountIds.add(record.tenantId)
    }
  }
  return accountIds.size
}

// Aggregate current records without retaining campaign text or identities.
export function buildGrowthSnapshot({ users, accounts, dogs, activeLitters, verifiedLiveBilling = false, now = new Date(), days = 30 }) {
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(days) || days < 1 || days > 365) throw new Error('Invalid growth window')
  const classified = new Map(accounts.map(account => [account.uid, account]))
  const channels = { meta: 0, google: 0, bing: 0, direct: 0, other: 0, unknown: 0 }
  let eligibleSignups = 0, confirmedCustomers = 0, likelyReal = 0, excludedInternalQa = 0, unclassified = 0, invalidCreatedAt = 0
  const seen = new Set()
  const signupDates = new Map()
  for (const user of users) {
    if (typeof user.id !== 'string' || !user.id || seen.has(user.id)) continue
    seen.add(user.id)
    const created = timestamp(user.createdAt)
    if (created === null || created > now.getTime()) { invalidCreatedAt++; continue }
    if (created < now.getTime() - days * DAY) continue
    const classification = classified.get(user.id)?.classification
    if (EXCLUDED.has(classification)) { excludedInternalQa++; continue }
    if (!ELIGIBLE.has(classification)) { unclassified++; continue }
    eligibleSignups++
    signupDates.set(user.id, created)
    if (classification === 'REAL_CUSTOMER') confirmedCustomers++
    else likelyReal++
    const raw = user.acquisition?.source
    const source = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    // fbclid presence alone is not proof of a particular source.
    channels[source ? CHANNELS.get(source) || 'other' : 'unknown']++
  }
  const accountsWithVerifiedActiveSubscription = verifiedLiveBilling
    ? [...signupDates.keys()].filter(uid => {
      const account = classified.get(uid)
      return account.classification === 'REAL_CUSTOMER' && account.revenueBucket === 'VERIFIED_CUSTOMER'
    }).length
    : null
  return {
    windowDays: days, observedAt: now.toISOString(),
    eligibleSignups, confirmedCustomers, likelyReal, excludedInternalQa, unclassified, invalidCreatedAt,
    channels,
    accountsWithDogAfterSignup: countAccountsWithDatedRecords(dogs, signupDates, now.getTime()),
    accountsWithActiveLitterAfterSignup: countAccountsWithDatedRecords(activeLitters, signupDates, now.getTime()),
    accountsWithVerifiedActiveSubscription,
    visitors: null, visitorToSignupRate: null, retentionRate: null,
    basis: 'Current signup profiles classified REAL_CUSTOMER or LIKELY_REAL. Likely-real signals are not verified customers. Source is self-reported attribution, not proof of ad performance.',
    limitations: ['Visitor denominator is not connected.', 'No durable activation, cancellation or retention event history is established by this snapshot.', 'Direct means recorded direct attribution; missing source remains unknown.'],
  }
}
