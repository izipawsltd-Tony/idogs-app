import { afterEach, expect, it, vi } from 'vitest'
import { createBillingSummaryHandler } from '../api/_lib/billing-handler.js'

afterEach(() => vi.restoreAllMocks())
for (const [error, diagnostic] of [
  [Object.assign(new Error('private provider payload'), { code: 'resource_missing' }), 'resource_missing'],
  [Object.assign(new Error('private credential payload'), { type: 'StripeAuthenticationError' }), 'stripe_authentication_error'],
  [Object.assign(new Error('private URL payload'), { code: 'unknown_private_value' }), 'unclassified'],
]) it(`billing summary logs only fixed phase and ${diagnostic}`, async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const handler = createBillingSummaryHandler({
    verifyIdToken: async () => ({ uid: 'synthetic' }),
    getProfile: async () => ({ stripeCustomerId: 'cus_synthetic', stripeSubscriptionId: 'sub_synthetic' }),
    retrieveSubscription: async () => { throw error },
  })
  const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'GET', headers: { authorization: 'Bearer synthetic' } }, res)
  expect(res.code).toBe(500)
  expect(res.body).toEqual({ error: 'Failed to load billing details' })
  expect(log).toHaveBeenCalledWith('billing-summary: operation failed', {
    code: 'BILLING_SUMMARY_FAILED', message: 'subscription', stripeCode: diagnostic,
  })
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|cus_synthetic|sub_synthetic|Bearer/)
})
