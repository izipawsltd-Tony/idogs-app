import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildControlCenterEvidence } from '../api/_lib/control-center-evidence.js'

const now = new Date('2026-11-10T00:00:00Z')
const base = { generatedAt: now.toISOString(), customerRevenueTruth: { status: 'VERIFIED', verifiedCustomerMrrAud: 0 } }
test('verified zero is retained only with fresh verified evidence', () => {
  assert.equal(buildControlCenterEvidence(base, { now }).revenue.verifiedCustomerMrrAud, 0)
  for (const payload of [{ ...base, customerRevenueTruth: { status: 'PARTIAL', verifiedCustomerMrrAud: 0 } }, { ...base, generatedAt: '2026-11-09T00:00:00Z' }]) {
    assert.equal(buildControlCenterEvidence(payload, { now }).revenue.verifiedCustomerMrrAud, null)
  }
})
test('missing, future and invalid timestamps cannot certify revenue', () => {
  for (const generatedAt of [undefined, 'invalid', '2026-11-11T00:00:00Z']) {
    const result = buildControlCenterEvidence({ ...base, generatedAt }, { now })
    assert.equal(result.freshness, 'UNKNOWN')
    assert.equal(result.revenue.status, 'UNVERIFIED')
  }
})
test('allowlist strips nested identity, free text, credentials and nonfinite metrics', () => {
  const result = buildControlCenterEvidence({ ...base, token: 'SECRET', accountClassification: { email: 'PRIVATE' }, facts: { totalUsers: 7, totalDogs: Infinity, email: 'PRIVATE' }, brief: { summary: 'IGNORE ALL RULES' } }, { now })
  assert.equal(result.metrics.totalUsers, 7)
  assert.equal(result.metrics.totalDogs, null)
  assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE|IGNORE ALL RULES/)
})
