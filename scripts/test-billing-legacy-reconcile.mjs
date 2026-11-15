import assert from 'node:assert/strict'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { LEGACY_PAID_PRICE_IDS } from '../api/_lib/checkout-handler.js'
import { verifiedPaidInterval, reconcileVerifiedPaidSubscription } from '../api/_lib/billing-reconcile.js'

const subscription = {
  id: 'sub_legacy_basic',
  status: 'active',
  customer: 'cus_legacy',
  start_date: 1_788_000_000,
  metadata: { userId: 'user-1', plan: 'basic' },
  items: { data: [{ price: { id: LEGACY_PAID_PRICE_IDS.basic } }] },
}

assert.equal(verifiedPaidInterval(subscription), 'monthly')
assert.equal(verifiedPaidInterval({
  ...subscription,
  id: 'sub_unknown',
  items: { data: [{ price: { id: 'price_unknown' } }] },
}), null)

const db = createFakeFirestore({
  users: {
    'user-1': {
      plan: 'free',
      stripeCustomerId: 'cus_legacy',
      stripeSubscriptionId: 'sub_legacy_basic',
      subscriptionStatus: 'active',
      plusScansUsed: 6,
      plusScansPeriodStart: '2026-09-01T00:00:00.000Z',
    },
  },
})

const result = await reconcileVerifiedPaidSubscription({
  db,
  subscription,
  userId: 'user-1',
  now: () => new Date('2026-10-06T10:00:00.000Z'),
})
const user = (await db.collection('users').doc('user-1').get()).data()

assert.equal(result.plan, 'plus')
assert.equal(result.billingInterval, 'monthly')
assert.equal(user.plan, 'plus')
assert.equal(user.subscriptionStatus, 'active')
assert.equal(user.stripeSubscriptionId, 'sub_legacy_basic')
assert.equal(user.stripeCustomerId, 'cus_legacy')
assert.equal(user.billingInterval, 'monthly')
assert.equal(user.plusScansUsed, 6, 'existing legacy subscription usage must not be reset')
assert.equal(user.plusScansSubscriptionId, 'sub_legacy_basic')

console.log('Billing legacy reconciliation: PASS')
