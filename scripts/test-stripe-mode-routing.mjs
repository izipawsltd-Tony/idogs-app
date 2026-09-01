import assert from 'node:assert/strict'
import {
  LIVE_CHECKOUT_PRICE_IDS,
  STAGING_CHECKOUT_PRICE_IDS,
  LIVE_GST_TAX_RATE_ID,
  STAGING_GST_TAX_RATE_ID,
  checkoutPriceIdsForStripeMode,
  checkoutTaxRatesForStripeMode,
} from '../api/_lib/checkout-handler.js'
import { verifiedPlusInterval } from '../api/_lib/billing-reconcile.js'
import { createSmsAddonCheckoutHandler } from '../api/_lib/sms-checkout-handler.js'

assert.equal(checkoutPriceIdsForStripeMode(true).plus_monthly, LIVE_CHECKOUT_PRICE_IDS.plus_monthly)
assert.equal(checkoutPriceIdsForStripeMode(false).plus_annual, STAGING_CHECKOUT_PRICE_IDS.plus_annual)
assert.deepEqual(checkoutTaxRatesForStripeMode(true), [LIVE_GST_TAX_RATE_ID])
assert.deepEqual(checkoutTaxRatesForStripeMode(false), [STAGING_GST_TAX_RATE_ID])

const liveMonthly = {
  id: 'sub_live',
  livemode: true,
  status: 'active',
  customer: 'cus_live',
  items: { data: [{ price: { id: LIVE_CHECKOUT_PRICE_IDS.plus_monthly } }] },
}
const liveWithTestPrice = {
  ...liveMonthly,
  items: { data: [{ price: { id: STAGING_CHECKOUT_PRICE_IDS.plus_monthly } }] },
}
const testAnnual = {
  id: 'sub_test',
  livemode: false,
  status: 'active',
  customer: 'cus_test',
  items: { data: [{ price: { id: STAGING_CHECKOUT_PRICE_IDS.plus_annual } }] },
}

assert.equal(verifiedPlusInterval(liveMonthly), 'monthly', 'live Stripe subscription resolves live Plus price independent of Firebase env')
assert.equal(verifiedPlusInterval(liveWithTestPrice), null, 'live Stripe subscription never accepts test-mode Plus price')
assert.equal(verifiedPlusInterval(testAnnual), 'annual', 'test Stripe subscription resolves test annual Plus price')

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

let updateParams = null
const smsHandler = createSmsAddonCheckoutHandler({
  verifyIdToken: async () => ({ uid: 'user-live' }),
  getProfile: async () => ({
    plan: 'plus',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_live',
    stripeSubscriptionId: 'sub_live',
  }),
  retrieveSubscription: async () => liveMonthly,
  updateSubscription: async (_id, params) => {
    updateParams = params
    return { latest_invoice: null }
  },
  getPriceId: () => 'price_sms_live',
})

const req = { method: 'POST', headers: { authorization: 'Bearer valid' }, body: {} }
const res = response()
await smsHandler(req, res)
assert.equal(res.statusCode, 200, 'live Plus subscription passes SMS guard')
assert.deepEqual(updateParams.default_tax_rates, [LIVE_GST_TAX_RATE_ID], 'live SMS update uses live GST rate from Stripe mode')
assert.equal(updateParams.payment_behavior, 'error_if_incomplete')
assert.equal(updateParams.proration_behavior, 'always_invoice')

console.log('Stripe mode routing: 10/10 PASS')
