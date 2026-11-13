// Explicit allowlist for model-facing operating evidence. Never forward the
// source payload: it contains customer emails, account IDs and provider IDs.
const METRICS = ['totalUsers', 'newUsers7d', 'newUsers30d', 'totalDogs', 'totalLitters', 'supportNeedsAction']
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export const hasVerifiedLiveBilling = revenueTruth => revenueTruth?.status === 'VERIFIED' && revenueTruth?.stripeMode === 'LIVE'

const enumValue = (value, allowed) => allowed.includes(value) ? value : 'UNKNOWN'
const PAYMENT_STATUSES = ['VERIFIED', 'TEST_MODE_ONLY', 'UNKNOWN_MODE', 'PARTIAL', 'UNAVAILABLE']
const share = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null

// Aggregate funnel only. Test-mode diagnostics are deliberately not forwarded
// to the model so it cannot present them as customer results.
function projectFunnel(funnel, freshness) {
  if (freshness !== 'FRESH' || !funnel || typeof funnel !== 'object') return null
  const paid = funnel.payingCustomers || {}
  const retention = funnel.paidRetention || {}
  const verified = paid.status === 'VERIFIED'
  return {
    visits: { status: 'NO_VERIFIED_SOURCE', signupPageSessions: null, visitToSignupRate: null },
    activation: { firstDog: amount(funnel.activation?.firstDog), firstLitter: amount(funnel.activation?.firstLitter) },
    payingCustomers: {
      status: enumValue(paid.status, PAYMENT_STATUSES),
      appleIncluded: false,
      newInWindow: verified ? amount(paid.newInWindow) : null,
      total: verified ? amount(paid.total) : null,
    },
    paidRetention: {
      status: enumValue(retention.status, PAYMENT_STATUSES),
      dueForRenewal: verified ? amount(retention.dueForRenewal) : null,
      renewed: verified ? amount(retention.renewed) : null,
      rate: verified ? share(retention.rate) : null,
    },
    usageRetention: { status: 'NOT_MEASURED', rate: null },
    basis: 'Activation is the first dog after signup; first litter is separate. Paying customers are Stripe-only (Apple not integrated), once per account on the first verified successful payment, excluding test mode. Paid retention is successful renewal among accounts due for renewal. Counts are null when not verified; null is unknown, not zero.',
  }
}

export function buildControlCenterEvidence(payload, { now = new Date(), maxAgeMs = 300000 } = {}) {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error('Invalid evidence clock')
  const source = payload && typeof payload === 'object' ? payload : {}
  const generated = typeof source.generatedAt === 'string' ? Date.parse(source.generatedAt) : NaN
  const ageMs = now.getTime() - generated
  const freshness = !Number.isFinite(ageMs) || ageMs < 0 ? 'UNKNOWN' : ageMs > maxAgeMs ? 'STALE' : 'FRESH'
  const revenue = source.customerRevenueTruth || {}
  const revenueVerified = freshness === 'FRESH' && revenue.status === 'VERIFIED'
    && hasVerifiedLiveBilling(source.revenueTruth)
    && amount(revenue.verifiedCustomerMrrAud) !== null
  const growth = source.growthSnapshot || {}
  const observedCount = (value, cohort) => freshness === 'FRESH'
    && Number.isSafeInteger(value) && value >= 0
    && Number.isSafeInteger(cohort) && value <= cohort ? value : null
  const dogs = observedCount(growth.accountsWithDogAfterSignup, growth.eligibleSignups)
  const litters = observedCount(growth.accountsWithActiveLitterAfterSignup, growth.eligibleSignups)
  return {
    schemaVersion: '1.0',
    generatedAt: Number.isFinite(generated) ? new Date(generated).toISOString() : null,
    freshness,
    ageSeconds: Number.isFinite(ageMs) && ageMs >= 0 ? Math.floor(ageMs / 1000) : null,
    capabilities: { modelConnected: false, backgroundMonitoringConnected: false, productionWrites: false },
    revenue: {
      status: revenueVerified ? 'VERIFIED' : 'UNVERIFIED',
      billingMode: ['LIVE', 'TEST', 'MIXED'].includes(source.revenueTruth?.stripeMode) ? source.revenueTruth.stripeMode : 'UNKNOWN',
      // Unverified zero must never become an assertion of zero revenue.
      verifiedCustomerMrrAud: revenueVerified ? revenue.verifiedCustomerMrrAud : null,
      failedSubscriptionProfiles: amount(revenue.failedSubscriptionProfiles),
    },
    metrics: Object.fromEntries(METRICS.map(key => [key, amount(source.facts?.[key])])),
    supportCoverage: source.facts?.supportSampleAtLimit === true ? 'POTENTIALLY_PARTIAL'
      : source.facts?.supportSampleAtLimit === false ? 'COMPLETE' : 'UNKNOWN',
    metricsBasis: 'Raw operating/account counts include internal, QA and unclassified profiles. New user counts are not verified customer growth. Acquisition uses a separate eligible-signup denominator.',
    acquisition: {
      classificationCoverage: source.accountClassification?.status === 'VERIFIED' ? 'COMPLETE'
        : source.accountClassification?.status === 'PARTIAL' ? 'PARTIAL' : 'UNKNOWN',
      windowDays: amount(source.growthSnapshot?.windowDays),
      eligibleSignups: amount(source.growthSnapshot?.eligibleSignups),
      confirmedCustomers: amount(source.growthSnapshot?.confirmedCustomers),
      likelyReal: amount(source.growthSnapshot?.likelyReal),
      excludedInternalQa: amount(source.growthSnapshot?.excludedInternalQa),
      unclassified: amount(source.growthSnapshot?.unclassified),
      invalidCreatedAt: amount(source.growthSnapshot?.invalidCreatedAt),
      accountsWithDogAfterSignup: dogs,
      accountsWithActiveLitterAfterSignup: litters,
      accountsWithDogBeforeActiveLitter: dogs === null || litters === null ? null
        : observedCount(growth.accountsWithDogBeforeActiveLitter, Math.min(dogs, litters)),
      accountsWithVerifiedActiveSubscription: hasVerifiedLiveBilling(source.revenueTruth) && source.revenueTruth.failedSubscriptionReads === 0
        ? observedCount(growth.accountsWithVerifiedActiveSubscription, growth.confirmedCustomers) : null,
      channels: Object.fromEntries(['meta', 'google', 'bing', 'direct', 'other', 'unknown'].map(key => [key, amount(source.growthSnapshot?.channels?.[key])])),
      visitorToSignupRate: null,
      retentionRate: null,
      funnel: projectFunnel(growth.funnel, freshness),
      basis: 'Counts use surviving records in the signup cohort. The ordered milestone counts accounts with a dog record dated after or at signup and strictly before their earliest currently active litter. Historical first creation, paid conversion and retention are unknown.',
    },
    limitations: [
      ...(freshness !== 'FRESH' ? ['Operating evidence is stale or its timestamp cannot be trusted.'] : []),
      ...(!revenueVerified ? ['Customer revenue is not fully verified. Missing values are not zero.'] : []),
      ...(source.facts?.supportSampleAtLimit === true ? ['Support counts cover a capped sample. The inbox may contain additional conversations requiring action.'] : []),
      ...(source.accountClassification?.status === 'PARTIAL' ? ['Signup classification is provisional because Firebase Auth lookup was incomplete. Do not use these cohort counts as confirmed customer growth.'] : []),
      'Current account counts are not historical acquisition or retention cohorts.',
      'Monitoring and AI connections require separate verified integrations.',
    ],
  }
}
