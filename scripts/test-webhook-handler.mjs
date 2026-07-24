// scripts/test-webhook-handler.mjs — tests for
// api/_lib/webhook-handler.js (iDogs Pricing v1.1, LOCKED; Codex H1/H5
// remediation). No live Stripe account or emulator required —
// createWebhookHandler is factored exactly for this (same pattern as
// api/_lib/checkout-handler.js).
//
// Usage: node scripts/test-webhook-handler.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { createWebhookHandler } from '../api/_lib/webhook-handler.js'
import { CHECKOUT_PRICE_IDS } from '../api/_lib/checkout-handler.js'

const { check, checkAsync, summary } = makeChecker()

function makeHandler({ db, subscriptions = {}, nowFn = () => new Date('2026-07-24T00:00:00Z'), failSubscriptionFetch = false } = {}) {
  const firestore = db || createFakeFirestore()
  const calls = { constructEvent: [], getSubscription: [] }
  const process = createWebhookHandler({
    constructEvent: (rawBody, sig) => {
      calls.constructEvent.push({ rawBody, sig })
      if (sig === 'bad-signature') throw new Error('signature verification failed')
      return JSON.parse(rawBody.toString())
    },
    getSubscription: async id => {
      calls.getSubscription.push(id)
      if (failSubscriptionFetch) throw new Error('simulated transient Stripe API failure')
      if (!subscriptions[id]) throw new Error(`no fake subscription for ${id}`)
      return subscriptions[id]
    },
    db: firestore,
    now: nowFn,
  })
  return { process, calls, db: firestore }
}

function subFixture({ id = 'sub_1', priceId = CHECKOUT_PRICE_IDS.plus_monthly, status = 'active', startDate = 1753315200, userId = 'user-1' } = {}) {
  return {
    id,
    status,
    start_date: startDate,
    metadata: { userId, plan: 'plus' },
    items: { data: [{ price: { id: priceId } }] },
  }
}

async function fire(processFn, event, sig = 'good-signature') {
  return processFn(Buffer.from(JSON.stringify(event)), sig)
}

function checkoutEvent({ id, evtId = 'evt_checkout', subscriptionId = 'sub_1', userId = 'user-1', created = 1000 }) {
  return { id: evtId, type: 'checkout.session.completed', created, data: { object: { metadata: { userId }, subscription: subscriptionId, customer: 'cus_1' } } }
}

function subUpdatedEvent({ evtId, subscription, created }) {
  return { id: evtId, type: 'customer.subscription.updated', created, data: { object: subscription } }
}

function subDeletedEvent({ evtId, subscription, created }) {
  return { id: evtId, type: 'customer.subscription.deleted', created, data: { object: subscription } }
}

// ── Signature verification ────────────────────────────────────────────

await checkAsync('an invalid signature is rejected with 400, before any Firestore write', async () => {
  const { process, db } = makeHandler()
  const res = await process(Buffer.from('{}'), 'bad-signature')
  const events = db._dump('processedStripeEvents')
  return res.status === 400 && Object.keys(events).length === 0
})

// ── H1: pending -> completed state machine ────────────────────────────

await checkAsync('a successfully processed event is marked completed, not just "exists"', async () => {
  const { process, db } = makeHandler({ subscriptions: { sub_1: subFixture() } })
  await fire(process, checkoutEvent({ evtId: 'evt_ok' }))
  const stored = db._dump('processedStripeEvents')['evt_ok']
  return stored.status === 'completed' && typeof stored.completedAt === 'string'
})

await checkAsync('checkout.session.completed grants Plus and initializes scan-quota state from subscription.start_date', async () => {
  const { process, db } = makeHandler({ subscriptions: { sub_1: subFixture({ startDate: 1753315200 /* 2025-07-24 */ }) } })
  const res = await fire(process, checkoutEvent({ evtId: 'evt_1' }))
  const user = (await db.collection('users').doc('user-1').get()).data()
  return res.status === 200 &&
    user.plan === 'plus' &&
    user.stripeCustomerId === 'cus_1' &&
    user.stripeSubscriptionId === 'sub_1' &&
    user.billingInterval === 'monthly' &&
    user.plusScansUsed === 0 &&
    user.scanPeriodAnchorDay === 24 &&
    user.pastDueSince === null
})

await checkAsync('a processing failure marks the event FAILED, not completed, and returns 500', async () => {
  const { process, db } = makeHandler({ failSubscriptionFetch: true })
  const res = await fire(process, checkoutEvent({ evtId: 'evt_fail' }))
  const stored = db._dump('processedStripeEvents')['evt_fail']
  return res.status === 500 && stored.status === 'failed' && typeof stored.failedAt === 'string'
})

await checkAsync('a FAILED event is retriable on redelivery — the second, successful attempt actually applies (Codex H1: transient failures must permit retry without being stuck)', async () => {
  const seeded = createFakeFirestore()
  const calls = { getSubscription: [] }
  let shouldFail = true
  const process = createWebhookHandler({
    constructEvent: rawBody => JSON.parse(rawBody.toString()),
    getSubscription: async id => {
      calls.getSubscription.push(id)
      if (shouldFail) throw new Error('simulated transient failure')
      return subFixture({ id })
    },
    db: seeded,
    now: () => new Date('2026-07-24T00:00:00Z'),
  })
  const event = checkoutEvent({ evtId: 'evt_retry' })
  const first = await fire(process, event)
  shouldFail = false
  const second = await fire(process, event)
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return first.status === 500 && second.status === 200 && user.plan === 'plus' && calls.getSubscription.length === 2
})

await checkAsync('a completed event redelivered is a true no-op duplicate — no re-processing, Stripe API not called again', async () => {
  const { process, db, calls } = makeHandler({ subscriptions: { sub_1: subFixture() } })
  const event = checkoutEvent({ evtId: 'evt_dup' })
  const first = await fire(process, event)
  const second = await fire(process, event)
  return first.status === 200 && !first.body.duplicate &&
    second.status === 200 && second.body.duplicate === true &&
    calls.getSubscription.length === 1
})

await checkAsync('a fresh (non-stale) pending claim from a genuinely concurrent delivery is treated as a duplicate, not double-processed', async () => {
  const seeded = createFakeFirestore({
    processedStripeEvents: { evt_concurrent: { type: 'checkout.session.completed', status: 'pending', claimedAt: '2026-07-24T00:00:10.000Z', attempts: 1 } },
  })
  const { process, calls } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture() }, nowFn: () => new Date('2026-07-24T00:00:20.000Z') /* 10s later, well under the 55s staleness threshold */ })
  const res = await fire(process, checkoutEvent({ evtId: 'evt_concurrent' }))
  return res.status === 200 && res.body.duplicate === true && calls.getSubscription.length === 0
})

await checkAsync('a STALE pending claim (owning invocation presumably crashed) is reclaimed and actually processed', async () => {
  const seeded = createFakeFirestore({
    processedStripeEvents: { evt_stale: { type: 'checkout.session.completed', status: 'pending', claimedAt: '2026-07-24T00:00:00.000Z', attempts: 1 } },
  })
  const { process, db } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture() }, nowFn: () => new Date('2026-07-24T00:01:00.000Z') /* 60s later, past the 55s threshold */ })
  const res = await fire(process, checkoutEvent({ evtId: 'evt_stale' }))
  const stored = db._dump('processedStripeEvents')['evt_stale']
  const user = (await db.collection('users').doc('user-1').get()).data()
  return res.status === 200 && !res.body.duplicate && stored.status === 'completed' && stored.attempts === 2 && user.plan === 'plus'
})

// ── checkout.session.completed — allowlist, reactivation ──────────────

await checkAsync('checkout.session.completed reactivates restricted dogs up to the new Plus cap of 5', async () => {
  const seeded = createFakeFirestore({
    dogs: {
      active1: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-01T00:00:00Z' },
      active2: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-02T00:00:00Z' },
      r1: { currentOwnerId: 'user-1', status: 'restricted', isDeceased: false, createdAt: '2026-01-03T00:00:00Z' },
      r2: { currentOwnerId: 'user-1', status: 'restricted', isDeceased: false, createdAt: '2026-01-04T00:00:00Z' },
      r3: { currentOwnerId: 'user-1', status: 'restricted', isDeceased: false, createdAt: '2026-01-05T00:00:00Z' },
      r4: { currentOwnerId: 'user-1', status: 'restricted', isDeceased: false, createdAt: '2026-01-06T00:00:00Z' },
    },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture() } })
  await fire(process, checkoutEvent({ evtId: 'evt_reactivate_on_checkout' }))
  const r1 = (await seeded.collection('dogs').doc('r1').get()).data()
  const r4 = (await seeded.collection('dogs').doc('r4').get()).data()
  return r1.status === 'active' && r4.status === 'restricted'
})

await checkAsync('checkout.session.completed with an unrecognized price id never grants Plus (allowlist enforced)', async () => {
  const { process, db } = makeHandler({ subscriptions: { sub_evil: subFixture({ id: 'sub_evil', priceId: 'price_attacker_injected' }) } })
  await fire(process, checkoutEvent({ evtId: 'evt_evil', subscriptionId: 'sub_evil' }))
  const snap = await db.collection('users').doc('user-1').get()
  return snap.exists === false
})

// ── H5: out-of-order / stale subscription events ──────────────────────

await checkAsync('an OLD subscription.deleted arriving AFTER a newer active subscription is already stored: no-op, does not downgrade', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', stripeSubscriptionId: 'sub_new', lastKnownSubscriptionId: 'sub_new', subscriptionEventTimestamps: { sub_new: 500 } } },
    dogs: {
      d1: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-01T00:00:00Z' },
      d2: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-02T00:00:00Z' },
      d3: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-03T00:00:00Z' },
    },
  })
  const { process } = makeHandler({ db: seeded })
  const res = await fire(process, subDeletedEvent({ evtId: 'evt_old_delete', subscription: subFixture({ id: 'sub_old' }), created: 100 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  const d3 = (await seeded.collection('dogs').doc('d3').get()).data()
  return res.status === 200 && user.plan === 'plus' && user.stripeSubscriptionId === 'sub_new' && d3.status === 'active'
})

await checkAsync('an OLD subscription.updated(active) arriving AFTER a newer subscription is stored: no-op, does not re-grant/overwrite the newer subscription id', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', stripeSubscriptionId: 'sub_new', billingInterval: 'annual', lastKnownSubscriptionId: 'sub_new', subscriptionEventTimestamps: { sub_new: 500 } } },
  })
  const { process } = makeHandler({ db: seeded })
  await fire(process, subUpdatedEvent({ evtId: 'evt_old_update', subscription: subFixture({ id: 'sub_old', status: 'active', priceId: CHECKOUT_PRICE_IDS.plus_monthly }), created: 50 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.billingInterval === 'annual' && user.stripeSubscriptionId === 'sub_new'
})

await checkAsync('an out-of-order event for the SAME subscription (earlier event.created arriving after a later one already applied) does not overwrite', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', subscriptionStatus: 'active', lastKnownSubscriptionId: 'sub_1', subscriptionEventTimestamps: { sub_1: 900 } } },
  })
  const { process } = makeHandler({ db: seeded })
  // A stale, EARLIER past_due event for the same subscription, arriving
  // after a later 'active' event (timestamp 900) was already applied.
  await fire(process, subUpdatedEvent({ evtId: 'evt_stale_same_sub', subscription: subFixture({ id: 'sub_1', status: 'past_due' }), created: 400 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.subscriptionStatus === 'active' && user.pastDueSince === undefined
})

await checkAsync('a genuinely newer event for the same subscription IS applied (ordering guard does not block forward progress)', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', subscriptionStatus: 'active', lastKnownSubscriptionId: 'sub_1', subscriptionEventTimestamps: { sub_1: 400 } } },
  })
  const { process } = makeHandler({ db: seeded })
  await fire(process, subUpdatedEvent({ evtId: 'evt_forward', subscription: subFixture({ id: 'sub_1', status: 'past_due' }), created: 900 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.subscriptionStatus === 'past_due' && typeof user.pastDueSince === 'string'
})

// ── customer.subscription.updated — past_due grace (§4.2) ───────────

await checkAsync('subscription.updated(past_due) keeps plan plus and records pastDueSince on first observation', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'plus' } } })
  const { process } = makeHandler({ db: seeded, nowFn: () => new Date('2026-07-24T00:00:00Z') })
  await fire(process, subUpdatedEvent({ evtId: 'evt_pd1', subscription: subFixture({ status: 'past_due' }), created: 100 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plan === 'plus' && user.subscriptionStatus === 'past_due' && user.pastDueSince === '2026-07-24T00:00:00.000Z'
})

await checkAsync('a second past_due delivery does not push pastDueSince forward (grace window cannot be re-extended)', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: '2026-07-01T00:00:00.000Z', lastKnownSubscriptionId: 'sub_1', subscriptionEventTimestamps: { sub_1: 100 } } } })
  const { process } = makeHandler({ db: seeded, nowFn: () => new Date('2026-07-24T00:00:00Z') })
  await fire(process, subUpdatedEvent({ evtId: 'evt_pd2', subscription: subFixture({ status: 'past_due' }), created: 200 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.pastDueSince === '2026-07-01T00:00:00.000Z'
})

// ── customer.subscription.updated — downgrade statuses ───────────────

for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
  await checkAsync(`subscription.updated(${status}) downgrades to free and reconciles the dog cap`, async () => {
    const seeded = createFakeFirestore({
      users: { 'user-1': { plan: 'plus' } },
      dogs: {
        d1: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-01T00:00:00Z' },
        d2: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-02T00:00:00Z' },
        d3: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-03T00:00:00Z' },
      },
    })
    const { process } = makeHandler({ db: seeded })
    await fire(process, subUpdatedEvent({ evtId: `evt_${status}`, subscription: subFixture({ status }), created: 100 }))
    const user = (await seeded.collection('users').doc('user-1').get()).data()
    const d3 = (await seeded.collection('dogs').doc('d3').get()).data()
    return user.plan === 'free' && d3.status === 'restricted'
  })
}

await checkAsync('a status this pricing record does not define (e.g. incomplete) only records the status, never flips plan', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'plus' } } })
  const { process } = makeHandler({ db: seeded })
  await fire(process, subUpdatedEvent({ evtId: 'evt_incomplete', subscription: subFixture({ status: 'incomplete' }), created: 100 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plan === 'plus' && user.subscriptionStatus === 'incomplete'
})

// ── customer.subscription.deleted ─────────────────────────────────────

await checkAsync('subscription.deleted downgrades to free, clears stripeSubscriptionId, never deletes the user document', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', stripeSubscriptionId: 'sub_1' } },
    dogs: {
      d1: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-01T00:00:00Z' },
      d2: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-02T00:00:00Z' },
      d3: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-03T00:00:00Z' },
    },
  })
  const { process } = makeHandler({ db: seeded })
  await fire(process, subDeletedEvent({ evtId: 'evt_deleted', subscription: subFixture(), created: 100 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  const d3 = (await seeded.collection('dogs').doc('d3').get()).data()
  return user.plan === 'free' && user.stripeSubscriptionId === null && user.subscriptionStatus === 'canceled' && d3.status === 'restricted'
})

// ── Monthly <-> Annual switch — §3.1 "No new quota granted" ──────────

await checkAsync('switching Monthly -> Annual on the same subscription does not reset plusScansUsed, only the anchor', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', plusScansUsed: 7, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1, billingInterval: 'monthly', lastKnownSubscriptionId: 'sub_1', subscriptionEventTimestamps: { sub_1: 100 } } },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture({ priceId: CHECKOUT_PRICE_IDS.plus_annual, startDate: 1753315200 }) } })
  await fire(process, subUpdatedEvent({ evtId: 'evt_switch', subscription: subFixture({ id: 'sub_1', status: 'active', priceId: CHECKOUT_PRICE_IDS.plus_annual, startDate: 1753315200 }), created: 200 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plusScansUsed === 7 && user.billingInterval === 'annual' && user.scanPeriodAnchorDay === 24
})

// ── invoice.payment_succeeded — deliberate recovery confirmation ─────

await checkAsync('invoice.payment_succeeded on a past_due account clears pastDueSince and confirms Plus immediately', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: '2026-07-01T00:00:00.000Z', lastKnownSubscriptionId: 'sub_1' } },
    dogs: { r1: { currentOwnerId: 'user-1', status: 'restricted', isDeceased: false, createdAt: '2026-01-01T00:00:00Z' } },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture() } })
  const res = await fire(process, { id: 'evt_paid', type: 'invoice.payment_succeeded', created: 500, data: { object: { subscription: 'sub_1' } } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  const r1 = (await seeded.collection('dogs').doc('r1').get()).data()
  return res.status === 200 && user.plan === 'plus' && user.pastDueSince === null && user.subscriptionStatus === 'active' && r1.status === 'active'
})

await checkAsync('invoice.payment_succeeded on an already-current account is a harmless timestamp update, no plan change', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'plus', subscriptionStatus: 'active', lastKnownSubscriptionId: 'sub_1' } } })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture() } })
  await fire(process, { id: 'evt_paid2', type: 'invoice.payment_succeeded', created: 500, data: { object: { subscription: 'sub_1' } } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plan === 'plus' && user.subscriptionStatus === 'active'
})

await checkAsync('invoice.payment_succeeded for a stale (superseded) subscription is a no-op', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'plus', stripeSubscriptionId: 'sub_new', lastKnownSubscriptionId: 'sub_new', pastDueSince: null } } })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_old: subFixture({ id: 'sub_old' }) } })
  await fire(process, { id: 'evt_paid_stale', type: 'invoice.payment_succeeded', created: 500, data: { object: { subscription: 'sub_old' } } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.stripeSubscriptionId === 'sub_new'
})

// ── invoice.payment_failed — deliberate no-op ─────────────────────────

await checkAsync('invoice.payment_failed is accepted (200) and never throws — deliberately no distinct handling beyond subscription.updated(past_due)', async () => {
  const { process } = makeHandler()
  const res = await fire(process, { id: 'evt_failed_invoice', type: 'invoice.payment_failed', created: 100, data: { object: { subscription: 'sub_1' } } })
  return res.status === 200 && !res.body.duplicate
})

// ── Never deletes data ────────────────────────────────────────────────

check(
  'webhook-handler.js source never calls a Firestore .delete() anywhere (only status/plan field writes) — "never delete data" holds structurally, not just by test coverage',
  !readFileSync(new URL('../api/_lib/webhook-handler.js', import.meta.url), 'utf8').includes('.delete(')
)

await summary()
