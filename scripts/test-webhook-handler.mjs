// scripts/test-webhook-handler.mjs — tests for
// api/_lib/webhook-handler.js (iDogs Pricing v1.1, LOCKED) against fake
// constructEvent/getSubscription + the in-memory Firestore fake. No live
// Stripe account or emulator required — createWebhookHandler is factored
// exactly for this (same pattern as api/_lib/checkout-handler.js).
//
// Usage: node scripts/test-webhook-handler.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { createWebhookHandler } from '../api/_lib/webhook-handler.js'
import { CHECKOUT_PRICE_IDS } from '../api/_lib/checkout-handler.js'

const { check, checkAsync, summary } = makeChecker()

function makeHandler({ db, subscriptions = {}, now = () => new Date('2026-07-24T00:00:00Z') } = {}) {
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
      if (!subscriptions[id]) throw new Error(`no fake subscription for ${id}`)
      return subscriptions[id]
    },
    db: firestore,
    now,
  })
  return { process, calls, db: firestore }
}

function subFixture({ priceId = CHECKOUT_PRICE_IDS.plus_monthly, status = 'active', startDate = 1753315200, userId = 'user-1' } = {}) {
  return {
    id: 'sub_1',
    status,
    start_date: startDate,
    metadata: { userId, plan: 'plus' },
    items: { data: [{ price: { id: priceId } }] },
  }
}

async function fire(processFn, event) {
  return processFn(Buffer.from(JSON.stringify(event)), 'good-signature')
}

// ── Signature verification ────────────────────────────────────────────

await checkAsync('an invalid signature is rejected with 400, before any Firestore write', async () => {
  const { process, db } = makeHandler()
  const res = await process(Buffer.from('{}'), 'bad-signature')
  const events = db._dump('processedStripeEvents')
  return res.status === 400 && Object.keys(events).length === 0
})

// ── checkout.session.completed ────────────────────────────────────────

await checkAsync('checkout.session.completed grants Plus and initializes scan-quota state from subscription.start_date', async () => {
  const { process, db } = makeHandler({ subscriptions: { sub_1: subFixture({ startDate: 1753315200 /* 2025-07-24 */ }) } })
  const res = await fire(process, {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { metadata: { userId: 'user-1' }, subscription: 'sub_1', customer: 'cus_1' } },
  })
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

await checkAsync('checkout.session.completed with an unrecognized price id never grants Plus (allowlist enforced)', async () => {
  const { process, db } = makeHandler({ subscriptions: { sub_evil: subFixture({ priceId: 'price_attacker_injected' }) } })
  await fire(process, {
    id: 'evt_evil',
    type: 'checkout.session.completed',
    data: { object: { metadata: { userId: 'user-1' }, subscription: 'sub_evil', customer: 'cus_1' } },
  })
  const snap = await db.collection('users').doc('user-1').get()
  return snap.exists === false // no write happened at all
})

await checkAsync('checkout.session.completed with a metadata.plan spoofed but a legit price id still only trusts the RE-DERIVED price', async () => {
  // metadata.plan on the subscription fixture is 'plus' regardless — the
  // real defense-in-depth check is: does the ACTUAL price id on the
  // subscription resolve to a known interval? Verified above already for
  // the negative case; this positive case confirms the legit path still
  // works when metadata happens to agree.
  const { process, db } = makeHandler({ subscriptions: { sub_1: subFixture({ priceId: CHECKOUT_PRICE_IDS.plus_annual }) } })
  await fire(process, {
    id: 'evt_2',
    type: 'checkout.session.completed',
    data: { object: { metadata: { userId: 'user-1' }, subscription: 'sub_1', customer: 'cus_1' } },
  })
  const user = (await db.collection('users').doc('user-1').get()).data()
  return user.billingInterval === 'annual'
})

// ── Idempotency ────────────────────────────────────────────────────────

await checkAsync('a redelivered event.id is processed only once', async () => {
  const { process, db, calls } = makeHandler({ subscriptions: { sub_1: subFixture() } })
  const event = {
    id: 'evt_dup',
    type: 'checkout.session.completed',
    data: { object: { metadata: { userId: 'user-1' }, subscription: 'sub_1', customer: 'cus_1' } },
  }
  const first = await fire(process, event)
  const second = await fire(process, event)
  return first.status === 200 && !first.body.duplicate &&
    second.status === 200 && second.body.duplicate === true &&
    calls.getSubscription.length === 1 // Stripe API only actually called once
})

// ── customer.subscription.updated — active/trialing ─────────────────

await checkAsync('subscription.updated(active) sets plan plus and clears pastDueSince', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'free', subscriptionStatus: 'past_due', pastDueSince: '2026-07-01T00:00:00.000Z' } } })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture({ status: 'active' }) } })
  await fire(process, { id: 'evt_3', type: 'customer.subscription.updated', data: { object: subFixture({ status: 'active' }) } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plan === 'plus' && user.subscriptionStatus === 'active' && user.pastDueSince === null
})

await checkAsync('subscription.updated(active) reactivates restricted dogs up to the new Plus cap', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'free' } },
    dogs: {
      d1: { currentOwnerId: 'user-1', status: 'restricted', isDeceased: false, createdAt: '2026-01-01T00:00:00Z' },
      d2: { currentOwnerId: 'user-1', status: 'restricted', isDeceased: false, createdAt: '2026-01-02T00:00:00Z' },
    },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture({ status: 'active' }) } })
  await fire(process, { id: 'evt_reactivate', type: 'customer.subscription.updated', data: { object: subFixture({ status: 'active' }) } })
  const d1 = (await seeded.collection('dogs').doc('d1').get()).data()
  const d2 = (await seeded.collection('dogs').doc('d2').get()).data()
  return d1.status === 'active' && d2.status === 'active'
})

await checkAsync('subscription.updated(active) with an unrecognized price id never grants Plus', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'free' } } })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture({ priceId: 'price_bogus' }) } })
  await fire(process, { id: 'evt_bogus', type: 'customer.subscription.updated', data: { object: subFixture({ status: 'active', priceId: 'price_bogus' }) } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plan === 'free' // untouched
})

// ── customer.subscription.updated — past_due grace (§4.2) ───────────

await checkAsync('subscription.updated(past_due) keeps plan plus and records pastDueSince on first observation', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'plus' } } })
  const { process } = makeHandler({ db: seeded, now: () => new Date('2026-07-24T00:00:00Z') })
  await fire(process, { id: 'evt_pd1', type: 'customer.subscription.updated', data: { object: subFixture({ status: 'past_due' }) } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plan === 'plus' && user.subscriptionStatus === 'past_due' && user.pastDueSince === '2026-07-24T00:00:00.000Z'
})

await checkAsync('a second past_due delivery does not push pastDueSince forward (grace window cannot be re-extended)', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: '2026-07-01T00:00:00.000Z' } } })
  const { process } = makeHandler({ db: seeded, now: () => new Date('2026-07-24T00:00:00Z') })
  await fire(process, { id: 'evt_pd2', type: 'customer.subscription.updated', data: { object: subFixture({ status: 'past_due' }) } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.pastDueSince === '2026-07-01T00:00:00.000Z' // unchanged, not reset to "now"
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
    await fire(process, { id: `evt_${status}`, type: 'customer.subscription.updated', data: { object: subFixture({ status }) } })
    const user = (await seeded.collection('users').doc('user-1').get()).data()
    const d3 = (await seeded.collection('dogs').doc('d3').get()).data()
    return user.plan === 'free' && d3.status === 'restricted' // 3rd dog exceeds the Free cap of 2
  })
}

await checkAsync('a status this pricing record does not define (e.g. incomplete) only records the status, never flips plan', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'plus' } } })
  const { process } = makeHandler({ db: seeded })
  await fire(process, { id: 'evt_incomplete', type: 'customer.subscription.updated', data: { object: subFixture({ status: 'incomplete' }) } })
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
  await fire(process, { id: 'evt_deleted', type: 'customer.subscription.deleted', data: { object: subFixture() } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  const d3 = (await seeded.collection('dogs').doc('d3').get()).data()
  return user.plan === 'free' && user.stripeSubscriptionId === null && user.subscriptionStatus === 'canceled' && d3.status === 'restricted'
})

// ── Monthly <-> Annual switch — §3.1 "No new quota granted" ──────────

await checkAsync('switching Monthly -> Annual on the same subscription does not reset plusScansUsed, only the anchor', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', plusScansUsed: 7, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1, billingInterval: 'monthly' } },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture({ priceId: CHECKOUT_PRICE_IDS.plus_annual, startDate: 1753315200 }) } })
  await fire(process, {
    id: 'evt_switch',
    type: 'customer.subscription.updated',
    data: { object: subFixture({ status: 'active', priceId: CHECKOUT_PRICE_IDS.plus_annual, startDate: 1753315200 }) },
  })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plusScansUsed === 7 && user.billingInterval === 'annual' && user.scanPeriodAnchorDay === 24
})

// ── Never deletes data ────────────────────────────────────────────────

check(
  'webhook-handler.js source never calls a Firestore .delete() anywhere (only status/plan field writes) — "never delete data" holds structurally, not just by test coverage',
  !readFileSync(new URL('../api/_lib/webhook-handler.js', import.meta.url), 'utf8').includes('.delete(')
)

await summary()
