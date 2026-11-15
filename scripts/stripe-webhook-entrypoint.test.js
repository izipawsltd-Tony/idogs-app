import { Readable } from 'node:stream'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  type: '',
  collection: vi.fn(() => { throw new Error('Unexpected post-core entitlement write') }),
  retrieve: vi.fn(() => { throw new Error('Unexpected post-core subscription retrieval') }),
}))

// The core already decides ordering/customer/subscription isolation. A second
// unfenced writer must never override its stale-event no-op. This exercises
// the real entrypoint with a mocked core, not actual webhook delivery.
vi.mock('stripe', () => ({ default: class {
  subscriptions = { retrieve: state.retrieve }
  webhooks = { constructEvent: () => ({
    type: state.type,
    created: 100,
    data: { object: { id: 'sub_synthetic', subscription: 'sub_synthetic', customer: 'cus_synthetic', metadata: { userId: 'synthetic' }, status: 'active', items: { data: [{ price: { id: 'price_1U9YwuGHgBd6ZgJEX1Bdjz5x' } }] } } },
  }) }
} }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: state.collection }) }))
vi.mock('../api/_lib/webhook-handler.js', () => ({ createWebhookHandler: () => async () => ({ status: 200, body: { received: true } }) }))
vi.mock('../api/_lib/extra-litter-webhook.js', () => ({ grantExtraLitterCreditFromVerifiedEvent: async () => {} }))

it.each(['customer.subscription.created', 'customer.subscription.updated', 'checkout.session.completed', 'invoice.paid', 'invoice.payment_succeeded'])('preserves the core stale/superseded-event decision for %s', async type => {
  state.type = type
  const { default: handler } = await import('../api/stripe-webhook.js')
  const req = Readable.from([Buffer.from('{}')])
  req.method = 'POST'
  req.headers = { 'stripe-signature': 'synthetic' }
  const result = {}
  const res = { status(code) { result.status = code; return this }, json(body) { result.body = body; return this } }
  await handler(req, res)
  expect(result).toEqual({ status: 200, body: { received: true } })
  expect(state.collection).not.toHaveBeenCalled()
  expect(state.retrieve).not.toHaveBeenCalled()
})
