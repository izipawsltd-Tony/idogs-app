import assert from 'node:assert/strict'
import {
  createCheckoutHandler,
  CHECKOUT_PRICE_IDS,
  LIVE_GST_TAX_RATE_ID,
  STAGING_GST_TAX_RATE_ID,
  checkoutTaxRatesForCurrentEnvironment,
} from '../api/_lib/checkout-handler.js'
import { createSmsAddonCheckoutHandler, createSmsAddonRemoveHandler } from '../api/_lib/sms-checkout-handler.js'

function res() {
  return { statusCode: 200, body: null, status(n) { this.statusCode = n; return this }, json(v) { this.body = v; return this } }
}

assert.deepEqual(checkoutTaxRatesForCurrentEnvironment({ FIREBASE_PROJECT_ID: 'idogs-app-staging' }), [STAGING_GST_TAX_RATE_ID])
assert.deepEqual(checkoutTaxRatesForCurrentEnvironment({ FIREBASE_PROJECT_ID: 'idogs-app' }), [LIVE_GST_TAX_RATE_ID])
console.log('PASS environment selects existing staging/live inclusive GST rate')

const oldProject = process.env.FIREBASE_PROJECT_ID
process.env.FIREBASE_PROJECT_ID = 'idogs-app'
try {
  let checkoutParams
  const checkout = createCheckoutHandler({
    getAppUrl: () => 'https://idogs.com.au',
    verifyIdToken: async () => ({ uid: 'u1', email: 'u1@example.com' }),
    createSession: async p => { checkoutParams = p; return { url: 'https://checkout.test' } },
  })
  const checkoutRes = res()
  await checkout({ method: 'POST', headers: { authorization: 'Bearer token' }, body: { plan: 'plus_monthly' } }, checkoutRes)
  assert.equal(checkoutRes.statusCode, 200)
  assert.deepEqual(checkoutParams.subscription_data.default_tax_rates, [LIVE_GST_TAX_RATE_ID])
  console.log('PASS new Plus Checkout carries live inclusive GST default tax rate')

  const profile = {
    plan: 'plus', subscriptionStatus: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
  }
  const baseSubscription = {
    id: 'sub_1', customer: 'cus_1', items: { data: [{ id: 'si_plus', price: { id: CHECKOUT_PRICE_IDS.plus_monthly } }] },
  }
  let addUpdate
  const add = createSmsAddonCheckoutHandler({
    verifyIdToken: async () => ({ uid: 'u1' }),
    getProfile: async () => profile,
    retrieveSubscription: async () => baseSubscription,
    updateSubscription: async (_id, params) => { addUpdate = params; return { latest_invoice: {} } },
    getPriceId: () => 'price_sms_3',
  })
  const addRes = res()
  await add({ method: 'POST', headers: { authorization: 'Bearer token' }, body: {} }, addRes)
  assert.equal(addRes.statusCode, 200)
  assert.deepEqual(addUpdate.default_tax_rates, [LIVE_GST_TAX_RATE_ID])
  assert.equal(addUpdate.proration_behavior, 'always_invoice')
  console.log('PASS SMS add-on proration restores live inclusive GST default tax rate')

  let removeUpdate
  const remove = createSmsAddonRemoveHandler({
    verifyIdToken: async () => ({ uid: 'u1' }),
    getProfile: async () => profile,
    retrieveSubscription: async () => ({
      ...baseSubscription,
      items: { data: [...baseSubscription.items.data, { id: 'si_sms', price: { id: 'price_sms_3' } }] },
    }),
    updateSubscription: async (_id, params) => { removeUpdate = params; return {} },
    getPriceId: () => 'price_sms_3',
  })
  const removeRes = res()
  await remove({ method: 'POST', headers: { authorization: 'Bearer token' }, body: {} }, removeRes)
  assert.equal(removeRes.statusCode, 200)
  assert.deepEqual(removeUpdate.default_tax_rates, [LIVE_GST_TAX_RATE_ID])
  assert.equal(removeUpdate.proration_behavior, 'always_invoice')
  console.log('PASS SMS removal proration keeps live inclusive GST default tax rate')
} finally {
  if (oldProject === undefined) delete process.env.FIREBASE_PROJECT_ID
  else process.env.FIREBASE_PROJECT_ID = oldProject
}

console.log('\nGST parity: 4/4 PASS')
