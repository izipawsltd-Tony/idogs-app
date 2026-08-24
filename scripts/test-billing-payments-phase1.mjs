import assert from 'node:assert/strict'
import { createBillingPortalHandler, createBillingSummaryHandler } from '../api/_lib/billing-handler.js'

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
  sms: {
    configured: false,
    status: 'inactive',
    creditsUsed: 0,
    creditsLimit: 20,
    periodStart: null,
    periodEnd: null,
  },
}, 'free account has an empty safe billing summary plus inactive SMS status')

summary = createBillingSummaryHandler({
  verifyIdToken: auth,
  getProfile: async uid => {
    assert.equal(uid, 'user-1')
    return { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active' }
  },
  retrieveSubscription: async id => {
    assert.equal(id, 'sub_1')
    return {
      id,
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ current_period_end: 1_800_000_000 }] },
    }
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
assert.equal(res.body.invoices[0].amountPaid, 500)
assert.equal(res.body.canManageBilling, true)
assert.deepEqual(res.body.sms, {
  configured: false,
  status: 'inactive',
  creditsUsed: 0,
  creditsLimit: 20,
  periodStart: null,
  periodEnd: null,
}, 'linked billing account still receives a safe inactive SMS summary when SMS price is not configured')

summary = createBillingSummaryHandler({
  verifyIdToken: auth,
  getProfile: async () => ({ stripeCustomerId: 'cus_owner', stripeSubscriptionId: 'sub_wrong' }),
  retrieveSubscription: async () => ({ id: 'sub_wrong', customer: 'cus_other', status: 'active' }),
  listInvoices: async () => ({ data: [] }),
})
res = await run(summary, { method: 'GET', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 409, 'customer mismatch fails closed')

let capturedPortalParams = null
const portal = createBillingPortalHandler({
  verifyIdToken: auth,
  getProfile: async () => ({ stripeCustomerId: 'cus_1' }),
  createPortalSession: async params => {
    capturedPortalParams = params
    return { url: 'https://billing.stripe.com/session/test' }
  },
  getAppUrl: () => 'https://idogs-app-staging.vercel.app',
})
res = await run(portal, { method: 'POST', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 200)
assert.equal(res.body.url, 'https://billing.stripe.com/session/test')
assert.deepEqual(capturedPortalParams, {
  customer: 'cus_1',
  return_url: 'https://idogs-app-staging.vercel.app/app/billing',
}, 'portal customer comes from server profile and returns to Billing')

const noCustomerPortal = createBillingPortalHandler({
  verifyIdToken: auth,
  getProfile: async () => ({ plan: 'free' }),
  createPortalSession: async () => { throw new Error('must not run') },
  getAppUrl: () => 'https://idogs-app-staging.vercel.app',
})
res = await run(noCustomerPortal, { method: 'POST', headers: { authorization: 'Bearer valid' } })
assert.equal(res.statusCode, 409, 'portal is unavailable without a linked Stripe customer')

console.log('Billing & Payments Phase 1: 11/11 PASS')
