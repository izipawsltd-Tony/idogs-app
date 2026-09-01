import assert from 'node:assert/strict'
import { createBillingPortalHandler, createBillingSummaryHandler, resolveBillingReturnOrigin } from '../api/_lib/billing-handler.js'
import { createCheckoutHandler } from '../api/_lib/checkout-handler.js'

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

async function run(handler, req) {
  const res = response()
  await handler(req, res)
  return res
}

const auth = async token => {
  if (token !== 'valid') throw new Error('invalid')
  return { uid: 'user-1', email: 'owner@example.com' }
}

let summary = createBillingSummaryHandler({
  verifyIdToken: auth,
  getProfile: async () => ({ plan: 'free' }),
  retrieveSubscription: async () => { throw new Error('must not run') },
  listInvoices: async () => { throw new Error('must not run') },
})

let res = await run(summary, { method: 'GET', headers: {} })
assert.equal(res.statusCode, 401, 'summary requires authentication')
res = await run(summary, { method: 'POST', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 405, 'summary is GET only')
res = await run(summary, { method: 'GET', headers: { authorization: 'Bearer valid' } })
assert.deepEqual(res.body, {
  subscription: null,
  invoices: [],
  canManageBilling: false,
  sms: { configured: false, status: 'inactive', creditsUsed: 0, creditsLimit: 20, periodStart: null, periodEnd: null },
  entitlement: { plan: 'free', billingInterval: null, subscriptionStatus: null },
}, 'free account has an empty safe billing summary plus inactive SMS status')

summary = createBillingSummaryHandler({
  verifyIdToken: auth,
  getProfile: async uid => { assert.equal(uid, 'user-1'); return null },
  retrieveSubscription: async () => { throw new Error('must not run') },
  listInvoices: async () => { throw new Error('must not run') },
  isSmsConfigured: () => true,
})
res = await run(summary, { method: 'GET', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 200, 'new authenticated user without profile gets a safe empty billing summary')
assert.deepEqual(res.body, {
  subscription: null,
  invoices: [],
  canManageBilling: false,
  sms: { configured: true, status: 'inactive', creditsUsed: 0, creditsLimit: 20, periodStart: null, periodEnd: null },
  entitlement: { plan: 'free', billingInterval: null, subscriptionStatus: null },
}, 'missing profile is represented as Free/no billing/no invoices without creating Firestore state')

let reconciled = null
summary = createBillingSummaryHandler({
  verifyIdToken: auth,
  getProfile: async uid => {
    assert.equal(uid, 'user-1')
    return { plan: 'free', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active' }
  },
  retrieveSubscription: async id => ({
    id,
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: 1_800_000_000 }] },
  }),
  reconcileVerifiedPlus: async args => {
    reconciled = args
    return { plan: 'plus', billingInterval: 'monthly', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1' }
  },
  listInvoices: async params => {
    assert.deepEqual(params, { customer: 'cus_1', limit: 12 }, 'invoice query is scoped to server-owned customer id')
    return { data: [{
      id: 'in_1', number: 'IDOGS-001', status: 'paid', amount_paid: 500,
      amount_due: 500, currency: 'aud', created: 1_700_000_000,
      hosted_invoice_url: 'https://invoice.example/view', invoice_pdf: 'https://invoice.example/file.pdf',
    }] }
  },
})
res = await run(summary, { method: 'GET', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 200)
assert.equal(res.body.subscription.id, 'sub_1')
assert.equal(reconciled.userId, 'user-1', 'linked active subscription is reconciled against authenticated uid before returning summary')
assert.equal(reconciled.subscription.id, 'sub_1')
assert.deepEqual(res.body.entitlement, { plan: 'plus', billingInterval: 'monthly', subscriptionStatus: 'active' }, 'verified Stripe subscription overrides stale Free profile')
assert.equal(res.body.invoices[0].amountPaid, 500)
assert.equal(res.body.canManageBilling, true)

summary = createBillingSummaryHandler({
  verifyIdToken: auth,
  getProfile: async () => ({ stripeCustomerId: 'cus_owner', stripeSubscriptionId: 'sub_wrong' }),
  retrieveSubscription: async () => ({ id: 'sub_wrong', customer: 'cus_other', status: 'active' }),
  listInvoices: async () => ({ data: [] }),
  reconcileVerifiedPlus: async () => { throw new Error('must not reconcile mismatch') },
})
res = await run(summary, { method: 'GET', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 409, 'customer mismatch fails closed before reconciliation')

let capturedPortalParams = null
const portal = createBillingPortalHandler({
  verifyIdToken: auth,
  getProfile: async () => ({ stripeCustomerId: 'cus_1' }),
  createPortalSession: async params => { capturedPortalParams = params; return { url: 'https://billing.stripe.com/session/test' } },
  getAppUrl: () => 'https://idogs-app-staging.vercel.app',
})
res = await run(portal, { method: 'POST', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 200)
assert.deepEqual(capturedPortalParams, { customer: 'cus_1', return_url: 'https://idogs-app-staging.vercel.app/app/billing' }, 'portal returns to Billing')

assert.equal(
  resolveBillingReturnOrigin(() => null, {
    VERCEL_ENV: 'preview', FIREBASE_PROJECT_ID: 'idogs-app-staging',
    VERCEL_URL: 'idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app',
  }),
  'https://idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app',
  'verified staging Preview host is accepted as fallback return origin',
)
assert.equal(
  resolveBillingReturnOrigin(() => null, {
    VERCEL_ENV: 'preview', FIREBASE_PROJECT_ID: 'idogs-app-staging', VERCEL_URL: 'evil-example.vercel.app',
  }),
  null,
  'arbitrary Preview-like hosts fail closed',
)
assert.equal(
  resolveBillingReturnOrigin(() => null, {
    VERCEL_ENV: 'production', FIREBASE_PROJECT_ID: 'idogs-app-staging',
    VERCEL_URL: 'idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app',
  }),
  null,
  'Preview fallback is never enabled for stable staging or production targets',
)

capturedPortalParams = null
const previewPortal = createBillingPortalHandler({
  verifyIdToken: auth,
  getProfile: async () => ({ stripeCustomerId: 'cus_1' }),
  createPortalSession: async params => { capturedPortalParams = params; return { url: 'https://billing.stripe.com/session/preview' } },
  getAppUrl: () => null,
  env: {
    VERCEL_ENV: 'preview', FIREBASE_PROJECT_ID: 'idogs-app-staging',
    VERCEL_URL: 'idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app',
  },
})
res = await run(previewPortal, { method: 'POST', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 200, 'Preview portal works with verified Vercel fallback')
assert.deepEqual(capturedPortalParams, { customer: 'cus_1', return_url: 'https://idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app/app/billing' })

const noCustomerPortal = createBillingPortalHandler({
  verifyIdToken: auth,
  getProfile: async () => ({ plan: 'free' }),
  createPortalSession: async () => { throw new Error('must not run') },
  getAppUrl: () => 'https://idogs-app-staging.vercel.app',
})
res = await run(noCustomerPortal, { method: 'POST', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 409, 'portal is unavailable without a linked Stripe customer')

let checkoutCreated = false
const duplicateCheckout = createCheckoutHandler({
  verifyIdToken: auth,
  getProfile: async () => ({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', plan: 'free' }),
  retrieveSubscription: async id => ({ id, customer: 'cus_1', status: 'active' }),
  isVerifiedActivePlus: sub => sub.status === 'active',
  createSession: async () => { checkoutCreated = true; return { url: 'https://checkout.example' } },
  getAppUrl: () => 'https://idogs.com.au',
})
res = await run(duplicateCheckout, {
  method: 'POST', headers: { authorization: 'Bearer valid' }, body: { plan: 'plus_monthly' },
})
assert.equal(res.statusCode, 409, 'active linked Plus blocks duplicate checkout even when profile.plan is stale Free')
assert.equal(checkoutCreated, false, 'duplicate guard prevents a second Checkout session')

console.log('Billing & Payments integration: PASS')
