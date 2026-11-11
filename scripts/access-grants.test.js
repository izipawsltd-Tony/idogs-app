import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FOUNDING_OFFER, GIFT_OFFER, addMonthsUTC, extendedGrantExpiryMs, hasValidAccessGrant,
} from '../shared/access-grants.js'
import { computeEffectivePlan, hasValidInternalEntitlement } from '../api/_lib/entitlements.js'
import { createFoundingCheckoutHandler } from '../api/_lib/founding-checkout-handler.js'
import { grantFoundingFromVerifiedEvent } from '../api/_lib/founding-webhook.js'
import { createGiftRedeemHandler, giftCodeMatches } from '../api/_lib/gift-redeem-handler.js'
import { getEffectivePlanClient } from '../src/lib/utils'

const NOW = Date.parse('2026-11-20T00:00:00Z')
const iso = ms => new Date(ms).toISOString()

// Minimal in-memory Firestore with serial transactions.
function fakeDb(initial = {}) {
  const store = new Map(Object.entries(initial))
  const ref = (col, id) => ({ id, path: `${col}/${id}` })
  const snap = r => ({ exists: store.has(r.path), data: () => store.get(r.path) })
  const db = {
    store,
    collection: col => ({ doc: id => ref(col, id) }),
    runTransaction: async fn => {
      const writes = []
      const tx = {
        get: async r => snap(r),
        set: (r, data, opts) => writes.push([r, data, opts]),
      }
      const out = await fn(tx)
      for (const [r, data, opts] of writes) store.set(r.path, opts?.merge ? { ...(store.get(r.path) || {}), ...data } : data)
      return out
    },
  }
  return db
}

function mockRes() {
  const r = { statusCode: 0, body: undefined, headers: {} }
  r.status = c => { r.statusCode = c; return r }
  r.json = b => { r.body = b; return r }
  r.setHeader = (k, v) => { r.headers[k] = v }
  return r
}

const authed = body => ({ method: 'POST', headers: { authorization: 'Bearer t' }, body })

afterEach(() => { vi.unstubAllEnvs() })

describe('grant math', () => {
  it('adds calendar months and clamps month ends', () => {
    expect(iso(addMonthsUTC(Date.parse('2026-11-20T00:00:00Z'), 15))).toBe('2028-02-20T00:00:00.000Z')
    expect(iso(addMonthsUTC(Date.parse('2027-01-31T10:00:00Z'), 1))).toBe('2027-02-28T10:00:00.000Z')
  })
  it('stacks on a valid grant, restarts after expiry, never shortens', () => {
    const live = { granted: true, kind: 'gift', expiresAt: '2027-06-01T00:00:00.000Z' }
    expect(iso(extendedGrantExpiryMs(live, 15, NOW))).toBe('2028-09-01T00:00:00.000Z')
    const expired = { ...live, expiresAt: '2026-01-01T00:00:00.000Z' }
    expect(iso(extendedGrantExpiryMs(expired, 12, NOW))).toBe('2027-11-20T00:00:00.000Z')
  })
  it('fails closed on malformed grants', () => {
    for (const accessGrant of [null, {}, { granted: true, kind: 'gift' }, { granted: true, kind: 'other', expiresAt: '2030-01-01T00:00:00Z' },
      { granted: false, kind: 'gift', expiresAt: '2030-01-01T00:00:00Z' }, { granted: true, kind: 'gift', expiresAt: 'garbage' },
      { granted: true, kind: 'gift', expiresAt: 1893456000000 }]) {
      expect(hasValidAccessGrant({ accessGrant }, NOW)).toBe(false)
    }
    expect(hasValidAccessGrant({ accessGrant: { granted: true, kind: 'founding', expiresAt: '2027-01-01T00:00:00Z' } }, NOW)).toBe(true)
  })
})

describe('effective plan', () => {
  const profile = { plan: 'free', accessGrant: { granted: true, kind: 'gift', offerId: GIFT_OFFER.id, expiresAt: '2027-11-20T00:00:00.000Z' } }
  it('ignores grants until IDOGS_ACCESS_GRANTS_ENABLED=true (rules must be deployed first)', () => {
    vi.stubEnv('IDOGS_ACCESS_GRANTS_ENABLED', '')
    expect(computeEffectivePlan(profile, new Date(NOW))).toBe('free')
    vi.stubEnv('IDOGS_ACCESS_GRANTS_ENABLED', 'true')
    expect(computeEffectivePlan(profile, new Date(NOW))).toBe('plus')
    expect(computeEffectivePlan(profile, new Date('2027-11-20T00:00:01Z'))).toBe('free')
  })
  it('never turns a grant into the unlimited Super Admin bypass', () => {
    vi.stubEnv('IDOGS_ACCESS_GRANTS_ENABLED', 'true')
    expect(hasValidInternalEntitlement(profile, new Date(NOW))).toBe(false)
  })
  it('client display honours a valid grant', () => {
    expect(getEffectivePlanClient(profile, new Date(NOW))).toBe('plus')
    expect(getEffectivePlanClient({ plan: 'free' }, new Date(NOW))).toBe('free')
  })
})

describe('founding checkout', () => {
  const deps = (over = {}) => ({
    verifyIdToken: async () => ({ uid: 'u1', email: 'a@b.co' }),
    getProfile: async () => ({ plan: 'free' }),
    getSeatsSold: async () => 3,
    getTaxProductId: async () => 'prod_plus',
    createSession: vi.fn(async () => ({ url: 'https://checkout.stripe.com/x' })),
    getAppUrl: () => 'https://idogs.com.au',
    isEnabled: () => true,
    now: () => NOW,
    ...over,
  })
  const body = { requestId: 'abcdefghijklmnop1234', acceptTerms: true }

  it('is closed by default (finance gate)', async () => {
    const res = mockRes()
    await createFoundingCheckoutHandler(deps({ isEnabled: undefined }))(authed(body), res)
    expect(res.statusCode).toBe(503)
  })
  it('requires accepted terms and a valid request id', async () => {
    const d = deps()
    let res = mockRes(); await createFoundingCheckoutHandler(d)(authed({ ...body, acceptTerms: false }), res)
    expect(res.statusCode).toBe(400)
    res = mockRes(); await createFoundingCheckoutHandler(d)(authed({ ...body, requestId: 'x' }), res)
    expect(res.statusCode).toBe(400)
    res = mockRes(); await createFoundingCheckoutHandler(d)(authed({ ...body, priceCents: 1 }), res)
    expect(res.statusCode).toBe(400)
    expect(d.createSession).not.toHaveBeenCalled()
  })
  it('refuses outside the sales window, when sold out, or on top of a subscription', async () => {
    for (const [over, code] of [
      [{ now: () => FOUNDING_OFFER.salesEnd }, 'FOUNDING_OFFER_CLOSED'],
      [{ getSeatsSold: async () => FOUNDING_OFFER.seats }, 'FOUNDING_SOLD_OUT'],
      [{ getProfile: async () => ({ plan: 'plus', subscriptionStatus: 'trialing', stripeSubscriptionId: 'sub_1' }) }, 'FOUNDING_HAS_SUBSCRIPTION'],
    ]) {
      const d = deps(over); const res = mockRes()
      await createFoundingCheckoutHandler(d)(authed(body), res)
      expect(res.statusCode).toBe(409)
      expect(res.body.code).toBe(code)
      expect(d.createSession).not.toHaveBeenCalled()
    }
  })
  it('creates a one-off GST-inclusive A$49 payment session, never a subscription', async () => {
    const d = deps(); const res = mockRes()
    await createFoundingCheckoutHandler(d)(authed(body), res)
    expect(res.statusCode).toBe(200)
    const [params, opts] = d.createSession.mock.calls[0]
    expect(params.mode).toBe('payment')
    expect(params.subscription_data).toBeUndefined()
    expect(params.automatic_tax).toEqual({ enabled: true })
    expect(params.line_items).toEqual([{ price_data: { currency: 'aud', unit_amount: 4900, tax_behavior: 'inclusive', product: 'prod_plus' }, quantity: 1 }])
    expect(params.metadata).toEqual({ purchaseType: 'founding_member', userId: 'u1', offerId: FOUNDING_OFFER.id })
    expect(params.client_reference_id).toBe('u1')
    expect(opts.idempotencyKey).toBe('founding:u1:abcdefghijklmnop1234')
  })
})

describe('founding webhook', () => {
  const event = (over = {}) => ({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', mode: 'payment', payment_status: 'paid', currency: 'aud', amount_total: 4900, client_reference_id: 'u1', livemode: false,
      metadata: { purchaseType: 'founding_member', userId: 'u1', offerId: FOUNDING_OFFER.id }, ...over } },
  })

  it('grants 15 months once, even if Stripe redelivers', async () => {
    const db = fakeDb({ 'users/u1': { plan: 'free' } })
    const out = await grantFoundingFromVerifiedEvent({ db, event: event(), now: () => NOW })
    expect(out.grantedUntil).toBe('2028-02-20T00:00:00.000Z')
    expect(db.store.get('users/u1').accessGrant).toMatchObject({ granted: true, kind: 'founding', expiresAt: '2028-02-20T00:00:00.000Z', lastSourceId: 'cs_1' })
    expect(db.store.get(`accessGrantCounters/${FOUNDING_OFFER.id}`).count).toBe(1)
    const again = await grantFoundingFromVerifiedEvent({ db, event: event(), now: () => NOW + 1000 })
    expect(again.duplicate).toBe(true)
    expect(db.store.get(`accessGrantCounters/${FOUNDING_OFFER.id}`).count).toBe(1)
    expect(db.store.get('users/u1').accessGrant.expiresAt).toBe('2028-02-20T00:00:00.000Z')
  })
  it('stacks on an existing gift', async () => {
    const db = fakeDb({ 'users/u1': { accessGrant: { granted: true, kind: 'gift', expiresAt: '2027-11-20T00:00:00.000Z' } } })
    await grantFoundingFromVerifiedEvent({ db, event: event(), now: () => NOW })
    expect(db.store.get('users/u1').accessGrant.expiresAt).toBe('2029-02-20T00:00:00.000Z')
  })
  it('ignores other events, waits for unpaid async payments, rejects tampered sessions', async () => {
    const db = fakeDb({ 'users/u1': {} })
    expect(await grantFoundingFromVerifiedEvent({ db, event: { type: 'checkout.session.completed', data: { object: { metadata: {} } } } })).toEqual({ handled: false })
    expect((await grantFoundingFromVerifiedEvent({ db, event: event({ payment_status: 'unpaid' }) })).pending).toBe(true)
    for (const over of [{ amount_total: 100 }, { currency: 'usd' }, { mode: 'subscription' }, { client_reference_id: 'u2' }]) {
      await expect(grantFoundingFromVerifiedEvent({ db, event: event(over) })).rejects.toThrow('INVALID_FOUNDING_CHECKOUT')
    }
    expect(db.store.get('users/u1').accessGrant).toBeUndefined()
  })
})

describe('gift redemption', () => {
  const CODE = 'PUPPY-GIFT-2026'
  const handler = (db, over = {}) => createGiftRedeemHandler({
    verifyIdToken: async () => ({ uid: 'u1', email_verified: true }),
    db,
    getConfiguredCode: () => CODE,
    isEnabled: () => true,
    now: () => NOW,
    ...over,
  })

  it('matches codes ignoring case, spaces and dashes, and rejects short configs', () => {
    expect(giftCodeMatches('puppy gift 2026', CODE)).toBe(true)
    expect(giftCodeMatches('PUPPYGIFT2025', CODE)).toBe(false)
    expect(giftCodeMatches('abc', 'abc')).toBe(false)
  })
  it('is closed by default and requires a verified identity', async () => {
    const db = fakeDb({ 'users/u1': {} })
    let res = mockRes(); await handler(db, { isEnabled: undefined })(authed({ code: CODE }), res)
    expect(res.statusCode).toBe(503)
    res = mockRes(); await handler(db, { verifyIdToken: async () => ({ uid: 'u1', email_verified: false }) })(authed({ code: CODE }), res)
    expect(res.statusCode).toBe(403)
  })
  it('grants 12 months to a phone-only buyer, once per account', async () => {
    const db = fakeDb({ 'users/u1': { plan: 'free' } })
    const h = handler(db, { verifyIdToken: async () => ({ uid: 'u1', phone_number: '+61400000000' }) })
    let res = mockRes(); await h(authed({ code: 'puppy-gift-2026' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, grantedUntil: '2027-11-20T00:00:00.000Z', hasSubscription: false })
    expect(db.store.get('users/u1').accessGrant).toMatchObject({ kind: 'gift', offerId: GIFT_OFFER.id })
    res = mockRes(); await h(authed({ code: CODE }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('GIFT_ALREADY_CLAIMED')
    expect(db.store.get(`accessGrantCounters/${GIFT_OFFER.id}`).count).toBe(1)
  })
  it('rejects wrong codes, extra fields, sold-out campaigns and rate-limited callers without writing', async () => {
    const db = fakeDb({ 'users/u1': {}, [`accessGrantCounters/${GIFT_OFFER.id}`]: { count: GIFT_OFFER.maxRedemptions } })
    let res = mockRes(); await handler(db)(authed({ code: 'WRONGCODE1' }), res)
    expect(res.body.code).toBe('GIFT_CODE_INVALID')
    res = mockRes(); await handler(db)(authed({ code: CODE, months: 99 }), res)
    expect(res.statusCode).toBe(400)
    res = mockRes(); await handler(db)(authed({ code: CODE }), res)
    expect(res.body.code).toBe('GIFT_SOLD_OUT')
    res = mockRes(); await handler(db, { checkRateLimit: async () => ({ allowed: false, retryAfterSeconds: 30 }) })(authed({ code: CODE }), res)
    expect(res.statusCode).toBe(429)
    expect(db.store.get('users/u1').accessGrant).toBeUndefined()
  })
  it('tells an existing subscriber their subscription keeps running', async () => {
    const db = fakeDb({ 'users/u1': { plan: 'plus', subscriptionStatus: 'trialing', stripeSubscriptionId: 'sub_1' } })
    const res = mockRes(); await handler(db)(authed({ code: CODE }), res)
    expect(res.body.hasSubscription).toBe(true)
  })
})
