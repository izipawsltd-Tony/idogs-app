import { describe, expect, it, vi } from 'vitest'
import { createCheckoutHandler, CHECKOUT_PRICE_IDS, LEGACY_PLUS_PRICE_INTERVALS } from '../api/_lib/checkout-handler.js'
import { verifiedPaidInterval } from '../api/_lib/billing-reconcile.js'
import { promotionSessionStore } from '../api/_lib/promotion-session.js'
import { PLUS_PROMOTION_ID, PLUS_PROMOTION_START, PLUS_PROMOTION_END, isPlusPromotionActive } from '../shared/plus-promotion.js'
import { promotionEnvironment, STAGING_PLUS_MONTHLY_PRICE_ID } from '../api/_lib/promotion-environment.js'

function fixture({ time = Date.parse('2026-10-21T00:00:00Z'), profile = {}, broken = false, reuseCustomer } = {}) {
  const records = new Map([['users/synthetic-owner', profile]])
  let queue = Promise.resolve()
  const db = {
    collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }),
    runTransaction: callback => {
      const result = queue.then(() => callback({
        get: async ref => ({ exists: records.has(ref.path), data: () => records.get(ref.path) }),
        set: (ref, value) => records.set(ref.path, value),
      }))
      queue = result.catch(() => {})
      return result
    },
  }
  const createSession = vi.fn().mockResolvedValue({ id: 'cs_synthetic', url: 'https://checkout.stripe.com/synthetic' })
  const handler = createCheckoutHandler({ verifyIdToken: async () => ({ uid: 'synthetic-owner', email: 'qa@example.invalid' }),
    createSession, getAppUrl: () => 'https://staging.example.invalid', now: () => time,
    getProfile: async () => { if (broken) throw new Error('synthetic read failure'); return profile },
    canReusePromotionCustomer: reuseCustomer,
    ...promotionSessionStore(db),
  })
  const call = async (body = {}, headers = { authorization: 'Bearer synthetic' }) => {
    const result = {}
    const res = { status: status => { result.status = status; return res }, json: value => { result.body = value; return result } }
    await handler({ method: 'POST', headers, body: { plan: 'plus_monthly', promotion: PLUS_PROMOTION_ID, acceptPromotionTerms: true, ...body } }, res)
    return result
  }
  return { call, createSession, records, store: promotionSessionStore(db) }
}

describe('Plus campaign boundaries and Checkout intent (mocked Stripe and Firestore)', () => {
  it('enables Preview checkout only on the exact staging project, staging Firebase and test key', () => {
    const config = { environment: 'preview', projectId: 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o', firebaseProjectId: 'idogs-app-staging', testKey: true, liveKey: false }
    expect(promotionEnvironment(config)).toEqual({ enabled: true, prices: { plus_monthly: STAGING_PLUS_MONTHLY_PRICE_ID } })
    expect(promotionEnvironment({ ...config, testKey: false, liveKey: true }).enabled).toBe(false)
    expect(promotionEnvironment({ ...config, projectId: 'wrong-project' }).enabled).toBe(false)
    expect(promotionEnvironment({ ...config, firebaseProjectId: 'idogs-app' }).enabled).toBe(false)
    expect(promotionEnvironment({ ...config, environment: 'production', testKey: false, liveKey: true }).enabled).toBe(true)
    expect(promotionEnvironment({ ...config, environment: 'production' }).enabled).toBe(false)
  })
  it('uses the read-only verified A$7/A$70 prices and recognizes older Plus subscriptions', () => {
    expect(CHECKOUT_PRICE_IDS.plus_monthly).toBe('price_1UAInbGHgBd6ZgJE0NAikQgm')
    expect(CHECKOUT_PRICE_IDS.plus_annual).toBe('price_1UAIngGHgBd6ZgJEh3njs6hZ')
    for (const [id, interval] of Object.entries(LEGACY_PLUS_PRICE_INTERVALS)) {
      expect(verifiedPaidInterval({ status: 'trialing', items: { data: [{ price: { id } }] } })).toBe(interval)
    }
    expect(verifiedPaidInterval({ status: 'active', items: { data: [{ price: { id: 'price_forged' } }] } })).toBeNull()
  })
  it('uses Adelaide midnight after 31 January, with exclusive end', () => {
    expect(new Date(PLUS_PROMOTION_END).toISOString()).toBe('2027-01-31T13:30:00.000Z')
    expect(isPlusPromotionActive(PLUS_PROMOTION_START - 1)).toBe(false)
    expect(isPlusPromotionActive(PLUS_PROMOTION_START)).toBe(true)
    expect(isPlusPromotionActive(PLUS_PROMOTION_END - 1)).toBe(true)
    expect(isPlusPromotionActive(PLUS_PROMOTION_END)).toBe(false)
  })
  it('collects payment details, fixes trial end and reuses known monthly price; no client entitlement write', async () => {
    const f = fixture()
    expect((await f.call()).status).toBe(200)
    const [params, options] = f.createSession.mock.calls[0]
    expect(params.line_items).toEqual([{ price: CHECKOUT_PRICE_IDS.plus_monthly, quantity: 1 }])
    expect(params.payment_method_collection).toBe('always')
    expect(params.payment_method_types).toBeUndefined()
    expect(params.subscription_data.trial_end).toBe(PLUS_PROMOTION_END / 1000)
    expect(params.subscription_data.billing_cycle_anchor).toBeUndefined()
    expect(params.subscription_data.trial_settings.end_behavior.missing_payment_method).toBe('cancel')
    expect(params.custom_text.submit.message).toContain('then A$7/month from 1 February 2027')
    expect(options.idempotencyKey).toMatch(/^plus-promotion-[a-f0-9]{64}$/)
    expect(f.records.get('users/synthetic-owner')).toEqual({})
  })
  it.each([false, undefined, 'true'])('requires explicit consent (%s)', async consent => {
    const f = fixture(); expect((await f.call({ acceptPromotionTerms: consent })).status).toBe(400)
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it.each(['plus_annual', 'pro', 'invalid'])('does not turn %s into the monthly offer', async plan => {
    const f = fixture(); expect((await f.call({ plan })).status).toBe(400)
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it.each([PLUS_PROMOTION_START - 1, PLUS_PROMOTION_END - 31 * 60_000, PLUS_PROMOTION_END, PLUS_PROMOTION_END + 1])('fails closed at %s without paid fallback', async time => {
    const f = fixture({ time }); expect((await f.call()).status).toBe(409)
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it('uses a waived partial period in final 48h and expires before the billing anchor', async () => {
    const f = fixture({ time: PLUS_PROMOTION_END - 24 * 60 * 60_000 })
    expect((await f.call()).status).toBe(200)
    const [params] = f.createSession.mock.calls[0]
    expect(params.subscription_data.trial_end).toBeUndefined()
    expect(params.subscription_data.trial_settings).toBeUndefined()
    expect(params.subscription_data.billing_cycle_anchor).toBe(PLUS_PROMOTION_END / 1000)
    expect(params.subscription_data.proration_behavior).toBe('none')
    expect(params.expires_at).toBeLessThan(PLUS_PROMOTION_END / 1000)
  })
  it('uses trial at the exact 48-hour boundary', async () => {
    const f = fixture({ time: PLUS_PROMOTION_END - 48 * 60 * 60_000 }); await f.call()
    expect(f.createSession.mock.calls[0][0].subscription_data.trial_end).toBe(PLUS_PROMOTION_END / 1000)
  })
  it.each([{ stripeSubscriptionId: 'sub_synthetic' }, { stripeCustomerId: 'cus_synthetic' }, { subscriptionStatus: 'past_due' }])('blocks known existing billing accounts', async profile => {
    const f = fixture({ profile }); expect((await f.call()).status).toBe(409)
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it('requires auth, rejects mismatched user and ignores client price/customer fields', async () => {
    const f = fixture(); expect((await f.call({}, {})).status).toBe(401)
    expect((await f.call({ userId: 'someone-else' })).status).toBe(403)
    await f.call({ customer: 'cus_forged', trial_end: 9999999999, price: 'price_forged' })
    expect(f.createSession.mock.calls[0][0].customer).toBeUndefined()
    expect(f.createSession.mock.calls[0][0].subscription_data.trial_end).toBe(PLUS_PROMOTION_END / 1000)
  })
  it('reuses a trusted former Stripe customer only after provider verifies no ongoing subscriptions', async () => {
    const verify = vi.fn().mockResolvedValue(true)
    const f = fixture({ profile: { stripeCustomerId: 'cus_synthetic_former', subscriptionStatus: 'canceled' }, reuseCustomer: verify })
    expect((await f.call({ customer: 'cus_forged' })).status).toBe(200)
    expect(verify).toHaveBeenCalledWith('cus_synthetic_former')
    expect(f.createSession.mock.calls[0][0].customer).toBe('cus_synthetic_former')
    expect(f.createSession.mock.calls[0][0].customer_email).toBeUndefined()
  })
  it('does not bypass failed provider verification for a former customer', async () => {
    const f = fixture({ profile: { stripeCustomerId: 'cus_synthetic' }, reuseCustomer: vi.fn().mockRejectedValue(new Error('synthetic outage')) })
    expect((await f.call()).status).toBe(500); expect(f.createSession).not.toHaveBeenCalled()
  })
  it('fails closed on profile read failure', async () => {
    const f = fixture({ broken: true }); expect((await f.call()).status).toBe(500)
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it('reuses one persisted checkout on retry', async () => {
    const f = fixture(); const first = await f.call(); const retry = await f.call()
    expect(retry).toEqual(first); expect(f.createSession).toHaveBeenCalledOnce()
  })
  it('concurrent requests share the same attempt and Stripe idempotency key', async () => {
    const f = fixture()
    const results = await Promise.all([f.call(), f.call()])
    expect(results.every(result => result.status === 200)).toBe(true)
    const keys = f.createSession.mock.calls.map(([, options]) => options.idempotencyKey)
    expect(new Set(keys).size).toBe(1)
    expect([...f.records.keys()].filter(key => key.startsWith('plusPromotionCheckouts/'))).toHaveLength(1)
  })
  it('serializes a shared attempt and keeps its Stripe idempotency key across ambiguous errors', async () => {
    const f = fixture()
    f.createSession.mockRejectedValueOnce(new Error('synthetic ambiguous I/O'))
    expect((await f.call()).status).toBe(500)
    expect((await f.call()).status).toBe(200)
    expect(f.createSession.mock.calls[0]).toEqual(f.createSession.mock.calls[1])
  })
  it('does not replace a still-open checkout near expiry', async () => {
    const f = fixture()
    f.records.set('plusPromotionCheckouts/synthetic-owner', { createdAt: 1, expiresAt: Date.parse('2026-10-21T00:10:00Z') })
    expect((await f.call()).status).toBe(500); expect(f.createSession).not.toHaveBeenCalled()
  })
  it('does not apply offer parameters to a deliberate normal annual checkout', async () => {
    const f = fixture(); expect((await f.call({ promotion: undefined, plan: 'plus_annual' })).status).toBe(200)
    const params = f.createSession.mock.calls[0][0]
    expect(params.line_items[0].price).toBe(CHECKOUT_PRICE_IDS.plus_annual)
    expect(params.subscription_data.trial_end).toBeUndefined()
    expect(params.custom_text).toBeUndefined()
  })
})
