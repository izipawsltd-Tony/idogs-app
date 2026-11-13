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

function earliestRecordDates(records, signupDates, nowMs) {
  if (!records) return null
  const dates = new Map()
  for (const record of records) {
    const signup = signupDates.get(record.tenantId)
    const created = timestamp(record.createdAt)
    if (signup !== undefined && created !== null && created >= signup && created <= nowMs) {
      dates.set(record.tenantId, Math.min(dates.get(record.tenantId) ?? Infinity, created))
    }
  }
  return dates
}

// Aggregate current records without retaining campaign text or identities.
export function buildGrowthSnapshot({ users, accounts, dogs, activeLitters, litters, paymentHistory, verifiedLiveBilling = false, now = new Date(), days = 30 }) {
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
  const dogDates = earliestRecordDates(dogs, signupDates, now.getTime())
  const litterDates = earliestRecordDates(activeLitters, signupDates, now.getTime())
  const accountsWithDogBeforeActiveLitter = dogDates && litterDates
    ? [...litterDates].filter(([uid, litterDate]) => dogDates.get(uid) < litterDate).length
    : null
  // First litter is a separate milestone from activation (first dog). It
  // includes archived litters; deleted litters no longer exist and are missed.
  const firstLitterDates = earliestRecordDates(litters, signupDates, now.getTime())
  const funnel = buildFunnel({ eligibleSignups, dogDates, firstLitterDates, paymentHistory, days })
  return {
    windowDays: days, observedAt: now.toISOString(),
    eligibleSignups, confirmedCustomers, likelyReal, excludedInternalQa, unclassified, invalidCreatedAt,
    channels,
    accountsWithDogAfterSignup: dogDates?.size ?? null,
    accountsWithActiveLitterAfterSignup: litterDates?.size ?? null,
    accountsWithDogBeforeActiveLitter,
    accountsWithVerifiedActiveSubscription,
    accountsWithFirstLitterAfterSignup: firstLitterDates?.size ?? null,
    visitors: null, visitorToSignupRate: null, retentionRate: null,
    funnel,
    basis: 'Current signup profiles classified REAL_CUSTOMER or LIKELY_REAL. Likely-real signals are not verified customers. Source is self-reported attribution, not proof of ad performance.',
    limitations: [
      'Visitor denominator is not connected.',
      'Active subscriptions show current billing status. Collected payments and first payment dates are unverified.',
      'No durable activation, cancellation or retention event history is established by this snapshot.',
      'Direct means recorded direct attribution; missing source remains unknown.',
    ],
  }
}

const PAYMENT_STATUSES = new Set(['VERIFIED', 'TEST_MODE_ONLY', 'UNKNOWN_MODE', 'PARTIAL', 'UNAVAILABLE'])
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const ratio = (numerator, denominator) => count(numerator) !== null && count(denominator) ? numerator / denominator : null

// Funnel definitions agreed by the Owner on 13 Nov 2026. Missing sources stay
// null with an explicit status; null never means zero.
function buildFunnel({ eligibleSignups, dogDates, firstLitterDates, paymentHistory, days }) {
  const payments = paymentHistory && PAYMENT_STATUSES.has(paymentHistory.status) ? paymentHistory : { status: 'UNAVAILABLE' }
  const live = payments.status === 'VERIFIED' ? payments.live : null
  const test = payments.test || null
  return {
    windowDays: days,
    visits: {
      status: 'NO_VERIFIED_SOURCE',
      signupPageSessions: null,
      visitToSignupRate: null,
      note: 'No verified analytics source for sessions that include the signup page is connected. The visit-to-signup rate stays empty.',
    },
    signups: { eligible: eligibleSignups },
    activation: {
      firstDog: dogDates?.size ?? null,
      firstLitter: firstLitterDates?.size ?? null,
      note: 'Activation is the first dog profile created on or after signup. First litter is tracked separately. Both use records that still exist: deleted dogs and litters, and dogs since transferred out of the original account, can be missed.',
    },
    payingCustomers: {
      status: payments.status,
      sources: payments.sources || { stripe: 'UNAVAILABLE', apple: 'NOT_INTEGRATED' },
      newInWindow: live ? count(live.newPayingAccounts) : null,
      total: live ? count(live.payingAccounts) : null,
      scope: payments.scope || 'Stripe only. Apple transactions are not integrated.',
      testModeDiagnostics: test ? { newInWindow: count(test.newPayingAccounts), total: count(test.payingAccounts) } : null,
      note: 'Counted once per account on its first verified successful payment. Test-mode transactions, internal and QA accounts are excluded. Stripe customers stored on more than one account are not attributed.',
    },
    paidRetention: {
      status: payments.status,
      dueForRenewal: live ? count(live.dueForRenewal) : null,
      renewed: live ? count(live.renewed) : null,
      rate: live ? ratio(live.renewed, live.dueForRenewal) : null,
      unknownPeriod: live ? count(live.unknownPeriod) : null,
      testModeDiagnostics: test ? { dueForRenewal: count(test.dueForRenewal), renewed: count(test.renewed) } : null,
      note: 'Among paying accounts whose first paid subscription period ended at least 3 days ago, the share with a later paid subscription invoice. This is the priority retention metric for paying-customer growth.',
    },
    usageRetention: {
      status: 'NOT_MEASURED',
      rate: null,
      note: 'Defined as returning to perform a meaningful action in the app (for example a dog, health record, reminder, document or litter change). Not measured yet: no durable activity history is used by this snapshot.',
    },
  }
}
