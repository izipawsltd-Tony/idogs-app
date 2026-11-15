import { describe, it, expect, vi } from 'vitest'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { createWebhookHandler } from '../api/_lib/webhook-handler.js'
import { CHECKOUT_PRICE_IDS } from '../api/_lib/checkout-handler.js'
import { createSmsAddonCheckoutHandler, createSmsAddonRemoveHandler } from '../api/_lib/sms-checkout-handler.js'
import { smsSessionStore } from '../api/_lib/sms-checkout-session.js'
import { smsCheckoutTaxReady } from '../api/_lib/sms-checkout-tax.js'

const start = 1792926000
const profile = () => ({ plan: 'plus', subscriptionStatus: 'trialing', stripeCustomerId: 'cus_qa',
  stripeSubscriptionId: 'sub_plus', plusScansUsed: 4, smsAddonStatus: 'cancelled' })
const base = () => ({ id: 'sub_plus', customer: 'cus_qa', status: 'trialing', metadata: { userId: 'qa' },
  items: { data: [{ price: { id: CHECKOUT_PRICE_IDS.plus_monthly } }] } })
const sms = () => ({ id: 'sub_sms', customer: 'cus_qa', status: 'active',
  latest_invoice: { status: 'paid' }, metadata: { purchaseType: 'sms_addon', userId: 'qa', baseSubscriptionId: 'sub_plus' },
  items: { data: [{ id: 'si_sms', price: { id: 'price_sms' }, quantity: 1,
    current_period_start: start, current_period_end: start + 31 * 86400 }] } })
const response = () => { const res = { statusCode: 200, status(n) { this.statusCode = n; return this }, json(body) { this.body = body; return this } }; return res }
const req = { method: 'POST', headers: { authorization: 'Bearer qa' }, body: {} }

function fixture(seed = profile()) {
  const db = createFakeFirestore({ users: { qa: seed } })
  const subs = { sub_plus: base(), sub_sms: sms() }
  const cancelSubscription = vi.fn(async id => { subs[id].status = 'canceled' })
  const getSubscription = vi.fn(async id => { if (!subs[id]) throw new Error('Unknown fixture'); return structuredClone(subs[id]) })
  const process = createWebhookHandler({ db, constructEvent: raw => JSON.parse(raw.toString()),
    getSubscription, cancelSubscription, getSmsPriceId: () => 'price_sms', now: () => new Date(start * 1000) })
  const fire = (type, object = subs.sub_sms, created = 100, id = `evt_${type}_${created}`) => process(Buffer.from(JSON.stringify({ id, type, created, data: { object } })), 'signature')
  const user = async () => (await db.collection('users').doc('qa').get()).data()
  return { db, subs, fire, user, cancelSubscription, getSubscription }
}

describe('independently billed SMS lifecycle', () => {
  it('paid Checkout grants only 20 SMS credits with its own monthly period; Plus remains unchanged', async () => {
    const f = fixture(); const before = await f.user()
    expect((await f.fire('checkout.session.completed', { subscription: 'sub_sms', metadata: { purchaseType: 'sms_addon' } })).status).toBe(200)
    const user = await f.user()
    expect(user).toMatchObject({ ...before, smsAddonStatus: 'active', smsStripeSubscriptionId: 'sub_sms', smsCreditsLimit: 20, smsCreditsUsed: 0 })
    expect(user.smsPeriodEnd).toBe(new Date((start + 31 * 86400) * 1000).toISOString())
    expect(user).not.toHaveProperty('lastKnownSubscriptionId')
  })
  it.each(['checkout.session.async_payment_succeeded', 'customer.subscription.created', 'customer.subscription.updated', 'invoice.paid', 'invoice.payment_succeeded'])(
    '%s supports activation without changing Plus', async type => {
      const f = fixture(); const object = type.startsWith('checkout') ? { subscription: 'sub_sms' } : type.startsWith('invoice') ? { parent: { subscription_details: { subscription: 'sub_sms' } } } : f.subs.sub_sms
      expect((await f.fire(type, object)).status).toBe(200)
      expect(await f.user()).toMatchObject({ plan: 'plus', subscriptionStatus: 'trialing', stripeSubscriptionId: 'sub_plus', smsAddonStatus: 'active' })
    })
  it('redelivery and another event for the same paid month preserve used credits', async () => {
    const f = fixture(); await f.fire('customer.subscription.updated')
    await f.db.collection('users').doc('qa').set({ smsCreditsUsed: 7 }, { merge: true })
    await f.fire('customer.subscription.updated'); await f.fire('invoice.paid', { subscription: 'sub_sms' }, 101)
    expect((await f.user()).smsCreditsUsed).toBe(7)
  })
  it('renewal resets once, with a paid new monthly period', async () => {
    const f = fixture(); await f.fire('customer.subscription.updated')
    await f.db.collection('users').doc('qa').set({ smsCreditsUsed: 20 }, { merge: true })
    f.subs.sub_sms.items.data[0].current_period_start += 31 * 86400
    f.subs.sub_sms.items.data[0].current_period_end += 31 * 86400
    await f.fire('invoice.paid', { parent: { subscription_details: { subscription: 'sub_sms' } } }, 101)
    expect((await f.user()).smsCreditsUsed).toBe(0)
    await f.db.collection('users').doc('qa').set({ smsCreditsUsed: 3 }, { merge: true })
    await f.fire('customer.subscription.updated', f.subs.sub_sms, 102)
    expect((await f.user()).smsCreditsUsed).toBe(3)
  })
  it('failed SMS payment stops SMS and recovery within the same period preserves consumption', async () => {
    const f = fixture(); await f.fire('customer.subscription.updated')
    await f.db.collection('users').doc('qa').set({ smsCreditsUsed: 9 }, { merge: true })
    f.subs.sub_sms.status = 'past_due'; f.subs.sub_sms.latest_invoice.status = 'open'
    await f.fire('invoice.payment_failed', { subscription: 'sub_sms' }, 101)
    expect(await f.user()).toMatchObject({ smsAddonStatus: 'past_due', plan: 'plus', subscriptionStatus: 'trialing', smsCreditsUsed: 9 })
    f.subs.sub_sms.status = 'active'; f.subs.sub_sms.latest_invoice.status = 'paid'
    await f.fire('invoice.paid', { subscription: 'sub_sms' }, 102)
    expect(await f.user()).toMatchObject({ smsAddonStatus: 'active', smsCreditsUsed: 9 })
  })
  it('cancelling SMS does not cancel or downgrade Plus', async () => {
    const f = fixture(); f.subs.sub_sms.status = 'canceled'
    await f.fire('customer.subscription.deleted')
    expect(await f.user()).toMatchObject({ smsAddonStatus: 'cancelled', plan: 'plus', subscriptionStatus: 'trialing', stripeSubscriptionId: 'sub_plus' })
  })
  it.each(['trialing', 'unpaid', 'incomplete'])('does not grant paid credits for SMS status %s', async status => {
    const f = fixture(); f.subs.sub_sms.status = status
    await f.fire('customer.subscription.updated')
    expect((await f.user()).smsAddonStatus).not.toBe('active')
  })
  it('does not grant credits for unpaid invoice or a trial-length billing period', async () => {
    for (const invalid of ['invoice', 'period']) {
      const f = fixture()
      if (invalid === 'invoice') f.subs.sub_sms.latest_invoice.status = 'open'
      else f.subs.sub_sms.items.data[0].current_period_end += 90 * 86400
      await f.fire('customer.subscription.updated')
      expect((await f.user()).smsAddonStatus).not.toBe('active')
    }
  })
  it('a later Plus update or payment does not erase independently paid SMS', async () => {
    const f = fixture(); await f.fire('customer.subscription.updated')
    await f.fire('customer.subscription.updated', f.subs.sub_plus, 101)
    await f.fire('invoice.payment_succeeded', { subscription: 'sub_plus' }, 102)
    expect(await f.user()).toMatchObject({ smsAddonStatus: 'active', smsStripeSubscriptionId: 'sub_sms' })
  })
  it('ending Plus cancels only its verified independent SMS renewal', async () => {
    const f = fixture(); await f.fire('customer.subscription.updated')
    f.subs.sub_plus.status = 'canceled'
    await f.fire('customer.subscription.deleted', f.subs.sub_plus, 101)
    expect(f.cancelSubscription).toHaveBeenCalledWith('sub_sms', { prorate: false, invoice_now: false })
    expect(await f.user()).toMatchObject({ plan: 'free', smsAddonStatus: 'cancelled' })
  })
  it('an SMS Checkout completed after Plus ended cannot leave a paid renewal running', async () => {
    const f = fixture(); f.subs.sub_plus.status = 'canceled'
    await f.fire('checkout.session.completed', { subscription: 'sub_sms' })
    expect(f.cancelSubscription).toHaveBeenCalledWith('sub_sms', { prorate: false, invoice_now: false })
    expect((await f.user()).smsAddonStatus).toBe('cancelled')
  })
  it.each(['customer', 'price', 'base'])('rejects an invalid %s binding without granting SMS', async mismatch => {
    const f = fixture()
    if (mismatch === 'customer') f.subs.sub_sms.customer = 'cus_other'
    if (mismatch === 'price') f.subs.sub_sms.items.data[0].price.id = 'price_other'
    if (mismatch === 'base') f.subs.sub_plus.customer = 'cus_other'
    expect((await f.fire('customer.subscription.updated')).status).toBe(500)
    expect((await f.user()).smsAddonStatus).toBe('cancelled')
  })
  it('ignores stale events without erasing the new paid period', async () => {
    const f = fixture(); await f.fire('customer.subscription.updated', f.subs.sub_sms, 200)
    f.subs.sub_sms.status = 'canceled'
    await f.fire('customer.subscription.deleted', f.subs.sub_sms, 100)
    expect((await f.user()).smsAddonStatus).toBe('active')
  })
})

function checkoutFixture() {
  const db = createFakeFirestore({ users: { qa: profile() } })
  const createSession = vi.fn(async () => ({ id: 'cs_qa', url: 'https://checkout.stripe.com/qa' }))
  const updateSubscription = vi.fn()
  const listSubscriptions = vi.fn(async () => ({ data: [base()], has_more: false }))
  const deps = { verifyIdToken: async () => ({ uid: 'qa' }), getProfile: async () => (await db.collection('users').doc('qa').get()).data(),
    retrieveSubscription: async () => base(), verifyCheckout: async () => true, updateSubscription, listSubscriptions, createSession,
    getPriceId: () => 'price_sms', getAppUrl: () => 'https://qa.example', ...smsSessionStore(db) }
  const handler = createSmsAddonCheckoutHandler(deps)
  const call = async (request = req) => { const res = response(); await handler(request, res); return res }
  return { db, deps, call, createSession, updateSubscription, listSubscriptions }
}
describe('paid SMS checkout during Plus promotion', () => {
  it('creates a separate subscription Checkout with no trial or Plus mutation', async () => {
    const f = checkoutFixture(); const res = await f.call()
    expect(res.statusCode).toBe(200); expect(res.body.url).toMatch(/^https:\/\/checkout.stripe.com/)
    expect(f.updateSubscription).not.toHaveBeenCalled()
    const params = f.createSession.mock.calls[0][0]
    expect(params).toMatchObject({ mode: 'subscription', customer: 'cus_qa', automatic_tax: { enabled: true }, line_items: [{ price: 'price_sms', quantity: 1 }], subscription_data: { metadata: { userId: 'qa', baseSubscriptionId: 'sub_plus', purchaseType: 'sms_addon' } } })
    expect(params.subscription_data).not.toHaveProperty('trial_end')
    expect(params).not.toHaveProperty('payment_method_types')
  })
  it('retries use the identical idempotency key and parameters', async () => {
    const f = checkoutFixture(); await f.call(); await f.call()
    expect(f.createSession.mock.calls[0]).toEqual(f.createSession.mock.calls[1])
  })
  it('a response lost after Stripe creates the session keeps the original attempt', async () => {
    const f = checkoutFixture(); f.createSession.mockRejectedValueOnce(new Error('Ambiguous network'))
    expect((await f.call()).statusCode).toBe(500); expect((await f.call()).statusCode).toBe(200)
    expect(f.createSession.mock.calls[0]).toEqual(f.createSession.mock.calls[1])
  })
  it.each(['active', 'past_due', 'incomplete', 'unpaid'])('blocks duplicate or unresolved SMS status %s before creating a session', async status => {
    const f = checkoutFixture(); f.listSubscriptions.mockResolvedValue({ data: [{ ...sms(), status }], has_more: false })
    expect((await f.call()).statusCode).toBe(500); expect(f.createSession).not.toHaveBeenCalled()
  })
  it('fails closed if subscription enumeration is truncated', async () => {
    const f = checkoutFixture(); f.listSubscriptions.mockResolvedValue({ data: [], has_more: true })
    expect((await f.call()).statusCode).toBe(500); expect(f.createSession).not.toHaveBeenCalled()
  })
  it('requires authentication before creating anything', async () => {
    const f = checkoutFixture(); expect((await f.call({ method: 'POST', headers: {} })).statusCode).toBe(401)
    expect(f.createSession).not.toHaveBeenCalled()
  })
  it('blocks checkout when tax or price verification fails', async () => {
    const f = checkoutFixture(); f.deps.verifyCheckout = async () => false
    const res = response(); await createSmsAddonCheckoutHandler(f.deps)(req, res)
    expect(res.statusCode).toBe(500); expect(f.createSession).not.toHaveBeenCalled()
  })
  it('rejects an account binding that changes before the attempt transaction', async () => {
    const f = checkoutFixture()
    await f.db.collection('users').doc('qa').set({ stripeSubscriptionId: 'sub_new' }, { merge: true })
    await expect(f.deps.getSmsAttempt('qa', profile(), 'https://qa.example', 'price_sms')).rejects.toThrow('SMS_BILLING_CHANGED')
  })
  it('removing independent SMS cancels only SMS', async () => {
    const f = fixture({ ...profile(), smsStripeSubscriptionId: 'sub_sms', smsAddonStatus: 'active' })
    const handler = createSmsAddonRemoveHandler({ verifyIdToken: async () => ({ uid: 'qa' }), getProfile: f.user,
      retrieveSubscription: f.getSubscription, cancelSubscription: f.cancelSubscription, getPriceId: () => 'price_sms' })
    const res = response(); await handler(req, res)
    expect(res.statusCode).toBe(200); expect(f.cancelSubscription).toHaveBeenCalledWith('sub_sms', { prorate: false, invoice_now: false })
    expect(f.subs.sub_plus.status).toBe('trialing')
  })
})

describe('SMS A$3 GST-inclusive catalog safety', () => {
  function taxFixture() {
    const data = { price: { id: 'price_sms', active: true, livemode: true, currency: 'aud', unit_amount: 300,
      tax_behavior: 'unspecified', recurring: { interval: 'month', interval_count: 1 } },
      settings: { status: 'active', livemode: true, defaults: { tax_behavior: 'inferred_by_currency' } },
      registrations: { data: [{ country: 'AU', status: 'active', livemode: true, active_from: 1 }], has_more: false },
      customer: { id: 'cus_qa', livemode: true, address: { country: 'AU' }, tax_exempt: 'none' } }
    const stripe = { prices: { retrieve: async () => data.price }, tax: { settings: { retrieve: async () => data.settings },
      registrations: { list: async () => data.registrations } }, customers: { retrieve: async () => data.customer } }
    return { data, check: () => smsCheckoutTaxReady(stripe, profile(), 'price_sms', true) }
  }
  it('accepts verified AU monthly A$3 including inferred GST', async () => { expect(await taxFixture().check()).toBe(true) })
  it.each(['price', 'exclusive', 'registration', 'country', 'exempt', 'mode', 'interval'])(
    'rejects %s mismatch before creating a payable session', async mismatch => {
      const f = taxFixture()
      if (mismatch === 'price') f.data.price.unit_amount = 301
      if (mismatch === 'exclusive') f.data.price.tax_behavior = 'exclusive'
      if (mismatch === 'registration') f.data.registrations.data = []
      if (mismatch === 'country') f.data.customer.address.country = 'US'
      if (mismatch === 'exempt') f.data.customer.tax_exempt = 'exempt'
      if (mismatch === 'mode') f.data.price.livemode = false
      if (mismatch === 'interval') f.data.price.recurring.interval = 'year'
      expect(await f.check()).toBe(false)
    })
})
