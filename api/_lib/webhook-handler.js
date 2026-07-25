// api/_lib/webhook-handler.js — trusted Stripe webhook processing for
// iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md, LOCKED). Factored
// out of api/stripe-webhook.js (same pattern as
// api/_lib/checkout-handler.js) so it can be unit-tested with fake
// constructEvent/getSubscription/db, without a live Stripe account or the
// Vercel request/response shape.
//
// Entitlements are derived ONLY from verified Stripe events — never from
// anything a client submits directly. The actual subscription price id is
// re-checked against the allowlisted CHECKOUT_PRICE_IDS on every event
// (not just trusted from metadata.plan) so a subscription somehow carrying
// an unrecognized price can never grant Plus.
//
// Codex H1 (idempotency + fencing, round 1 + round 2):
// processedStripeEvents/{eventId} is a pending -> completed | failed state
// machine, not a single "exists means processed" flag. An event is marked
// completed ONLY after its entitlement effects have actually landed; a
// transient failure marks it failed (retriable), never completed. A stuck
// 'pending' (the owning invocation crashed without reaching either
// terminal state) is reclaimed once stale rather than wedging that event
// forever.
//
// Round 2 hardening: the round-1 reclaim had no unique lease token, so a
// genuinely SLOW (not crashed) handler could be reclaimed by a redelivery
// while still mid-flight — both the original and the reclaiming handler
// would then be racing to apply effects and mark completion, with
// whichever committed LAST silently winning (e.g. re-zeroing
// plusScansUsed a second time). Every claim now mints a cryptographically
// random `leaseToken` (claimEvent), and every subsequent Firestore write
// this invocation makes — every entitlement effect, and the final
// completed/failed marking — re-verifies (inside the SAME transaction as
// the write, via runFencedTransaction) that its leaseToken still matches
// what's currently stored on processedStripeEvents/{eventId}. A reclaimed
// (fenced-out) invocation's every subsequent write silently no-ops: it
// can neither commit an effect nor mark completion/failure, so it can
// never step on the reclaiming invocation's work.
//
// Codex H5 (event ordering, round 1 + round 2): every event that touches
// subscription state is evaluated by evaluateSubscriptionEvent() before
// anything is applied.
//
// Round 2 fixes three real bugs in the round-1 version:
//   1. ANY subscription id different from the stored lastKnownSubscriptionId
//      was treated as stale — this didn't just block a late/old event, it
//      also permanently blocked a legitimate A-to-B subscription
//      replacement (cancel A, buy B) from ever being applied, since B's
//      id is "different" from A too. Now: a subscription id NEVER SEEN
//      BEFORE is always a legitimate new-subscription transition; only an
//      id the account has SPECIFICALLY moved away from (present in
//      subscriptionEventTimestamps, but not the current one) is rejected
//      as stale.
//   2. Same-subscription ordering used `eventCreated <= lastSeen`, which
//      drops the SECOND of two genuinely distinct events sharing the same
//      Stripe `created` second (Stripe's event timestamp has only
//      one-second resolution, and two different event types firing in
//      the same window is unremarkable). Changed to strict `<` — only a
//      provably OLDER event is rejected; a same-second event is let
//      through, since there is no reliable secondary ordering signal to
//      drop it in favor of.
//   3. No customer-id ownership check existed at all. evaluateSubscriptionEvent
//      now rejects an event for the CURRENT subscription whose customer id
//      doesn't match the one already on record (once one is on record) —
//      a brand-new subscription (case 1 above) is a safe first/re-
//      association and always adopts whatever customer id it carries.

import { randomBytes } from 'node:crypto'
import { CHECKOUT_PRICE_IDS } from './checkout-handler.js'
import { reconcileDogCapTx, reactivateUpToCapTx } from './dog-cap.js'
import { anchorDayFromDate } from './entitlements.js'

const PRICE_INTERVAL = Object.freeze({
  [CHECKOUT_PRICE_IDS.plus_monthly]: 'monthly',
  [CHECKOUT_PRICE_IDS.plus_annual]: 'annual',
})

function resolveInterval(subscription) {
  const items = subscription?.items?.data || []
  for (const item of items) {
    const priceId = item?.price?.id
    if (priceId && PRICE_INTERVAL[priceId]) return PRICE_INTERVAL[priceId]
  }
  return null
}

function extractUserId(obj) {
  const id = obj?.metadata?.userId
  return typeof id === 'string' && id.length > 0 ? id : null
}

function subscriptionStartAnchorDay(subscription) {
  const startSeconds = typeof subscription?.start_date === 'number' ? subscription.start_date : Date.now() / 1000
  return anchorDayFromDate(new Date(startSeconds * 1000))
}

function subscriptionIdOf(invoiceOrSub) {
  const raw = invoiceOrSub?.subscription
  if (typeof raw === 'string') return raw
  if (raw && typeof raw.id === 'string') return raw.id
  return null
}

// A Stripe object's `.customer` field is either a plain id string or (if
// the caller expanded it) an object with `.id` — same shape convention as
// subscriptionIdOf above, applied to session/subscription/invoice objects
// alike (all three carry a `.customer` field in Stripe's schema).
function customerIdOf(obj) {
  const raw = obj?.customer
  if (typeof raw === 'string') return raw
  if (raw && typeof raw.id === 'string') return raw.id
  return null
}

// Codex H5 (round 2) — the single decision point for whether a
// subscription-touching event may be applied. Three independent
// questions, each with its own comment below; ANY of them failing makes
// the whole event stale (not applied).
export function evaluateSubscriptionEvent(profile, { subscriptionId, eventCreated, eventCustomerId }) {
  const knownTimestamps = profile?.subscriptionEventTimestamps || {}
  const isCurrentSubscription = !!profile?.lastKnownSubscriptionId && profile.lastKnownSubscriptionId === subscriptionId
  const isPreviouslyKnownSubscription = Object.prototype.hasOwnProperty.call(knownTimestamps, subscriptionId)

  // (1) Subscription identity: a subscription id the account has
  // PREVIOUSLY recorded events for, but which is no longer the current
  // one, is a superseded subscription — a late event for it (e.g. a
  // delayed cancellation of subscription A arriving after the account
  // has already moved on to subscription B) must never be applied. A
  // subscription id NEVER seen before is always a legitimate new
  // subscription (the A-to-B replacement case) — including the very
  // first subscription a brand-new account ever gets.
  if (!isCurrentSubscription && isPreviouslyKnownSubscription) {
    return { stale: true, reason: 'SUPERSEDED_SUBSCRIPTION' }
  }

  // (2) Same-subscription ordering: only a PROVABLY older event (strictly
  // earlier `created`) is stale. Stripe's `created` has one-second
  // resolution — two distinct, valid events can legitimately share a
  // timestamp, and there is no reliable secondary signal to rank them by,
  // so a same-second event is always let through rather than dropped.
  if (isCurrentSubscription) {
    const lastSeen = knownTimestamps[subscriptionId]
    if (typeof lastSeen === 'number' && typeof eventCreated === 'number' && eventCreated < lastSeen) {
      return { stale: true, reason: 'OUT_OF_ORDER' }
    }
  }

  // (3) Customer ownership: once a customer id is on record for the
  // CURRENT subscription, an event for that same subscription carrying a
  // DIFFERENT customer id is a data-integrity anomaly, never trusted. A
  // new subscription (isCurrentSubscription false, case 1 above already
  // let it through) is a safe first/re-association — its customer id is
  // simply adopted below, whatever it is.
  if (isCurrentSubscription && profile?.stripeCustomerId && eventCustomerId && profile.stripeCustomerId !== eventCustomerId) {
    return { stale: true, reason: 'CUSTOMER_MISMATCH' }
  }

  return { stale: false, isNewSubscription: !isCurrentSubscription }
}

// Read-modify-write on the plain object rather than a Firestore
// dotted-path merge, so behavior is identical between the real Admin SDK
// and the in-memory test fake (which does not special-case dotted keys).
function withUpdatedTimestamp(profile, subscriptionId, eventCreated) {
  return { ...(profile?.subscriptionEventTimestamps || {}), [subscriptionId]: eventCreated }
}

// Fields to merge onto the user profile whenever a subscription event is
// accepted (evaluateSubscriptionEvent returned stale:false): the ordering
// timestamp always advances, and — Codex H5 round 2, point 3 above — a
// customer id is (re-)adopted whenever the event carries one, which is
// always safe post-validation (either it's a new subscription, freely
// adopting any customer id, or it's the current subscription with an
// ALREADY-matching one).
function subscriptionTrackingFields(profile, subscriptionId, eventCreated, eventCustomerId) {
  const fields = {
    lastKnownSubscriptionId: subscriptionId,
    subscriptionEventTimestamps: withUpdatedTimestamp(profile, subscriptionId, eventCreated),
  }
  if (eventCustomerId) fields.stripeCustomerId = eventCustomerId
  return fields
}

// Stripe subscription.status values this pricing record defines explicit
// behavior for. Anything else (incomplete, paused, ...) only has its
// status recorded — plan is never silently flipped for a status this
// record doesn't cover.
const ACTIVE_STATUSES = new Set(['active', 'trialing'])
const DOWNGRADE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired'])

// Codex H1 — how stale a 'pending' claim must be before a redelivery may
// reclaim it. Comfortably under Vercel's default serverless function
// timeout, so a genuinely still-in-flight invocation is never reclaimed
// out from under itself; a crashed OR genuinely-stuck one (no timeout,
// hard kill, cold start eviction, a hung downstream API call) doesn't
// wedge the event forever either — round 2's lease-token fencing is what
// makes reclaiming a STILL-RUNNING (not actually crashed) invocation safe
// to do at all, since that invocation's late writes are now guaranteed to
// no-op instead of racing the reclaiming one.
const STALE_PENDING_MS = 55 * 1000

function generateLeaseToken() {
  return randomBytes(16).toString('hex')
}

// Claims (or reclaims) processedStripeEvents/{eventId}, minting a fresh
// leaseToken on every successful claim — including a reclaim, which is
// exactly what invalidates whatever token the previous (stale) claimant
// was holding. Returns { claimed: false } for an already-completed event,
// or a still-fresh (not stale) pending claim held by someone else.
// Exported (along with leaseStillHeld/runFencedTransaction below) so the
// fencing mechanism itself can be tested directly against real/fake
// Firestore, not just observed indirectly through processWebhook's
// black-box behavior — same DI-testability pattern as
// api/_lib/create-dog-core.js's createDogWithRetry.
export async function claimEvent(db, eventRef, eventType, now) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(eventRef)
    const leaseToken = generateLeaseToken()
    if (!snap.exists) {
      tx.set(eventRef, { type: eventType, status: 'pending', claimedAt: now().toISOString(), attempts: 1, leaseToken })
      return { claimed: true, leaseToken }
    }
    const data = snap.data()
    if (data.status === 'completed') {
      return { claimed: false }
    }
    if (data.status === 'pending') {
      const claimedAtMs = new Date(data.claimedAt).getTime()
      const isStale = Number.isFinite(claimedAtMs) && (now().getTime() - claimedAtMs) > STALE_PENDING_MS
      if (!isStale) {
        // Either a genuinely concurrent in-flight attempt, or a very
        // recent crash — either way, not yet safe to reclaim. Treat this
        // delivery as a no-op; Stripe will retry again later, or the
        // in-flight attempt will finish on its own.
        return { claimed: false }
      }
      tx.set(eventRef, { type: eventType, status: 'pending', claimedAt: now().toISOString(), attempts: (data.attempts || 0) + 1, leaseToken }, { merge: true })
      return { claimed: true, leaseToken }
    }
    // status === 'failed' — a previous attempt's own catch block ran and
    // recorded this. Always retriable, never a permanent dead end.
    tx.set(eventRef, { type: eventType, status: 'pending', claimedAt: now().toISOString(), attempts: (data.attempts || 0) + 1, leaseToken }, { merge: true })
    return { claimed: true, leaseToken }
  })
}

export function leaseStillHeld(eventSnap, leaseToken) {
  if (!eventSnap.exists) return false
  const data = eventSnap.data()
  return data.status === 'pending' && data.leaseToken === leaseToken
}

// Codex H1 (round 2) — the fencing primitive every write this module
// makes (bar the initial claim itself) goes through. Reads eventRef
// INSIDE the same transaction as the caller's own reads/writes — so the
// ownership check and the effect it gates are part of one atomic commit,
// never a separate "check, then maybe write later" race — and refuses to
// run `fn` at all if the lease has moved on. `fn` receives the same `tx`
// so it can do its own reads (which must still happen before `fn`'s own
// first write) and writes.
export async function runFencedTransaction(db, eventRef, leaseToken, fn) {
  return db.runTransaction(async tx => {
    const eventSnap = await tx.get(eventRef)
    if (!leaseStillHeld(eventSnap, leaseToken)) {
      return { fenced: true }
    }
    const result = await fn(tx)
    return { fenced: false, result }
  })
}

export function createWebhookHandler({ constructEvent, getSubscription, db, now = () => new Date() }) {
  async function applyEvent(event, eventRef, leaseToken) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = extractUserId(session)
        if (!userId || !session.subscription) {
          console.error('stripe-webhook: checkout.session.completed no-op', {
            hasUserId: !!userId, hasSubscription: !!session.subscription,
          })
          return
        }
        const subscription = await getSubscription(session.subscription)
        const interval = resolveInterval(subscription)
        if (!interval) {
          // Diagnostic only — never logs the actual price id (that's not
          // a secret, but keeping this strictly structural avoids any
          // ambiguity).
          console.error('stripe-webhook: checkout.session.completed unrecognized price', {
            itemCount: subscription?.items?.data?.length ?? 0,
            hasPriceOnFirstItem: !!subscription?.items?.data?.[0]?.price?.id,
          })
          return // price id not on the allowlist — never grant entitlement off an unrecognized price
        }
        const nowIso = now().toISOString()
        const userRef = db.collection('users').doc(userId)
        const eventCustomerId = customerIdOf(session)
        // Reads (eventRef fencing check, profile + reactivateUpToCapTx's
        // dog query) must precede writes in this transaction.
        await runFencedTransaction(db, eventRef, leaseToken, async tx => {
          const snap = await tx.get(userRef)
          const profile = snap.exists ? snap.data() : {}
          const evaluation = evaluateSubscriptionEvent(profile, { subscriptionId: session.subscription, eventCreated: event.created, eventCustomerId })
          if (evaluation.stale) return
          await reactivateUpToCapTx(tx, db, userId, 'plus')
          tx.set(userRef, {
            plan: 'plus',
            subscriptionStatus: subscription.status,
            stripeSubscriptionId: session.subscription,
            billingInterval: interval,
            pastDueSince: null,
            ...subscriptionTrackingFields(profile, session.subscription, event.created, eventCustomerId),
            // First period for AI-scan quota purposes — §3.1 "On upgrade
            // to Plus, 10 scans granted immediately for the first period".
            scanPeriodAnchorDay: subscriptionStartAnchorDay(subscription),
            // Codex H1 (round 3): lease-token fencing only prevents a
            // CONCURRENT duplicate application of this event within one
            // lease — it does NOT (and structurally cannot) make a
            // SEQUENTIAL retry across leases idempotent on its own. If
            // this event's effects already committed once but the
            // completion-marking write then failed (crash, timeout, cold
            // start eviction — claimEvent's 'failed' status is always
            // retriable by design), Stripe redelivers the SAME event,
            // and by then the user may have legitimately consumed scans.
            // evaluation.isNewSubscription (evaluateSubscriptionEvent)
            // is exactly the signal that distinguishes "this subscription
            // has never been the account's current one before" (a
            // genuine first activation, or a legitimate A-to-B
            // replacement) from "this subscription is ALREADY current"
            // (a retry of an event whose effects already landed). Only a
            // genuine new activation may initialize these three fields —
            // a retry must preserve whatever quota state has evolved
            // since, and the ORIGINAL activation timestamp, not silently
            // reset them. Omitting the keys entirely (not writing them at
            // all) relies on tx.set's merge:true to leave the existing
            // stored values untouched, exactly as if this write never
            // happened for these three fields.
            ...(evaluation.isNewSubscription
              ? { planActivatedAt: nowIso, plusScansUsed: 0, plusScansPeriodStart: nowIso }
              : {}),
          }, { merge: true })
        })
        return
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object
        const userId = extractUserId(subscription)
        if (!userId) return
        const status = subscription.status
        const userRef = db.collection('users').doc(userId)
        const subscriptionId = subscription.id
        const eventCustomerId = customerIdOf(subscription)

        if (ACTIVE_STATUSES.has(status)) {
          const interval = resolveInterval(subscription)
          if (!interval) return
          await runFencedTransaction(db, eventRef, leaseToken, async tx => {
            const snap = await tx.get(userRef)
            const profile = snap.exists ? snap.data() : {}
            const evaluation = evaluateSubscriptionEvent(profile, { subscriptionId, eventCreated: event.created, eventCustomerId })
            if (evaluation.stale) return
            // §3.1 "Switching Monthly <-> Annual: No new quota granted...
            // the reset anchor moves to the new subscription's start_date
            // from the next period onward" — plusScansUsed is deliberately
            // NOT reset here, only the anchor day is refreshed.
            await reactivateUpToCapTx(tx, db, userId, 'plus')
            tx.set(userRef, {
              plan: 'plus',
              subscriptionStatus: status,
              billingInterval: interval,
              pastDueSince: null,
              scanPeriodAnchorDay: subscriptionStartAnchorDay(subscription),
              ...subscriptionTrackingFields(profile, subscriptionId, event.created, eventCustomerId),
            }, { merge: true })
          })
        } else if (status === 'past_due') {
          // §4.2 — 7 days of continued full Plus access from the FIRST
          // time we observe past_due; a later duplicate/related webhook
          // delivery must not push pastDueSince forward and re-extend
          // the grace window.
          await runFencedTransaction(db, eventRef, leaseToken, async tx => {
            const snap = await tx.get(userRef)
            const profile = snap.exists ? snap.data() : {}
            const evaluation = evaluateSubscriptionEvent(profile, { subscriptionId, eventCreated: event.created, eventCustomerId })
            if (evaluation.stale) return
            tx.set(userRef, {
              subscriptionStatus: status,
              pastDueSince: profile.pastDueSince || now().toISOString(),
              ...subscriptionTrackingFields(profile, subscriptionId, event.created, eventCustomerId),
            }, { merge: true })
          })
        } else if (DOWNGRADE_STATUSES.has(status)) {
          await runFencedTransaction(db, eventRef, leaseToken, async tx => {
            const snap = await tx.get(userRef)
            const profile = snap.exists ? snap.data() : {}
            const evaluation = evaluateSubscriptionEvent(profile, { subscriptionId, eventCreated: event.created, eventCustomerId })
            if (evaluation.stale) return
            await reconcileDogCapTx(tx, db, userId, 'free')
            tx.set(userRef, {
              plan: 'free',
              subscriptionStatus: status,
              pastDueSince: null,
              // Codex H5 (round 2): lastKnownSubscriptionId must advance
              // here too, not just on the ACTIVE branch — a subscription
              // that reaches this account's records for the FIRST time
              // via a downgrade status (e.g. checkout.completed was
              // missed) must still become the tracked "current"
              // subscription, or a later event for this same id would be
              // wrongly rejected as SUPERSEDED by evaluateSubscriptionEvent.
              ...subscriptionTrackingFields(profile, subscriptionId, event.created, eventCustomerId),
            }, { merge: true })
          })
        } else {
          await runFencedTransaction(db, eventRef, leaseToken, async tx => {
            const snap = await tx.get(userRef)
            const profile = snap.exists ? snap.data() : {}
            const evaluation = evaluateSubscriptionEvent(profile, { subscriptionId, eventCreated: event.created, eventCustomerId })
            if (evaluation.stale) return
            tx.set(userRef, {
              subscriptionStatus: status,
              ...subscriptionTrackingFields(profile, subscriptionId, event.created, eventCustomerId),
            }, { merge: true })
          })
        }
        return
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        const userId = extractUserId(subscription)
        if (!userId) return
        const userRef = db.collection('users').doc(userId)
        const subscriptionId = subscription.id
        const eventCustomerId = customerIdOf(subscription)
        await runFencedTransaction(db, eventRef, leaseToken, async tx => {
          const snap = await tx.get(userRef)
          const profile = snap.exists ? snap.data() : {}
          const evaluation = evaluateSubscriptionEvent(profile, { subscriptionId, eventCreated: event.created, eventCustomerId })
          if (evaluation.stale) return
          await reconcileDogCapTx(tx, db, userId, 'free')
          tx.set(userRef, {
            plan: 'free',
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
            pastDueSince: null,
            // lastKnownSubscriptionId deliberately still advances to the
            // just-deleted subscription's id (distinct from
            // stripeSubscriptionId, which IS cleared) — it tracks "most
            // recently touched subscription for ordering purposes", not
            // "the active one". See the DOWNGRADE_STATUSES branch above
            // for why this must happen on every accepted branch.
            ...subscriptionTrackingFields(profile, subscriptionId, event.created, eventCustomerId),
          }, { merge: true })
        })
        return
      }

      case 'invoice.payment_succeeded': {
        // Medium item — deliberate payment-recovery confirmation (§4.2):
        // a successful invoice payment after past_due means the grace
        // period ended successfully. Clears pastDueSince and confirms
        // Plus immediately rather than waiting on a separate
        // customer.subscription.updated(active) event that may lag.
        const invoice = event.data.object
        const subscriptionId = subscriptionIdOf(invoice)
        if (!subscriptionId) return
        const subscription = await getSubscription(subscriptionId)
        const userId = extractUserId(subscription)
        if (!userId) return
        const userRef = db.collection('users').doc(userId)
        // The invoice's own `.customer` is authoritative and avoids an
        // extra round of shape-handling on the fetched subscription.
        const eventCustomerId = customerIdOf(invoice) || customerIdOf(subscription)
        await runFencedTransaction(db, eventRef, leaseToken, async tx => {
          const snap = await tx.get(userRef)
          const profile = snap.exists ? snap.data() : {}
          const evaluation = evaluateSubscriptionEvent(profile, { subscriptionId, eventCreated: event.created, eventCustomerId })
          if (evaluation.stale) return
          const tracking = subscriptionTrackingFields(profile, subscriptionId, event.created, eventCustomerId)
          if (profile.pastDueSince) {
            await reactivateUpToCapTx(tx, db, userId, 'plus')
            tx.set(userRef, {
              plan: 'plus',
              subscriptionStatus: 'active',
              pastDueSince: null,
              ...tracking,
            }, { merge: true })
          } else {
            // "Harmless" only in the sense of never touching plan/status —
            // tracking fields (lastKnownSubscriptionId/stripeCustomerId/
            // subscriptionEventTimestamps) still advance the same as any
            // other accepted branch, so a subscription whose FIRST-ever
            // recorded event happens to be a non-past-due invoice isn't
            // left unrecorded as "current" (see the DOWNGRADE_STATUSES
            // branch's comment above for why that matters).
            tx.set(userRef, { ...tracking }, { merge: true })
          }
        })
        return
      }

      case 'invoice.payment_failed': {
        // Deliberately no distinct handling — Stripe's dunning retries
        // can fire this multiple times against the SAME still-past_due
        // subscription before either succeeding or the subscription
        // transitioning to canceled/unpaid. customer.subscription.updated
        // already owns every state transition this pricing record's
        // rules act on (past_due grace start, eventual downgrade); this
        // event carries no additional information beyond that.
        return
      }

      default:
        return
    }
  }

  return async function processWebhook(rawBody, sig) {
    let event
    try {
      event = constructEvent(rawBody, sig)
    } catch (err) {
      return { status: 400, body: { error: `Webhook Error: ${err.message}` } }
    }

    const eventRef = db.collection('processedStripeEvents').doc(event.id)
    const claim = await claimEvent(db, eventRef, event.type, now)
    if (!claim.claimed) {
      return { status: 200, body: { received: true, duplicate: true } }
    }
    const { leaseToken } = claim

    try {
      await applyEvent(event, eventRef, leaseToken)
      // Codex H1 (round 2): completion is ITSELF fenced — a reclaimed
      // invocation reaching this point (its earlier effects, if any, all
      // silently no-opped) must not be able to mark the event completed
      // out from under whoever holds the CURRENT lease.
      const completion = await runFencedTransaction(db, eventRef, leaseToken, async tx => {
        tx.set(eventRef, { status: 'completed', completedAt: now().toISOString() }, { merge: true })
      })
      if (completion.fenced) {
        return { status: 200, body: { received: true, fenced: true } }
      }
      return { status: 200, body: { received: true } }
    } catch (err) {
      console.error('stripe-webhook: handler error', { type: event.type })
      // Never let a failure recording itself fail silently swallow the
      // original error path — but also never let it throw past this
      // catch (a 500 must still reach Stripe so it retries). Also fenced
      // (see completion above) — if we've been reclaimed, marking
      // 'failed' would be just as much of a clobber as marking
      // 'completed' would be.
      try {
        await runFencedTransaction(db, eventRef, leaseToken, async tx => {
          tx.set(eventRef, { status: 'failed', failedAt: now().toISOString() }, { merge: true })
        })
      } catch {
        // best-effort — the event is still not 'completed', so a future
        // redelivery's claimEvent() will treat it as pending-then-stale
        // and reclaim it regardless.
      }
      return { status: 500, body: { error: 'Webhook handler failed' } }
    }
  }
}
