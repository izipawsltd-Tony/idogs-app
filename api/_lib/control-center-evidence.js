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
    acquisition: {
      windowDays: amount(source.growthSnapshot?.windowDays),
      eligibleSignups: amount(source.growthSnapshot?.eligibleSignups),
      confirmedCustomers: amount(source.growthSnapshot?.confirmedCustomers),
      likelyReal: amount(source.growthSnapshot?.likelyReal),
      channels: Object.fromEntries(['meta', 'google', 'bing', 'direct', 'other', 'unknown'].map(key => [key, amount(source.growthSnapshot?.channels?.[key])])),
      visitorToSignupRate: null,
      retentionRate: null,
      basis: 'Observed signup profiles, not a historical event funnel. LIKELY_REAL is a signal, not confirmed customer revenue.',
    },
    limitations: [
      ...(freshness !== 'FRESH' ? ['Operating evidence is stale or its timestamp cannot be trusted.'] : []),
      ...(!revenueVerified ? ['Customer revenue is not fully verified. Missing values are not zero.'] : []),
      'Current account counts are not historical acquisition or retention cohorts.',
      'Monitoring and AI connections require separate verified integrations.',
    ],
  }
}
