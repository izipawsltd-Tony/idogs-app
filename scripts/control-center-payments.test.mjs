import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compilePaymentHistory, summarizeCustomerPayments } from '../api/_lib/control-center-payments.js'

const now = new Date('2026-11-13T00:00:00Z')
const sec = iso => Math.floor(Date.parse(iso) / 1000)
const charge = (iso, extra = {}) => ({ status: 'succeeded', paid: true, refunded: false, amount_captured: 700, created: sec(iso), livemode: true, ...extra })
const invoice = (iso, periodEndIso, extra = {}) => ({ status: 'paid', amount_paid: 700, billing_reason: 'subscription_cycle', created: sec(iso), livemode: true, parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ period: { end: sec(periodEndIso) } }] }, ...extra })
const summarize = (charges, invoices = []) => summarizeCustomerPayments({ charges, invoices, now, windowDays: 30, renewalGraceDays: 3 })

test('first verified payment counts once, only when successful, captured and not refunded', () => {
  assert.equal(summarize([charge('2026-11-01'), charge('2026-11-05')]).live.firstPaymentAt, Date.parse('2026-11-01'))
  assert.equal(summarize([charge('2026-11-01')]).live.newInWindow, true)
  assert.equal(summarize([charge('2026-09-01'), charge('2026-11-01')]).live.newInWindow, false)
  for (const bad of [{ status: 'failed' }, { paid: false }, { refunded: true }, { amount_captured: 0 }]) {
    assert.equal(summarize([charge('2026-11-01', bad)]).live, undefined)
  }
})

test('test-mode transactions never become live paying customers', () => {
  const result = summarize([charge('2026-11-01', { livemode: false })])
  assert.equal(result.live, undefined)
  assert.equal(result.test.newInWindow, true)
})

test('paid renewal requires the first paid period to have ended plus grace; A$0 invoices are not payments', () => {
  const pays = [charge('2026-09-01')]
  const free = invoice('2026-08-01', '2026-09-01', { amount_paid: 0, billing_reason: 'subscription_create' })
  const first = invoice('2026-09-01', '2026-10-01', { billing_reason: 'subscription_create' })
  assert.equal(summarize(pays, [free, first]).live.renewal, 'DUE_NOT_RENEWED')
  assert.equal(summarize(pays, [first, invoice('2026-10-01', '2026-11-01')]).live.renewal, 'RENEWED')
  assert.equal(summarize(pays, [invoice('2026-10-20', '2026-11-11', { billing_reason: 'subscription_create' })]).live.renewal, 'NOT_DUE')
  assert.equal(summarize(pays, [invoice('2026-09-01', '2026-10-01', { lines: { data: [] } })]).live.renewal, 'UNKNOWN_PERIOD')
  assert.equal(summarize(pays, [invoice('2026-09-01', '2026-10-01', { billing_reason: 'manual' })]).live.renewal, 'NONE')
})

test('renewal must be a later paid cycle invoice of the same subscription', () => {
  const pays = [charge('2026-09-01')]
  const first = invoice('2026-09-01', '2026-10-01', { billing_reason: 'subscription_create' })
  const resubscribe = invoice('2026-10-15', '2026-11-15', { billing_reason: 'subscription_create', parent: { subscription_details: { subscription: 'sub_2' } } })
  assert.equal(summarize(pays, [first, resubscribe]).live.renewal, 'DUE_NOT_RENEWED')
  const otherCycle = invoice('2026-10-01', '2026-11-01', { parent: { subscription_details: { subscription: 'sub_2' } } })
  assert.equal(summarize(pays, [first, otherCycle]).live.renewal, 'DUE_NOT_RENEWED')
  const upgrade = invoice('2026-09-15', '2026-10-01', { billing_reason: 'subscription_update' })
  assert.equal(summarize(pays, [first, upgrade]).live.renewal, 'DUE_NOT_RENEWED')
  // Older API payloads keep invoice.subscription (string or expanded object).
  const legacyFirst = { ...first, parent: undefined, subscription: 'sub_9' }
  const legacyCycle = { ...invoice('2026-10-01', '2026-11-01'), parent: undefined, subscription: { id: 'sub_9' } }
  assert.equal(summarize(pays, [legacyFirst, legacyCycle]).live.renewal, 'RENEWED')
  assert.equal(summarize(pays, [{ ...first, parent: undefined }]).live.renewal, 'UNKNOWN_PERIOD')
})

test('renewal due date uses the subscription service period, not a proration line', () => {
  const pays = [charge('2026-10-20')]
  const lines = { data: [
    { period: { end: sec('2026-10-25') }, parent: { subscription_item_details: { proration: true } } },
    { period: { end: sec('2026-10-26') }, proration: true },
    { period: { end: sec('2026-11-20') } },
  ] }
  assert.equal(summarize(pays, [invoice('2026-10-20', '2026-11-20', { billing_reason: 'subscription_create', lines })]).live.renewal, 'NOT_DUE')
  const onlyProration = { data: [lines.data[0]] }
  assert.equal(summarize(pays, [invoice('2026-10-20', '2026-11-20', { billing_reason: 'subscription_create', lines: onlyProration })]).live.renewal, 'UNKNOWN_PERIOD')
})

function fakeStripe(perCustomer) {
  const calls = []
  return {
    calls,
    charges: { list: async ({ customer }) => { calls.push(customer); const data = perCustomer[customer]; if (data === 'FAIL') throw new Error('PRIVATE'); return { data: data?.charges || [], has_more: data?.more === true } } },
    invoices: { list: async ({ customer }) => ({ data: perCustomer[customer]?.invoices || [], has_more: false }) },
  }
}
const users = [
  { id: 'a', stripeCustomerId: 'cus_A' }, { id: 'b', stripeCustomerId: 'cus_B' },
  { id: 'qa', stripeCustomerId: 'cus_QA' }, { id: 'staff', stripeCustomerId: 'cus_STAFF' }, { id: 'none' },
]
const accounts = [
  { uid: 'a', classification: 'REAL_CUSTOMER' }, { uid: 'b', classification: 'UNCLASSIFIED' },
  { uid: 'qa', classification: 'TEST_QA' }, { uid: 'staff', classification: 'INTERNAL' },
]

test('LIVE key with complete reads is VERIFIED; internal and QA accounts are never read or counted', async () => {
  const stripe = fakeStripe({ cus_A: { charges: [charge('2026-11-01')] }, cus_B: { charges: [charge('2026-08-01')] } })
  const result = await compilePaymentHistory({ stripe, users, accounts, stripeMode: 'LIVE', now })
  assert.equal(result.status, 'VERIFIED')
  assert.deepEqual(stripe.calls.sort(), ['cus_A', 'cus_B'])
  assert.equal(result.live.payingAccounts, 2)
  assert.equal(result.live.newPayingAccounts, 1)
  assert.equal(result.sources.apple, 'NOT_INTEGRATED')
  assert.doesNotMatch(JSON.stringify(result), /cus_|PRIVATE/)
})

test('test-mode key reports TEST_MODE_ONLY with no live counts but test diagnostics', async () => {
  const stripe = fakeStripe({ cus_A: { charges: [charge('2026-11-01', { livemode: false })] } })
  const result = await compilePaymentHistory({ stripe, users, accounts, stripeMode: 'TEST', now })
  assert.equal(result.status, 'TEST_MODE_ONLY')
  assert.equal(result.live, null)
  assert.equal(result.test.payingAccounts, 1)
})

test('failed or truncated reads, shared customers and missing Stripe never certify counts', async () => {
  const failed = await compilePaymentHistory({ stripe: fakeStripe({ cus_A: 'FAIL' }), users, accounts, stripeMode: 'LIVE', now })
  assert.equal(failed.status, 'PARTIAL')
  assert.equal(failed.live, null)
  assert.equal(failed.failedCustomerReads, 1)
  const truncated = await compilePaymentHistory({ stripe: fakeStripe({ cus_A: { more: true } }), users, accounts, stripeMode: 'LIVE', now })
  assert.equal(truncated.status, 'PARTIAL')
  const shared = await compilePaymentHistory({ stripe: fakeStripe({}), users: [...users, { id: 'c', stripeCustomerId: 'cus_A' }], accounts, stripeMode: 'LIVE', now })
  assert.equal(shared.status, 'PARTIAL')
  assert.equal(shared.ambiguousCustomers, 1)
  assert.equal((await compilePaymentHistory({ stripe: null, users, accounts, stripeMode: 'LIVE', now })).status, 'UNAVAILABLE')
  const capped = await compilePaymentHistory({ stripe: fakeStripe({}), users, accounts, stripeMode: 'LIVE', now, maxCustomers: 1 })
  assert.equal(capped.status, 'PARTIAL')
})
