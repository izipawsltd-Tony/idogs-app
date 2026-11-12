// Explicit allowlist for model-facing operating evidence. Never forward the
// source payload: it contains customer emails, account IDs and provider IDs.
const METRICS = ['totalUsers', 'newUsers7d', 'newUsers30d', 'totalDogs', 'totalLitters', 'supportNeedsAction']
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export const hasVerifiedLiveBilling = revenueTruth => revenueTruth?.status === 'VERIFIED' && revenueTruth?.stripeMode === 'LIVE'

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
