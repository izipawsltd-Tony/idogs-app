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
// Codex H1 (idempotency): processedStripeEvents/{eventId} is a
// pending -> completed | failed state machine, not a single "exists means
// processed" flag. An event is marked completed ONLY after its
// entitlement effects have actually landed; a transient failure marks it
// failed (retriable), never completed. A stuck 'pending' (the owning
// invocation crashed without reaching either terminal state) is reclaimed
// once stale rather than wedging that event forever.
//
// Codex H5 (event ordering): every event that touches subscription state
// checks the account's stored lastKnownSubscriptionId and per-subscription
// last-applied-event timestamp before applying anything. A stale event —
// for a subscription the account has already moved on from, or an
// out-of-order redelivery for the same subscription — is a safe no-op,
// never a downgrade/re-grant/clobber of newer state.

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

// Codex H5 — true when this event is stale relative to what's already
// stored for this account: either it's about a DIFFERENT (older)
// subscription than the one the account has most recently moved to, or
// it's an out-of-order redelivery for the SAME subscription that's
// already-or-more-recently been applied. `eventCreated` is Stripe's own
// event.created (unix seconds) — always present on a real Event object.
function isStaleSubscriptionEvent(profile, subscriptionId, eventCreated) {
  if (profile?.lastKnownSubscriptionId && profile.lastKnownSubscriptionId !== subscriptionId) {
    return true
  }
  const lastSeen = profile?.subscriptionEventTimestamps?.[subscriptionId]
  if (typeof lastSeen === 'number' && typeof eventCreated === 'number' && eventCreated <= lastSeen) {
    return true
  }
  return false
}

// Returns a full replacement value for the subscriptionEventTimestamps
// map with this subscription's entry updated — read-modify-write on the
// plain object rather than a Firestore dotted-path merge, so behavior is
// identical between the real Admin SDK and the in-memory test fake (which
// does not special-case dotted keys).
function withUpdatedTimestamp(profile, subscriptionId, eventCreated) {
  return { ...(profile?.subscriptionEventTimestamps || {}), [subscriptionId]: eventCreated }
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
// out from under itself; a crashed one (no timeout, hard kill, cold
// start eviction) doesn't wedge the event forever either.
const STALE_PENDING_MS = 55 * 1000

async function claimEvent(db, eventRef, eventType, now) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(eventRef)
    if (!snap.exists) {
      tx.set(eventRef, { type: eventType, status: 'pending', claimedAt: now().toISOString(), attempts: 1 })
      return { claimed: true }
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
      tx.set(eventRef, { type: eventType, status: 'pending', claimedAt: now().toISOString(), attempts: (data.attempts || 0) + 1 }, { merge: true })
      return { claimed: true }
    }
    // status === 'failed' — a previous attempt's own catch block ran and
    // recorded this. Always retriable, never a permanent dead end.
    tx.set(eventRef, { type: eventType, status: 'pending', claimedAt: now().toISOString(), attempts: (data.attempts || 0) + 1 }, { merge: true })
    return { claimed: true }
  })
}

export function createWebhookHandler({ constructEvent, getSubscription, db, now = () => new Date() }) {
  async function applyEvent(event) {
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
        // Reads (profile + reactivateUpToCapTx's dog query) must precede
        // writes in this transaction.
        await db.runTransaction(async tx => {
          const snap = await tx.get(userRef)
          const profile = snap.exists ? snap.data() : {}
          if (isStaleSubscriptionEvent(profile, session.subscription, event.created)) return
          await reactivateUpToCapTx(tx, db, userId, 'plus')
          tx.set(userRef, {
            plan: 'plus',
            subscriptionStatus: subscription.status,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            billingInterval: interval,
            planActivatedAt: nowIso,
            pastDueSince: null,
            lastKnownSubscriptionId: session.subscription,
            subscriptionEventTimestamps: withUpdatedTimestamp(profile, session.subscription, event.created),
            // First period for AI-scan quota purposes — §3.1 "On upgrade
            // to Plus, 10 scans granted immediately for the first period".
            scanPeriodAnchorDay: subscriptionStartAnchorDay(subscription),
            plusScansUsed: 0,
            plusScansPeriodStart: nowIso,
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

        if (ACTIVE_STATUSES.has(status)) {
          const interval = resolveInterval(subscription)
          if (!interval) return
          await db.runTransaction(async tx => {
            const snap = await tx.get(userRef)
            const profile = snap.exists ? snap.data() : {}
            if (isStaleSubscriptionEvent(profile, subscriptionId, event.created)) return
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
              lastKnownSubscriptionId: subscriptionId,
              subscriptionEventTimestamps: withUpdatedTimestamp(profile, subscriptionId, event.created),
              scanPeriodAnchorDay: subscriptionStartAnchorDay(subscription),
            }, { merge: true })
          })
        } else if (status === 'past_due') {
          // §4.2 — 7 days of continued full Plus access from the FIRST
          // time we observe past_due; a later duplicate/related webhook
          // delivery must not push pastDueSince forward and re-extend
          // the grace window.
          await db.runTransaction(async tx => {
            const snap = await tx.get(userRef)
            const profile = snap.exists ? snap.data() : {}
            if (isStaleSubscriptionEvent(profile, subscriptionId, event.created)) return
            tx.set(userRef, {
              subscriptionStatus: status,
              pastDueSince: profile.pastDueSince || now().toISOString(),
              lastKnownSubscriptionId: subscriptionId,
              subscriptionEventTimestamps: withUpdatedTimestamp(profile, subscriptionId, event.created),
            }, { merge: true })
          })
        } else if (DOWNGRADE_STATUSES.has(status)) {
          await db.runTransaction(async tx => {
            const snap = await tx.get(userRef)
            const profile = snap.exists ? snap.data() : {}
            if (isStaleSubscriptionEvent(profile, subscriptionId, event.created)) return
            await reconcileDogCapTx(tx, db, userId, 'free')
            tx.set(userRef, {
              plan: 'free',
              subscriptionStatus: status,
              pastDueSince: null,
              subscriptionEventTimestamps: withUpdatedTimestamp(profile, subscriptionId, event.created),
            }, { merge: true })
          })
        } else {
          await db.runTransaction(async tx => {
            const snap = await tx.get(userRef)
            const profile = snap.exists ? snap.data() : {}
            if (isStaleSubscriptionEvent(profile, subscriptionId, event.created)) return
            tx.set(userRef, {
              subscriptionStatus: status,
              subscriptionEventTimestamps: withUpdatedTimestamp(profile, subscriptionId, event.created),
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
        await db.runTransaction(async tx => {
          const snap = await tx.get(userRef)
          const profile = snap.exists ? snap.data() : {}
          if (isStaleSubscriptionEvent(profile, subscriptionId, event.created)) return
          await reconcileDogCapTx(tx, db, userId, 'free')
          tx.set(userRef, {
            plan: 'free',
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
            pastDueSince: null,
            subscriptionEventTimestamps: withUpdatedTimestamp(profile, subscriptionId, event.created),
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
        await db.runTransaction(async tx => {
          const snap = await tx.get(userRef)
          const profile = snap.exists ? snap.data() : {}
          if (isStaleSubscriptionEvent(profile, subscriptionId, event.created)) return
          const timestamps = withUpdatedTimestamp(profile, subscriptionId, event.created)
          if (profile.pastDueSince) {
            await reactivateUpToCapTx(tx, db, userId, 'plus')
            tx.set(userRef, {
              plan: 'plus',
              subscriptionStatus: 'active',
              pastDueSince: null,
              lastKnownSubscriptionId: subscriptionId,
              subscriptionEventTimestamps: timestamps,
            }, { merge: true })
          } else {
            tx.set(userRef, { subscriptionEventTimestamps: timestamps }, { merge: true })
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

    try {
      await applyEvent(event)
      await eventRef.set({ status: 'completed', completedAt: now().toISOString() }, { merge: true })
      return { status: 200, body: { received: true } }
    } catch (err) {
      console.error('stripe-webhook: handler error', { type: event.type })
      // Never let a failure recording itself fail silently swallow the
      // original error path — but also never let it throw past this
      // catch (a 500 must still reach Stripe so it retries).
      try {
        await eventRef.set({ status: 'failed', failedAt: now().toISOString() }, { merge: true })
      } catch {
        // best-effort — the event is still not 'completed', so a future
        // redelivery's claimEvent() will treat it as pending-then-stale
        // and reclaim it regardless.
      }
      return { status: 500, body: { error: 'Webhook handler failed' } }
    }
  }
}
