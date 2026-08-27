// scripts/test-meta-capi.mjs — focused regression tests for Stripe -> Meta CAPI policy.
import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { classifyPaidInvoice, buildMetaServerEvent, createMetaInvoiceProcessor } from '../api/_lib/meta-capi.js'
import { CHECKOUT_PRICE_IDS } from '../api/_lib/checkout-handler.js'

const { check, checkAsync, summary } = makeChecker()
const SMS_PRICE = 'price_sms_test'
const PLUS_PRICE = CHECKOUT_PRICE_IDS.plus_monthly

function line(price, amount) {
  return { amount, price: { id: price } }
}

function invoice({
  id = 'in_1',
  billingReason = 'subscription_create',
  amountPaid = 500,
  lines = [line(PLUS_PRICE, 500)],
  subscription = 'sub_1',
} = {}) {
  return {
    id,
    billing_reason: billingReason,
    amount_paid: amountPaid,
    currency: 'aud',
    subscription,
    status_transitions: { paid_at: 1770000000 },
    lines: { data: lines },
  }
}

function stripeEvent(inv, { id = 'evt_invoice_1', created = 1770000001 } = {}) {
  return { id, type: 'invoice.payment_succeeded', created, data: { object: inv } }
}

function subscription({ id = 'sub_1', userId = 'user-1' } = {}) {
  return { id, metadata: { userId } }
}

function senderFixture({ failFirst = false } = {}) {
  const calls = []
  let attempts = 0
  return {
    enabled: true,
    calls,
    async send(event) {
      attempts++
      calls.push(event)
      if (failFirst && attempts === 1) throw new Error('simulated Meta outage')
      return { skipped: false, payload: { events_received: 1 } }
    },
  }
}

check('initial Plus invoice is standard Purchase A$5', (() => {
  const got = classifyPaidInvoice(invoice(), { smsPriceId: SMS_PRICE })
  return got?.eventName === 'Purchase' && got?.kind === 'plus_initial' && got?.value === 5 && got?.currency === 'AUD'
})())

check('initial Plus + SMS invoice is ONE Purchase using actual A$8 paid', (() => {
  const got = classifyPaidInvoice(invoice({ amountPaid: 800, lines: [line(PLUS_PRICE, 500), line(SMS_PRICE, 300)] }), { smsPriceId: SMS_PRICE })
  return got?.eventName === 'Purchase' && got?.kind === 'plus_with_sms_initial' && got?.value === 8
})())

check('SMS added to an existing Plus subscription is custom SmsAddonPurchase', (() => {
  const got = classifyPaidInvoice(invoice({ billingReason: 'subscription_update', amountPaid: 300, lines: [line(SMS_PRICE, 300)] }), { smsPriceId: SMS_PRICE })
  return got?.eventName === 'SmsAddonPurchase' && got?.kind === 'sms_addon_existing_plus' && got?.value === 3
})())

check('SMS add-on value follows Stripe actual proration, not hard-coded A$3', (() => {
  const got = classifyPaidInvoice(invoice({ billingReason: 'subscription_update', amountPaid: 147, lines: [line(SMS_PRICE, 147)] }), { smsPriceId: SMS_PRICE })
  return got?.eventName === 'SmsAddonPurchase' && got?.value === 1.47
})())

check('monthly renewal is deliberately not an acquisition Purchase', classifyPaidInvoice(invoice({ billingReason: 'subscription_cycle' }), { smsPriceId: SMS_PRICE }) === null)
check('zero-dollar invoices are not sent as purchases', classifyPaidInvoice(invoice({ amountPaid: 0 }), { smsPriceId: SMS_PRICE }) === null)
check('unrelated subscription updates are not reported as SMS purchases', classifyPaidInvoice(invoice({ billingReason: 'subscription_update', amountPaid: 200, lines: [line(PLUS_PRICE, 200)] }), { smsPriceId: SMS_PRICE }) === null)

check('Meta event uses stable invoice-based event_id and Stripe-confirmed value', (() => {
  const inv = invoice({ id: 'in_stable', amountPaid: 800, lines: [line(PLUS_PRICE, 500), line(SMS_PRICE, 300)] })
  const classification = classifyPaidInvoice(inv, { smsPriceId: SMS_PRICE })
  const built = buildMetaServerEvent({ stripeEvent: stripeEvent(inv), invoice: inv, subscription: subscription(), classification })
  return built.event_name === 'Purchase' && built.event_id === 'idogs:in_stable:Purchase' && built.custom_data.value === 8 && built.custom_data.currency === 'AUD' && Array.isArray(built.user_data.external_id) && built.user_data.external_id[0].length === 64
})())

await checkAsync('the same paid Stripe invoice is delivered once after completion', async () => {
  const db = createFakeFirestore()
  const sender = senderFixture()
  const inv = invoice({ id: 'in_once' })
  const event = stripeEvent(inv, { id: 'evt_once' })
  const process = createMetaInvoiceProcessor({
    db,
    sender,
    getSmsPriceId: () => SMS_PRICE,
    getSubscription: async () => subscription(),
    now: () => new Date('2026-08-27T12:00:00Z'),
  })
  const first = await process(event)
  const second = await process(event)
  const stored = (await db.collection('metaCapiEvents').doc('idogs:in_once:Purchase').get()).data()
  return first.sent === true && second.reason === 'ALREADY_SENT' && sender.calls.length === 1 && stored.status === 'completed' && stored.attempts === 1
})

await checkAsync('a Meta failure is retryable with the SAME event_id, enabling Meta deduplication', async () => {
  const db = createFakeFirestore()
  const sender = senderFixture({ failFirst: true })
  const inv = invoice({ id: 'in_retry' })
  const event = stripeEvent(inv, { id: 'evt_retry' })
  const process = createMetaInvoiceProcessor({
    db,
    sender,
    getSmsPriceId: () => SMS_PRICE,
    getSubscription: async () => subscription(),
    now: () => new Date('2026-08-27T12:00:00Z'),
  })
  let failed = false
  try { await process(event) } catch { failed = true }
  const afterFail = (await db.collection('metaCapiEvents').doc('idogs:in_retry:Purchase').get()).data()
  const retry = await process(event)
  const afterRetry = (await db.collection('metaCapiEvents').doc('idogs:in_retry:Purchase').get()).data()
  return failed && afterFail.status === 'failed' && retry.sent === true && afterRetry.status === 'completed' && sender.calls.length === 2 && sender.calls[0].event_id === sender.calls[1].event_id
})

await checkAsync('CAPI is a safe no-op when the secret token is not configured', async () => {
  const db = createFakeFirestore()
  let fetched = false
  const process = createMetaInvoiceProcessor({
    db,
    sender: { enabled: false, send: async () => { throw new Error('must not send') } },
    getSmsPriceId: () => SMS_PRICE,
    getSubscription: async () => { fetched = true; return subscription() },
  })
  const result = await process(stripeEvent(invoice()))
  return result.reason === 'META_CAPI_NOT_CONFIGURED' && fetched === false && Object.keys(db._dump('metaCapiEvents')).length === 0
})

summary()
