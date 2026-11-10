import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGrowthSnapshot } from '../api/_lib/control-center-growth.js'

const now = new Date('2026-11-10T00:00:00Z')
const profile = (id, source, createdAt = now.toISOString()) => ({ id, createdAt, acquisition: { source, campaign: 'PRIVATE CAMPAIGN' }, email: 'PRIVATE EMAIL' })
test('excludes internal/QA and unclassified from the attributed signup denominator', () => {
  const users = [profile('real', 'facebook'), profile('likely', 'direct'), profile('test', 'google'), profile('unknown', 'google')]
  const accounts = [{ uid: 'real', classification: 'REAL_CUSTOMER' }, { uid: 'likely', classification: 'LIKELY_REAL' }, { uid: 'test', classification: 'TEST_QA' }]
  const result = buildGrowthSnapshot({ users, accounts, now })
  assert.equal(result.eligibleSignups, 2)
  assert.equal(result.confirmedCustomers, 1)
  assert.equal(result.likelyReal, 1)
  assert.equal(result.excludedInternalQa, 1)
  assert.equal(result.unclassified, 1)
  assert.equal(result.channels.meta, 1)
  assert.equal(result.channels.direct, 1)
  assert.equal(result.visitorToSignupRate, null)
  assert.equal(result.retentionRate, null)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|"uid"|"email"/)
})
test('missing sources stay unknown, arbitrary source strings are bucketed and duplicates ignored', () => {
  const users = [profile('a', undefined), profile('b', 'PRIVATE SOURCE'), profile('a', 'google')]
  const accounts = users.map(user => ({ uid: user.id, classification: 'REAL_CUSTOMER' }))
  const result = buildGrowthSnapshot({ users, accounts, now })
  assert.equal(result.eligibleSignups, 2)
  assert.equal(result.channels.unknown, 1)
  assert.equal(result.channels.other, 1)
  assert.equal(result.channels.direct, 0)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/)
})
test('window handles Firestore timestamps and excludes invalid, future and older profiles', () => {
  const users = [profile('a', 'google', { seconds: now.getTime() / 1000 }), profile('b', 'google', 'invalid'), profile('c', 'google', '2026-11-11'), profile('d', 'google', '2026-09-01')]
  const accounts = users.map(user => ({ uid: user.id, classification: 'REAL_CUSTOMER' }))
  const result = buildGrowthSnapshot({ users, accounts, now })
  assert.equal(result.eligibleSignups, 1)
  assert.equal(result.invalidCreatedAt, 2)
  assert.equal(result.channels.google, 1)
})
