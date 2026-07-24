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

// Stripe subscription.status values this pricing record defines explicit
// behavior for. Anything else (incomplete, paused, ...) only has its
// status recorded — plan is never silently flipped for a status this
// record doesn't cover.
const ACTIVE_STATUSES = new Set(['active', 'trialing'])
const DOWNGRADE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired'])

export function createWebhookHandler({ constructEvent, getSubscription, db, now = () => new Date() }) {
  return async function processWebhook(rawBody, sig) {
    let event
    try {
      event = constructEvent(rawBody, sig)
    } catch (err) {
      return { status: 400, body: { error: `Webhook Error: ${err.message}` } }
    }

    // Idempotency — Stripe redelivers on any non-2xx response, and events
    // can also be replayed manually from the dashboard. A single
    // transaction claims event.id so a redelivered/replayed event is
    // detected and skipped before any entitlement logic runs, regardless
    // of delivery order.
    const eventRef = db.collection('processedStripeEvents').doc(event.id)
    const alreadyProcessed = await db.runTransaction(async tx => {
      const snap = await tx.get(eventRef)
      if (snap.exists) return true
      tx.set(eventRef, { type: event.type, processedAt: now().toISOString() })
      return false
    })
    if (alreadyProcessed) {
      return { status: 200, body: { received: true, duplicate: true } }
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object
          const userId = extractUserId(session)
          if (!userId || !session.subscription) {
            console.error('stripe-webhook: checkout.session.completed no-op', {
              hasUserId: !!userId, hasSubscription: !!session.subscription,
            })
            break
          }
          const subscription = await getSubscription(session.subscription)
          const interval = resolveInterval(subscription)
          if (!interval) {
            // Diagnostic only — never logs the actual price id (that's not
            // a secret, but keeping this strictly structural avoids any
            // ambiguity). Safe to remove once staging E2E is confirmed.
            console.error('stripe-webhook: checkout.session.completed unrecognized price', {
              itemCount: subscription?.items?.data?.length ?? 0,
              hasPriceOnFirstItem: !!subscription?.items?.data?.[0]?.price?.id,
            })
            break // price id not on the allowlist — never grant entitlement off an unrecognized price
          }
          const nowIso = now().toISOString()
          const userRef = db.collection('users').doc(userId)
          // Found via live staging QA (2026-07-24): this is the actual
          // INITIAL upgrade-grant event (Stripe's checkout flow fires
          // checkout.session.completed, not customer.subscription.created
          // — Tony's webhook isn't even subscribed to the latter). Restricted
          // dogs must be reactivated up to the new Plus cap of 5 HERE, not
          // only on a later customer.subscription.updated — otherwise a
          // brand-new upgrade leaves every previously-restricted dog stuck
          // restricted until some unrelated future subscription-update event
          // happens to fire. Reads (inside reactivateUpToCapTx) must precede
          // writes in this transaction — it runs before the tx.set below.
          await db.runTransaction(async tx => {
            await reactivateUpToCapTx(tx, db, userId, 'plus')
            tx.set(userRef, {
              plan: 'plus',
              subscriptionStatus: subscription.status,
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
              billingInterval: interval,
              planActivatedAt: nowIso,
              pastDueSince: null,
              // First period for AI-scan quota purposes — §3.1 "On upgrade
              // to Plus, 10 scans granted immediately for the first period".
              scanPeriodAnchorDay: subscriptionStartAnchorDay(subscription),
              plusScansUsed: 0,
              plusScansPeriodStart: nowIso,
            }, { merge: true })
          })
          break
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object
          const userId = extractUserId(subscription)
          if (!userId) break
          const status = subscription.status
          const userRef = db.collection('users').doc(userId)

          if (ACTIVE_STATUSES.has(status)) {
            const interval = resolveInterval(subscription)
            if (!interval) break
            // §3.1 "Switching Monthly <-> Annual: No new quota granted...
            // the reset anchor moves to the new subscription's start_date
            // from the next period onward" — plusScansUsed is deliberately
            // NOT reset here, only the anchor day is refreshed from the
            // subscription's current start_date.
            await db.runTransaction(async tx => {
              // Reads (inside reactivateUpToCapTx) must precede writes in
              // this transaction — it runs before the tx.set(userRef,...)
              // write below, never after.
              await reactivateUpToCapTx(tx, db, userId, 'plus')
              tx.set(userRef, {
                plan: 'plus',
                subscriptionStatus: status,
                billingInterval: interval,
                pastDueSince: null,
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
              const existing = snap.exists ? snap.data() : {}
              tx.set(userRef, {
                subscriptionStatus: status,
                pastDueSince: existing.pastDueSince || now().toISOString(),
              }, { merge: true })
            })
          } else if (DOWNGRADE_STATUSES.has(status)) {
            await db.runTransaction(async tx => {
              await reconcileDogCapTx(tx, db, userId, 'free')
              tx.set(userRef, { plan: 'free', subscriptionStatus: status, pastDueSince: null }, { merge: true })
            })
          } else {
            await userRef.set({ subscriptionStatus: status }, { merge: true })
          }
          break
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object
          const userId = extractUserId(subscription)
          if (!userId) break
          const userRef = db.collection('users').doc(userId)
          await db.runTransaction(async tx => {
            await reconcileDogCapTx(tx, db, userId, 'free')
            tx.set(userRef, {
              plan: 'free',
              subscriptionStatus: 'canceled',
              stripeSubscriptionId: null,
              pastDueSince: null,
            }, { merge: true })
          })
          break
        }

        default:
          break
      }
      return { status: 200, body: { received: true } }
    } catch (err) {
      console.error('stripe-webhook: handler error', { type: event.type })
      return { status: 500, body: { error: 'Webhook handler failed' } }
    }
  }
}
