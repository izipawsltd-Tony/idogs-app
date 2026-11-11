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

test('counts an eligible account once for dated active litters after signup', () => {
  const users = ['a', 'b', 'qa'].map(id => profile(id, 'direct', '2026-11-01'))
  const accounts = users.map(user => ({ uid: user.id, classification: user.id === 'qa' ? 'TEST_QA' : 'REAL_CUSTOMER' }))
  const activeLitters = [
    { tenantId: 'a', createdAt: '2026-11-02' },
    { tenantId: 'a', createdAt: '2026-11-03' },
    { tenantId: 'b', createdAt: '2026-10-31' },
    { tenantId: 'b', createdAt: '2026-11-11' },
    { tenantId: 'b', createdAt: 'invalid' },
    { tenantId: 'qa', createdAt: '2026-11-02' },
  ]
  assert.equal(buildGrowthSnapshot({ users, accounts, activeLitters, now }).accountsWithActiveLitterAfterSignup, 1)
  assert.equal(buildGrowthSnapshot({ users, accounts, now }).accountsWithActiveLitterAfterSignup, null)
})

test('attributes dog records to their original tenant and exposes billing only when verified', () => {
  const users = ['original', 'recipient', 'qa'].map(id => profile(id, 'direct', '2026-11-01'))
  const accounts = [
    { uid: 'original', classification: 'REAL_CUSTOMER', revenueBucket: 'VERIFIED_CUSTOMER' },
    { uid: 'recipient', classification: 'LIKELY_REAL', revenueBucket: 'UNRESOLVED' },
    { uid: 'qa', classification: 'TEST_QA', revenueBucket: 'QA_INTERNAL' },
  ]
  const dogs = [
    { tenantId: 'original', currentOwnerId: 'recipient', createdAt: '2026-11-02' },
    { tenantId: 'original', createdAt: '2026-11-03' },
    { tenantId: 'qa', createdAt: '2026-11-03' },
  ]
  const inputs = { users, accounts, dogs, now }
  const result = buildGrowthSnapshot({ ...inputs, verifiedLiveBilling: true })
  assert.equal(result.accountsWithDogAfterSignup, 1)
  assert.equal(result.accountsWithVerifiedActiveSubscription, 1)
  assert.equal(buildGrowthSnapshot(inputs).accountsWithVerifiedActiveSubscription, null)
})

test('ordered milestone requires a dog before the earliest active litter', () => {
  const users = ['ordered', 'reversed', 'same', 'qa'].map(id => profile(id, 'direct', '2026-11-01'))
  const accounts = users.map(user => ({ uid: user.id, classification: user.id === 'qa' ? 'TEST_QA' : 'REAL_CUSTOMER' }))
  const dogs = users.map(user => ({ tenantId: user.id, createdAt: '2026-11-04' }))
  const activeLitters = users.map(user => ({
    tenantId: user.id,
    createdAt: user.id === 'same' ? '2026-11-04' : '2026-11-05',
  }))
  activeLitters.push({ tenantId: 'reversed', createdAt: '2026-11-03' })
  const result = buildGrowthSnapshot({ users, accounts, dogs, activeLitters, now })
  assert.equal(result.accountsWithDogAfterSignup, 3)
  assert.equal(result.accountsWithActiveLitterAfterSignup, 3)
  assert.equal(result.accountsWithDogBeforeActiveLitter, 1)
  assert.equal(buildGrowthSnapshot({ users, accounts, dogs, now }).accountsWithDogBeforeActiveLitter, null)
})
