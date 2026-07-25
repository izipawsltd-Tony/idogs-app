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
import { createWebhookHandler, claimEvent, runFencedTransaction, evaluateSubscriptionEvent } from '../api/_lib/webhook-handler.js'
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

function subFixture({ id = 'sub_1', priceId = CHECKOUT_PRICE_IDS.plus_monthly, status = 'active', startDate = 1753315200, userId = 'user-1', customer = 'cus_1' } = {}) {
  return {
    id,
    status,
    customer,
    start_date: startDate,
    metadata: { userId, plan: 'plus' },
    items: { data: [{ price: { id: priceId } }] },
  }
}

async function fire(processFn, event, sig = 'good-signature') {
  return processFn(Buffer.from(JSON.stringify(event)), sig)
}

function checkoutEvent({ id, evtId = 'evt_checkout', subscriptionId = 'sub_1', userId = 'user-1', created = 1000, customer = 'cus_1' }) {
  return { id: evtId, type: 'checkout.session.completed', created, data: { object: { metadata: { userId }, subscription: subscriptionId, customer } } }
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

await checkAsync('Codex H1 round 3 regression: a genuine failure AFTER checkout effects have already committed, then a redelivery of the SAME event, still marks the event failed->completed and refreshes tracking fields — but does NOT re-zero plusScansUsed/plusScansPeriodStart, and does NOT reset planActivatedAt, once the user has legitimately consumed scans in between', async () => {
  const seeded = createFakeFirestore()
  let txCallCount = 0
  const wrappedDb = {
    collection: (...args) => seeded.collection(...args),
    async runTransaction(fn) {
      txCallCount++
      // Call 1 = claimEvent, call 2 = the checkout effect transaction
      // (where plan/plusScansUsed actually get written), call 3 = the
      // completion-marking transaction — fail exactly there, simulating
      // a crash/network drop between "effects landed" and "completed
      // recorded".
      if (txCallCount === 3) throw new Error('simulated failure right after effects committed')
      return seeded.runTransaction(fn)
    },
  }
  const process = createWebhookHandler({
    constructEvent: rawBody => JSON.parse(rawBody.toString()),
    getSubscription: async id => subFixture({ id }),
    db: wrappedDb,
    now: () => new Date('2026-07-24T00:00:00Z'),
  })
  const event = checkoutEvent({ evtId: 'evt_late_fail' })

  // ── 1-2: first delivery commits effects, then fails before completion ──
  const res = await fire(process, event)
  const userAfterFailure = (await seeded.collection('users').doc('user-1').get()).data()
  const storedAfterFailure = (await seeded.collection('processedStripeEvents').doc('evt_late_fail').get()).data()
  check('The effect (plan grant + fresh quota) DID commit despite the later failure — separate transactions, no rollback of the first', userAfterFailure?.plan === 'plus' && userAfterFailure?.plusScansUsed === 0)
  check('The event is marked failed, not completed', res.status === 500 && storedAfterFailure.status === 'failed')
  check('plusScansSubscriptionId marker was set to sub_1 on the genuine first activation', userAfterFailure.plusScansSubscriptionId === 'sub_1')
  const originalPlanActivatedAt = userAfterFailure.planActivatedAt
  const originalPeriodStart = userAfterFailure.plusScansPeriodStart
  check('planActivatedAt and plusScansPeriodStart were recorded on the genuine first activation', typeof originalPlanActivatedAt === 'string' && typeof originalPeriodStart === 'string')

  // ── 3: the user consumes AI scans before Stripe redelivers ──
  await seeded.collection('users').doc('user-1').set({ plusScansUsed: 4 }, { merge: true })

  // ── 4-5: Stripe redelivers the exact same event ──
  const retryRes = await fire(process, event)
  const storedAfterRetry = (await seeded.collection('processedStripeEvents').doc('evt_late_fail').get()).data()
  const userAfterRetry = (await seeded.collection('users').doc('user-1').get()).data()

  // ── 6: assertions ──
  check('plusScansUsed remains 4 — NOT reset back to 0 by the retry', userAfterRetry.plusScansUsed === 4, `got ${userAfterRetry.plusScansUsed}`)
  check('plusScansPeriodStart is unchanged from the original activation', userAfterRetry.plusScansPeriodStart === originalPeriodStart)
  check('planActivatedAt is unchanged from the original activation', userAfterRetry.planActivatedAt === originalPlanActivatedAt)
  check('plusScansSubscriptionId marker is unchanged (still sub_1) after the retry — round 4: the marker itself is never corrupted or re-derived by a retry', userAfterRetry.plusScansSubscriptionId === 'sub_1')
  check('plan remains plus', userAfterRetry.plan === 'plus')
  check('the event becomes completed on the retry', retryRes.status === 200 && storedAfterRetry.status === 'completed')
  // Tracking/status fields still legitimately refresh on the retry (not
  // frozen entirely — only the quota-initialization fields are guarded).
  check('subscriptionStatus/billingInterval/stripeSubscriptionId still refresh normally on the retry (only quota-init fields are guarded, not the whole write)', userAfterRetry.subscriptionStatus === 'active' && userAfterRetry.billingInterval === 'monthly' && userAfterRetry.stripeSubscriptionId === 'sub_1')
  return true
})

await checkAsync('a genuinely NEW replacement subscription (A-to-B) still initializes a fresh quota period exactly once — the round-3 guard does not block legitimate new activations', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'free', stripeSubscriptionId: null, stripeCustomerId: 'cus_A', lastKnownSubscriptionId: 'sub_A', subscriptionEventTimestamps: { sub_A: 100 }, plusScansSubscriptionId: 'sub_A', plusScansUsed: 7 /* leftover from the old, now-canceled subscription — must NOT carry over */ } },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_B: subFixture({ id: 'sub_B', customer: 'cus_B' }) } })
  const res = await fire(process, checkoutEvent({ evtId: 'evt_new_sub_b', subscriptionId: 'sub_B', created: 500, customer: 'cus_B' }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return res.status === 200 && user.plan === 'plus' && user.stripeSubscriptionId === 'sub_B' &&
    user.plusScansSubscriptionId === 'sub_B' &&
    user.plusScansUsed === 0 && typeof user.plusScansPeriodStart === 'string' && typeof user.planActivatedAt === 'string'
})

// ── H1 (round 4): plusScansSubscriptionId quota-ownership marker ──────
// Round 3's evaluation.isNewSubscription (derived from
// lastKnownSubscriptionId) broke when Stripe delivers
// customer.subscription.updated(active) for a brand-new subscription B
// BEFORE B's own checkout.session.completed: the updated(active) event
// already makes B "current" (lastKnownSubscriptionId = B) without
// touching quota (deliberate, for Monthly<->Annual switching), so the
// later checkout event sees isNewSubscription: false and never
// initializes B's quota either — B silently inherits whatever
// usage/timestamps the RETIRED subscription A left behind. These tests
// exercise the plusScansSubscriptionId marker fix directly, in both
// possible delivery orders, plus the specific edge cases called out in
// the round-4 task.

await checkAsync('[order 1] subscription.updated(active B) arrives BEFORE checkout(B): the update event initializes B, the later checkout preserves it', async () => {
  const seeded = createFakeFirestore({
    users: {
      'user-1': {
        plan: 'plus', stripeSubscriptionId: 'sub_A', stripeCustomerId: 'cus_A',
        lastKnownSubscriptionId: 'sub_A', subscriptionEventTimestamps: { sub_A: 100 },
        plusScansSubscriptionId: 'sub_A', plusScansUsed: 9,
        plusScansPeriodStart: '2026-01-01T00:00:00.000Z', planActivatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_B: subFixture({ id: 'sub_B', customer: 'cus_B' }) }, nowFn: () => new Date('2026-07-24T00:00:00Z') })

  // subscription.updated(active) for B arrives first.
  const updateRes = await fire(process, subUpdatedEvent({ evtId: 'evt_order1_update', subscription: subFixture({ id: 'sub_B', status: 'active', customer: 'cus_B' }), created: 500 }))
  const afterUpdate = (await seeded.collection('users').doc('user-1').get()).data()
  check('[order 1] the update event alone correctly initializes B\'s quota (marker was sub_A, now sub_B)', updateRes.status === 200 && afterUpdate.plusScansSubscriptionId === 'sub_B' && afterUpdate.plusScansUsed === 0)
  check('[order 1] A\'s leftover usage (9) does not survive into B\'s fresh period', afterUpdate.plusScansUsed !== 9)
  const bPeriodStart = afterUpdate.plusScansPeriodStart
  const bActivatedAt = afterUpdate.planActivatedAt

  // The user consumes 2 scans against B before B's checkout event arrives.
  await seeded.collection('users').doc('user-1').set({ plusScansUsed: 2 }, { merge: true })

  // checkout(B) arrives second.
  const checkoutRes = await fire(process, checkoutEvent({ evtId: 'evt_order1_checkout', subscriptionId: 'sub_B', created: 600, customer: 'cus_B' }))
  const afterCheckout = (await seeded.collection('users').doc('user-1').get()).data()
  check('[order 1] the later checkout(B) is accepted (not stale — B is already current)', checkoutRes.status === 200)
  check('[order 1] checkout(B) preserves B\'s already-consumed usage (2), does not re-zero it', afterCheckout.plusScansUsed === 2, `got ${afterCheckout.plusScansUsed}`)
  check('[order 1] checkout(B) preserves B\'s original period start/activation timestamps', afterCheckout.plusScansPeriodStart === bPeriodStart && afterCheckout.planActivatedAt === bActivatedAt)
  return afterCheckout.plusScansSubscriptionId === 'sub_B'
})

await checkAsync('[order 2] checkout(B) arrives BEFORE subscription.updated(active B): checkout initializes B, the later update preserves usage', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'free' } } })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_B: subFixture({ id: 'sub_B', customer: 'cus_B' }) }, nowFn: () => new Date('2026-07-24T00:00:00Z') })

  const checkoutRes = await fire(process, checkoutEvent({ evtId: 'evt_order2_checkout', subscriptionId: 'sub_B', created: 500, customer: 'cus_B' }))
  const afterCheckout = (await seeded.collection('users').doc('user-1').get()).data()
  check('[order 2] checkout(B) initializes B\'s quota', checkoutRes.status === 200 && afterCheckout.plusScansSubscriptionId === 'sub_B' && afterCheckout.plusScansUsed === 0)
  const bPeriodStart = afterCheckout.plusScansPeriodStart
  const bActivatedAt = afterCheckout.planActivatedAt

  // Non-zero B usage injected before the update event arrives.
  await seeded.collection('users').doc('user-1').set({ plusScansUsed: 6 }, { merge: true })

  const updateRes = await fire(process, subUpdatedEvent({ evtId: 'evt_order2_update', subscription: subFixture({ id: 'sub_B', status: 'active', customer: 'cus_B' }), created: 600 }))
  const afterUpdate = (await seeded.collection('users').doc('user-1').get()).data()
  check('[order 2] the later update(active B) is accepted', updateRes.status === 200)
  check('[order 2] the update preserves B\'s already-consumed usage (6), does not re-zero it', afterUpdate.plusScansUsed === 6, `got ${afterUpdate.plusScansUsed}`)
  check('[order 2] the update preserves B\'s original period start/activation timestamps', afterUpdate.plusScansPeriodStart === bPeriodStart && afterUpdate.planActivatedAt === bActivatedAt)
  return afterUpdate.plusScansSubscriptionId === 'sub_B'
})

await checkAsync('invoice.payment_succeeded recovery that establishes a NEW subscription B initializes quota exactly once; a later B event preserves it', async () => {
  const seeded = createFakeFirestore({
    // A lingering past_due flag from an unrelated, retired history — the
    // account has never had quota initialized for sub_B specifically.
    users: { 'user-1': { plan: 'plus', pastDueSince: '2026-06-01T00:00:00.000Z', stripeSubscriptionId: 'sub_A', stripeCustomerId: 'cus_A' } },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_B: subFixture({ id: 'sub_B', customer: 'cus_B' }) }, nowFn: () => new Date('2026-07-24T00:00:00Z') })

  const invoiceRes = await fire(process, { id: 'evt_invoice_new_b', type: 'invoice.payment_succeeded', created: 500, data: { object: { subscription: 'sub_B', customer: 'cus_B' } } })
  const afterInvoice = (await seeded.collection('users').doc('user-1').get()).data()
  check('invoice.payment_succeeded establishing new B initializes B\'s quota exactly once', invoiceRes.status === 200 && afterInvoice.plusScansSubscriptionId === 'sub_B' && afterInvoice.plusScansUsed === 0)
  const bPeriodStart = afterInvoice.plusScansPeriodStart
  const bActivatedAt = afterInvoice.planActivatedAt

  await seeded.collection('users').doc('user-1').set({ plusScansUsed: 3 }, { merge: true })

  const updateRes = await fire(process, subUpdatedEvent({ evtId: 'evt_invoice_new_b_followup', subscription: subFixture({ id: 'sub_B', status: 'active', customer: 'cus_B' }), created: 600 }))
  const afterUpdate = (await seeded.collection('users').doc('user-1').get()).data()
  check('a later B event preserves the usage accumulated after the invoice-driven activation', updateRes.status === 200 && afterUpdate.plusScansUsed === 3, `got ${afterUpdate.plusScansUsed}`)
  return afterUpdate.plusScansPeriodStart === bPeriodStart && afterUpdate.planActivatedAt === bActivatedAt
})

await checkAsync('a LATE event for retired A, arriving after B is fully current, is rejected — cannot change B\'s marker or quota', async () => {
  const seeded = createFakeFirestore({
    users: {
      'user-1': {
        plan: 'plus', stripeSubscriptionId: 'sub_B', stripeCustomerId: 'cus_B',
        lastKnownSubscriptionId: 'sub_B', subscriptionEventTimestamps: { sub_A: 100, sub_B: 500 },
        plusScansSubscriptionId: 'sub_B', plusScansUsed: 6,
        plusScansPeriodStart: '2026-07-01T00:00:00.000Z', planActivatedAt: '2026-07-01T00:00:00.000Z',
      },
    },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_A: subFixture({ id: 'sub_A', customer: 'cus_A' }) }, nowFn: () => new Date('2026-07-24T00:00:00Z') })

  // A late invoice.payment_succeeded for the retired subscription A.
  const res = await fire(process, { id: 'evt_late_a_invoice', type: 'invoice.payment_succeeded', created: 200, data: { object: { subscription: 'sub_A', customer: 'cus_A' } } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  check('the late A event is accepted for delivery (200) but its effects are rejected as stale internally', res.status === 200)
  check('B\'s marker is untouched by the late A event', user.plusScansSubscriptionId === 'sub_B')
  check('B\'s usage is untouched', user.plusScansUsed === 6)
  check('B\'s period start / activation timestamps are untouched', user.plusScansPeriodStart === '2026-07-01T00:00:00.000Z' && user.planActivatedAt === '2026-07-01T00:00:00.000Z')
  return user.lastKnownSubscriptionId === 'sub_B' && user.stripeCustomerId === 'cus_B'
})

await checkAsync('legacy document with no plusScansSubscriptionId marker at all, but stripeSubscriptionId already names the current subscription: the marker is backfilled WITHOUT resetting legitimate existing usage', async () => {
  const seeded = createFakeFirestore({
    users: {
      // Predates the round-4 marker entirely — no plusScansSubscriptionId
      // field exists on this document (not even as undefined/null; the
      // key is simply absent, as a real pre-migration document would be).
      'user-1': {
        plan: 'plus', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
        lastKnownSubscriptionId: 'sub_1', subscriptionEventTimestamps: { sub_1: 100 },
        plusScansUsed: 8, plusScansPeriodStart: '2026-06-01T00:00:00.000Z', planActivatedAt: '2026-05-01T00:00:00.000Z',
      },
    },
  })
  const { process } = makeHandler({ db: seeded, nowFn: () => new Date('2026-07-24T00:00:00Z') })

  const res = await fire(process, subUpdatedEvent({ evtId: 'evt_legacy_backfill', subscription: subFixture({ id: 'sub_1', status: 'active', customer: 'cus_1' }), created: 900 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  check('the legacy-document event is accepted', res.status === 200)
  check('the marker is backfilled to the account\'s existing current subscription', user.plusScansSubscriptionId === 'sub_1')
  check('legitimate existing usage (8) is NOT reset just because the marker was previously absent', user.plusScansUsed === 8, `got ${user.plusScansUsed}`)
  check('the original period start / activation timestamps are preserved, not reset', user.plusScansPeriodStart === '2026-06-01T00:00:00.000Z' && user.planActivatedAt === '2026-05-01T00:00:00.000Z')
  return true
})

await checkAsync('legacy document with no marker AND a genuinely different/new subscription: full initialization still happens correctly (legacy fallback does not over-preserve)', async () => {
  const seeded = createFakeFirestore({
    users: {
      'user-1': {
        plan: 'plus', stripeSubscriptionId: 'sub_old', stripeCustomerId: 'cus_old',
        lastKnownSubscriptionId: 'sub_old', subscriptionEventTimestamps: { sub_old: 100 },
        plusScansUsed: 8, plusScansPeriodStart: '2026-06-01T00:00:00.000Z', planActivatedAt: '2026-05-01T00:00:00.000Z',
        // no plusScansSubscriptionId — legacy document
      },
    },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_new: subFixture({ id: 'sub_new', customer: 'cus_new' }) }, nowFn: () => new Date('2026-07-24T00:00:00Z') })

  const res = await fire(process, checkoutEvent({ evtId: 'evt_legacy_new_sub', subscriptionId: 'sub_new', created: 900, customer: 'cus_new' }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  check('checkout for a genuinely new subscription is accepted', res.status === 200)
  check('the marker is set to the NEW subscription, not left pointing at the old one', user.plusScansSubscriptionId === 'sub_new')
  return user.plusScansUsed === 0 && user.plusScansPeriodStart !== '2026-06-01T00:00:00.000Z' && user.planActivatedAt !== '2026-05-01T00:00:00.000Z'
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
    processedStripeEvents: { evt_stale: { type: 'checkout.session.completed', status: 'pending', claimedAt: '2026-07-24T00:00:00.000Z', attempts: 1, leaseToken: 'stale-token-from-handler-A' } },
  })
  const { process, db } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture() }, nowFn: () => new Date('2026-07-24T00:01:00.000Z') /* 60s later, past the 55s threshold */ })
  const res = await fire(process, checkoutEvent({ evtId: 'evt_stale' }))
  const stored = db._dump('processedStripeEvents')['evt_stale']
  const user = (await db.collection('users').doc('user-1').get()).data()
  return res.status === 200 && !res.body.duplicate && stored.status === 'completed' && stored.attempts === 2 && user.plan === 'plus' && stored.leaseToken !== 'stale-token-from-handler-A'
})

// ── H1 (round 2): lease-token fencing — the core new mechanism ────────
// Tests the exported claimEvent/runFencedTransaction primitives directly
// (same DI-testability pattern as api/_lib/create-dog-core.js), since a
// genuinely slow-but-not-crashed handler being reclaimed mid-flight can't
// be reliably reproduced by racing two black-box processWebhook() calls
// (there is no hook to pause one mid-transaction) — the primitives are
// exactly what processWebhook itself is built from, so testing them
// directly is testing the real mechanism, not a reimplementation.

await checkAsync('genuinely concurrent claimEvent() calls for the SAME brand-new event: exactly one wins, the other is told it\'s a duplicate — no double-claim', async () => {
  const seeded = createFakeFirestore()
  const eventRef = seeded.collection('processedStripeEvents').doc('evt_race')
  const now = () => new Date('2026-07-24T00:00:00Z')
  const [a, b] = await Promise.all([
    claimEvent(seeded, eventRef, 'checkout.session.completed', now),
    claimEvent(seeded, eventRef, 'checkout.session.completed', now),
  ])
  const claimedCount = [a, b].filter(r => r.claimed).length
  const winner = a.claimed ? a : b
  const loser = a.claimed ? b : a
  return claimedCount === 1 && typeof winner.leaseToken === 'string' && winner.leaseToken.length > 0 && loser.claimed === false
})

await checkAsync('a RECLAIMED (stale) handler\'s late write, using its now-superseded leaseToken, is fenced out — does not commit', async () => {
  const seeded = createFakeFirestore()
  const eventRef = seeded.collection('processedStripeEvents').doc('evt_reclaim')
  const userRef = seeded.collection('users').doc('user-1')

  // Handler A claims, then goes silent (simulating a genuinely slow —
  // not crashed — invocation, e.g. a hung downstream Stripe API call).
  const claimA = await claimEvent(seeded, eventRef, 'checkout.session.completed', () => new Date('2026-07-24T00:00:00Z'))
  check('Handler A\'s initial claim succeeds', claimA.claimed === true)

  // 60s later (past STALE_PENDING_MS), a redelivery reclaims the event —
  // handler B is now the legitimate owner, holding a DIFFERENT token.
  const claimB = await claimEvent(seeded, eventRef, 'checkout.session.completed', () => new Date('2026-07-24T00:01:00Z'))
  check('Handler B successfully reclaims the stale event with a fresh token', claimB.claimed === true && claimB.leaseToken !== claimA.leaseToken)

  // Handler B does its (legitimate) work first.
  const bResult = await runFencedTransaction(seeded, eventRef, claimB.leaseToken, async tx => {
    tx.set(userRef, { plan: 'plus', plusScansUsed: 0 }, { merge: true })
  })
  check('Handler B\'s write commits (fenced:false)', bResult.fenced === false)

  // NOW handler A, unaware it was ever reclaimed, finally wakes up and
  // tries to commit using its OLD (superseded) token.
  const aResult = await runFencedTransaction(seeded, eventRef, claimA.leaseToken, async tx => {
    tx.set(userRef, { plan: 'plus', plusScansUsed: 0, corruptedByStaleHandlerA: true }, { merge: true })
  })
  check('Handler A\'s late write is fenced out (fenced:true) — never runs', aResult.fenced === true)

  const user = (await userRef.get()).data()
  return user.corruptedByStaleHandlerA === undefined
})

await checkAsync('a reclaimed handler cannot mark completion either — only the current lease holder can', async () => {
  const seeded = createFakeFirestore()
  const eventRef = seeded.collection('processedStripeEvents').doc('evt_reclaim_complete')
  const claimA = await claimEvent(seeded, eventRef, 'checkout.session.completed', () => new Date('2026-07-24T00:00:00Z'))
  const claimB = await claimEvent(seeded, eventRef, 'checkout.session.completed', () => new Date('2026-07-24T00:01:00Z'))

  // A tries to mark the event completed using its stale token.
  const aComplete = await runFencedTransaction(seeded, eventRef, claimA.leaseToken, async tx => {
    tx.set(eventRef, { status: 'completed', completedAt: 'FROM-STALE-HANDLER-A' }, { merge: true })
  })
  check('Handler A cannot mark completion (fenced:true)', aComplete.fenced === true)

  // B (the legitimate current owner) can.
  const bComplete = await runFencedTransaction(seeded, eventRef, claimB.leaseToken, async tx => {
    tx.set(eventRef, { status: 'completed', completedAt: 'FROM-HANDLER-B' }, { merge: true })
  })
  check('Handler B CAN mark completion (fenced:false)', bComplete.fenced === false)

  const stored = (await eventRef.get()).data()
  return stored.status === 'completed' && stored.completedAt === 'FROM-HANDLER-B'
})

await checkAsync('Codex H1 core regression: a reclaimed handler\'s late "duplicate checkout" write can never reset plusScansUsed after the legitimate owner already completed and the user has since used scans', async () => {
  const seeded = createFakeFirestore()
  const eventRef = seeded.collection('processedStripeEvents').doc('evt_scans_regression')
  const userRef = seeded.collection('users').doc('user-1')

  const claimA = await claimEvent(seeded, eventRef, 'checkout.session.completed', () => new Date('2026-07-24T00:00:00Z'))
  const claimB = await claimEvent(seeded, eventRef, 'checkout.session.completed', () => new Date('2026-07-24T00:01:00Z'))

  // B legitimately applies the checkout — fresh Plus grant, 0 scans used.
  await runFencedTransaction(seeded, eventRef, claimB.leaseToken, async tx => {
    tx.set(userRef, { plan: 'plus', plusScansUsed: 0 }, { merge: true })
  })
  // B marks completion.
  await runFencedTransaction(seeded, eventRef, claimB.leaseToken, async tx => {
    tx.set(eventRef, { status: 'completed', completedAt: 'now' }, { merge: true })
  })

  // Time passes; the user legitimately uses 3 AI scans.
  await userRef.set({ plusScansUsed: 3 }, { merge: true })

  // Handler A FINALLY wakes up and attempts the exact write it would have
  // made — re-zeroing plusScansUsed as if this were a fresh checkout.
  const aLateAttempt = await runFencedTransaction(seeded, eventRef, claimA.leaseToken, async tx => {
    tx.set(userRef, { plan: 'plus', plusScansUsed: 0 }, { merge: true })
  })

  const user = (await userRef.get()).data()
  return aLateAttempt.fenced === true && user.plusScansUsed === 3 // NOT reset back to 0
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

await checkAsync('a SUPERSEDED subscription\'s late deleted event (the account has already recorded events for it in the past, then moved on) is a no-op, does not downgrade', async () => {
  const seeded = createFakeFirestore({
    // sub_old is PREVIOUSLY KNOWN (present in subscriptionEventTimestamps)
    // but no longer current — exactly the "moved away from" case that
    // must stay rejected. This is different from a subscription id the
    // account has NEVER seen before (see the A-to-B replacement tests
    // below), which must NOT be rejected.
    users: { 'user-1': { plan: 'plus', stripeSubscriptionId: 'sub_new', stripeCustomerId: 'cus_new', lastKnownSubscriptionId: 'sub_new', subscriptionEventTimestamps: { sub_old: 50, sub_new: 500 } } },
    dogs: {
      d1: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-01T00:00:00Z' },
      d2: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-02T00:00:00Z' },
      d3: { currentOwnerId: 'user-1', status: 'active', isDeceased: false, createdAt: '2026-01-03T00:00:00Z' },
    },
  })
  const { process } = makeHandler({ db: seeded })
  const res = await fire(process, subDeletedEvent({ evtId: 'evt_old_delete', subscription: subFixture({ id: 'sub_old', customer: 'cus_old' }), created: 100 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  const d3 = (await seeded.collection('dogs').doc('d3').get()).data()
  return res.status === 200 && user.plan === 'plus' && user.stripeSubscriptionId === 'sub_new' && d3.status === 'active'
})

await checkAsync('a SUPERSEDED subscription\'s late updated(active) event is a no-op, does not re-grant/overwrite the current subscription id', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', stripeSubscriptionId: 'sub_new', stripeCustomerId: 'cus_new', billingInterval: 'annual', lastKnownSubscriptionId: 'sub_new', subscriptionEventTimestamps: { sub_old: 30, sub_new: 500 } } },
  })
  const { process } = makeHandler({ db: seeded })
  await fire(process, subUpdatedEvent({ evtId: 'evt_old_update', subscription: subFixture({ id: 'sub_old', status: 'active', priceId: CHECKOUT_PRICE_IDS.plus_monthly, customer: 'cus_old' }), created: 50 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.billingInterval === 'annual' && user.stripeSubscriptionId === 'sub_new'
})

// ── H5 (round 2): A-to-B legitimate subscription replacement ──────────
// The core round-1 bug: ANY different subscription id was treated as
// stale, which didn't just block a late/old event — it permanently
// blocked switching to a genuinely NEW subscription too, since the new
// id is also "different" from the old one.

await checkAsync('subscription A canceled, then subscription B activated (a genuine cancel-and-resubscribe): B\'s checkout IS applied, not rejected as stale', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'free', stripeSubscriptionId: null, stripeCustomerId: 'cus_A', lastKnownSubscriptionId: 'sub_A', subscriptionEventTimestamps: { sub_A: 100 } } },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_B: subFixture({ id: 'sub_B', customer: 'cus_B' }) } })
  const res = await fire(process, checkoutEvent({ evtId: 'evt_b_activated', subscriptionId: 'sub_B', created: 500 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return res.status === 200 && user.plan === 'plus' && user.stripeSubscriptionId === 'sub_B' && user.lastKnownSubscriptionId === 'sub_B'
})

await checkAsync('once B is current, a LATE event for A (arriving after B) is ignored — does not resurrect A or overwrite B', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', stripeSubscriptionId: 'sub_B', stripeCustomerId: 'cus_B', lastKnownSubscriptionId: 'sub_B', subscriptionEventTimestamps: { sub_A: 100, sub_B: 500 } } },
  })
  const { process } = makeHandler({ db: seeded })
  // A late subscription.updated(past_due) for A, timestamped BEFORE B's
  // own recorded event but delivered (arrives) after B is already current.
  await fire(process, subUpdatedEvent({ evtId: 'evt_late_a', subscription: subFixture({ id: 'sub_A', status: 'past_due', customer: 'cus_A' }), created: 200 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plan === 'plus' && user.stripeSubscriptionId === 'sub_B' && user.pastDueSince === undefined
})

await checkAsync('a subscription id NEVER seen before is always treated as a legitimate new subscription, even via subscription.updated (not just checkout)', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'free' } }, // brand-new account, no subscription history at all
  })
  const { process } = makeHandler({ db: seeded })
  await fire(process, subUpdatedEvent({ evtId: 'evt_bootstrap', subscription: subFixture({ id: 'sub_fresh', status: 'active', customer: 'cus_fresh' }), created: 10 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.plan === 'plus' && user.lastKnownSubscriptionId === 'sub_fresh' && user.stripeCustomerId === 'cus_fresh'
})

// ── H5 (round 2): same-second events must not be dropped ──────────────

await checkAsync('two DISTINCT events for the same subscription sharing the exact same event.created second are BOTH applied (Stripe timestamps are only second-resolution)', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', stripeCustomerId: 'cus_1', lastKnownSubscriptionId: 'sub_1', subscriptionEventTimestamps: { sub_1: 500 } } },
  })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_1: subFixture({ id: 'sub_1', customer: 'cus_1' }) } })
  // Both timestamped 1000 — a same-second tie.
  const first = await fire(process, subUpdatedEvent({ evtId: 'evt_tie_1', subscription: subFixture({ id: 'sub_1', status: 'past_due' }), created: 1000 }))
  const afterFirst = (await seeded.collection('users').doc('user-1').get()).data()
  const second = await fire(process, { id: 'evt_tie_2', type: 'invoice.payment_succeeded', created: 1000, data: { object: { subscription: 'sub_1', customer: 'cus_1' } } })
  const afterSecond = (await seeded.collection('users').doc('user-1').get()).data()
  return first.status === 200 && afterFirst.subscriptionStatus === 'past_due' && typeof afterFirst.pastDueSince === 'string' &&
    second.status === 200 && afterSecond.plan === 'plus' && afterSecond.pastDueSince === null // the second, same-second event (payment recovery) still applied
})

await checkAsync('same-second checkout.session.completed and customer.subscription.updated for the same new subscription are BOTH applied, neither dropped as a tie', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'free' } } })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_tie: subFixture({ id: 'sub_tie', customer: 'cus_tie' }) } })
  const checkoutRes = await fire(process, checkoutEvent({ evtId: 'evt_tie_checkout', subscriptionId: 'sub_tie', created: 2000, customer: 'cus_tie' }))
  const updateRes = await fire(process, subUpdatedEvent({ evtId: 'evt_tie_update', subscription: subFixture({ id: 'sub_tie', status: 'active', priceId: CHECKOUT_PRICE_IDS.plus_annual, customer: 'cus_tie' }), created: 2000 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return checkoutRes.status === 200 && updateRes.status === 200 && user.plan === 'plus' && user.billingInterval === 'annual'
})

// ── H5 (round 2): customer ownership ───────────────────────────────────

await checkAsync('an event for the CURRENT subscription carrying a MISMATCHED customer id is rejected (data-integrity anomaly, never trusted)', async () => {
  const seeded = createFakeFirestore({
    users: { 'user-1': { plan: 'plus', subscriptionStatus: 'active', stripeCustomerId: 'cus_real', lastKnownSubscriptionId: 'sub_1', subscriptionEventTimestamps: { sub_1: 100 } } },
  })
  const { process } = makeHandler({ db: seeded })
  await fire(process, subUpdatedEvent({ evtId: 'evt_customer_mismatch', subscription: subFixture({ id: 'sub_1', status: 'past_due', customer: 'cus_impostor' }), created: 900 }))
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.subscriptionStatus === 'active' && user.pastDueSince === undefined && user.stripeCustomerId === 'cus_real'
})

await checkAsync('evaluateSubscriptionEvent: a brand-new subscription freely adopts any customer id (safe first-association), even if the account had a DIFFERENT customer id on an old, superseded subscription', () => {
  const profile = { lastKnownSubscriptionId: 'sub_old', stripeCustomerId: 'cus_old', subscriptionEventTimestamps: { sub_old: 100 } }
  const result = evaluateSubscriptionEvent(profile, { subscriptionId: 'sub_new', eventCreated: 200, eventCustomerId: 'cus_new' })
  return result.stale === false && result.isNewSubscription === true
})
check(
  'evaluateSubscriptionEvent: the CURRENT subscription with no stored customer id yet (first-ever association) is never rejected for "mismatch"',
  evaluateSubscriptionEvent({ lastKnownSubscriptionId: 'sub_1', subscriptionEventTimestamps: { sub_1: 100 } }, { subscriptionId: 'sub_1', eventCreated: 200, eventCustomerId: 'cus_1' }).stale === false
)

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
    // stripeSubscriptionId included: every real code path that sets
    // lastKnownSubscriptionId (the original checkout, in this case) sets
    // it together with stripeSubscriptionId — a realistic prior state,
    // not a round-4-specific addition. Codex H1 (round 4): also needed
    // for quotaInitFields' legacy-compatibility fallback to correctly
    // recognize sub_1 as already-current and preserve plusScansUsed.
    users: { 'user-1': { plan: 'plus', stripeSubscriptionId: 'sub_1', plusScansUsed: 7, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1, billingInterval: 'monthly', lastKnownSubscriptionId: 'sub_1', subscriptionEventTimestamps: { sub_1: 100 } } },
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

await checkAsync('invoice.payment_succeeded for a SUPERSEDED (previously known, no longer current) subscription is a no-op', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'plus', stripeSubscriptionId: 'sub_new', stripeCustomerId: 'cus_new', lastKnownSubscriptionId: 'sub_new', subscriptionEventTimestamps: { sub_old: 50 }, pastDueSince: null } } })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_old: subFixture({ id: 'sub_old', customer: 'cus_old' }) } })
  await fire(process, { id: 'evt_paid_stale', type: 'invoice.payment_succeeded', created: 500, data: { object: { subscription: 'sub_old', customer: 'cus_old' } } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.stripeSubscriptionId === 'sub_new'
})

await checkAsync('invoice.payment_succeeded for a subscription id NEVER seen before is applied (new-subscription bootstrap, not rejected as stale)', async () => {
  const seeded = createFakeFirestore({ users: { 'user-1': { plan: 'free' } } })
  const { process } = makeHandler({ db: seeded, subscriptions: { sub_boot: subFixture({ id: 'sub_boot', customer: 'cus_boot' }) } })
  await fire(process, { id: 'evt_paid_boot', type: 'invoice.payment_succeeded', created: 500, data: { object: { subscription: 'sub_boot', customer: 'cus_boot' } } })
  const user = (await seeded.collection('users').doc('user-1').get()).data()
  return user.lastKnownSubscriptionId === 'sub_boot' && user.stripeCustomerId === 'cus_boot'
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
