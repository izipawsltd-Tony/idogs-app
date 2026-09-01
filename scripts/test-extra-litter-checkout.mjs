import { makeChecker } from './_lib/test-check.mjs'
import { createExtraLitterCheckoutHandler } from '../api/_lib/extra-litter-checkout-handler.js'
import { LIVE_CHECKOUT_PRICE_IDS, LIVE_GST_TAX_RATE_ID } from '../api/_lib/checkout-handler.js'

const { check, checkAsync, summary } = makeChecker()

function resCapture() {
  const result = { statusCode: null, body: null }
  return {
    result,
    status(code) { result.statusCode = code; return this },
    json(body) { result.body = body; return this },
  }
}

function req(body = {}, token = 'good') {
  return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body }
}

const profile = {
  plan: 'plus',
  subscriptionStatus: 'active',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  breederIdType: 'DACO_SA',
  breederIdValue: 'DACO123',
  email: 'breeder@example.com',
}
const subscription = {
  id: 'sub_1', status: 'active', customer: 'cus_1', livemode: true,
  items: { data: [{ price: { id: LIVE_CHECKOUT_PRICE_IDS.plus_monthly } }] },
}
const eligible = async () => ({ includedExhausted: true, availableCredits: 0 })

await checkAsync('finance gate returns 503 and never creates Stripe session', async () => {
  let createCalls = 0
  const handler = createExtraLitterCheckoutHandler({
    verifyIdToken: async () => ({ uid: 'u1', email: 'breeder@example.com' }),
    getProfile: async () => profile,
    retrieveSubscription: async () => subscription,
    getPurchaseEligibility: eligible,
    createSession: async () => { createCalls += 1; return { url: 'https://stripe.example' } },
    getAppUrl: () => 'https://preview.example',
    isEnabled: () => false,
  })
  const res = resCapture()
  await handler(req({ requestId: '1234567890123456' }), res)
  return res.result.statusCode === 503 && res.result.body?.code === 'EXTRA_LITTER_CHECKOUT_DISABLED' && createCalls === 0
})

await checkAsync('client cannot override price/user/profile fields', async () => {
  const handler = createExtraLitterCheckoutHandler({
    verifyIdToken: async () => ({ uid: 'u1', email: 'breeder@example.com' }),
    getProfile: async () => profile,
    retrieveSubscription: async () => subscription,
    getPurchaseEligibility: eligible,
    createSession: async () => ({ url: 'https://stripe.example' }),
    getAppUrl: () => 'https://preview.example',
    isEnabled: () => true,
  })
  const res = resCapture()
  await handler(req({ requestId: '1234567890123456', priceId: 'price_attacker' }), res)
  return res.result.statusCode === 400
})

await checkAsync('Free account cannot buy Extra Litter credit', async () => {
  const handler = createExtraLitterCheckoutHandler({
    verifyIdToken: async () => ({ uid: 'u1', email: 'breeder@example.com' }),
    getProfile: async () => ({ ...profile, plan: 'free' }),
    retrieveSubscription: async () => subscription,
    getPurchaseEligibility: eligible,
    createSession: async () => ({ url: 'https://stripe.example' }),
    getAppUrl: () => 'https://preview.example',
    isEnabled: () => true,
  })
  const res = resCapture()
  await handler(req({ requestId: '1234567890123456' }), res)
  return res.result.statusCode === 403
})

await checkAsync('cannot buy while an included litter slot remains', async () => {
  let createCalls = 0
  const handler = createExtraLitterCheckoutHandler({
    verifyIdToken: async () => ({ uid: 'u1', email: 'breeder@example.com' }),
    getProfile: async () => profile,
    retrieveSubscription: async () => subscription,
    getPurchaseEligibility: async () => ({ includedExhausted: false, availableCredits: 0 }),
    createSession: async () => { createCalls += 1; return { url: 'https://stripe.example' } },
    getAppUrl: () => 'https://preview.example',
    isEnabled: () => true,
  })
  const res = resCapture()
  await handler(req({ requestId: '1234567890123456' }), res)
  return res.result.statusCode === 409 && res.result.body?.code === 'INCLUDED_LITTERS_REMAIN' && createCalls === 0
})

await checkAsync('cannot buy another credit while one is unused', async () => {
  let createCalls = 0
  const handler = createExtraLitterCheckoutHandler({
    verifyIdToken: async () => ({ uid: 'u1', email: 'breeder@example.com' }),
    getProfile: async () => profile,
    retrieveSubscription: async () => subscription,
    getPurchaseEligibility: async () => ({ includedExhausted: true, availableCredits: 1 }),
    createSession: async () => { createCalls += 1; return { url: 'https://stripe.example' } },
    getAppUrl: () => 'https://preview.example',
    isEnabled: () => true,
  })
  const res = resCapture()
  await handler(req({ requestId: '1234567890123456' }), res)
  return res.result.statusCode === 409 && res.result.body?.code === 'EXTRA_LITTER_CREDIT_AVAILABLE' && createCalls === 0
})

await checkAsync('valid exhausted-quota request creates fixed A$39 AUD GST-inclusive one-time Checkout', async () => {
  let capturedParams = null
  let capturedOptions = null
  const handler = createExtraLitterCheckoutHandler({
    verifyIdToken: async () => ({ uid: 'u1', email: 'breeder@example.com' }),
    getProfile: async () => profile,
    retrieveSubscription: async () => subscription,
    getPurchaseEligibility: eligible,
    createSession: async (params, options) => {
      capturedParams = params
      capturedOptions = options
      return { url: 'https://checkout.stripe.example/session' }
    },
    getAppUrl: () => 'https://preview.example',
    isEnabled: () => true,
  })
  const res = resCapture()
  await handler(req({ requestId: 'request_1234567890' }), res)
  const line = capturedParams?.line_items?.[0]
  return res.result.statusCode === 200 &&
    capturedParams?.mode === 'payment' &&
    capturedParams?.customer === 'cus_1' &&
    line?.price_data?.currency === 'aud' &&
    line?.price_data?.unit_amount === 3900 &&
    line?.price_data?.tax_behavior === 'inclusive' &&
    line?.tax_rates?.[0] === LIVE_GST_TAX_RATE_ID &&
    capturedParams?.metadata?.purchaseType === 'extra_litter' &&
    /^bp_[a-f0-9]{32}$/.test(capturedParams?.metadata?.breederProfileId || '') &&
    capturedOptions?.idempotencyKey === 'extra-litter:u1:request_1234567890'
})

check('test fixture still targets A$7 live Plus price', subscription.items.data[0].price.id === LIVE_CHECKOUT_PRICE_IDS.plus_monthly)

await summary()
