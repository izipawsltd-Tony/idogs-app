import { claimEvent, runFencedTransaction } from './webhook-handler.js'
import { SMS_MONTHLY_CREDITS } from './sms-addon.js'

function userIdOf(obj) {
  const value = obj?.metadata?.userId
  return typeof value === 'string' && value ? value : null
}
function customerIdOf(obj) {
  if (typeof obj?.customer === 'string') return obj.customer
  return obj?.customer?.id || null
}
function periodOf(subscription) {
  const items = subscription?.items?.data || []
  const starts = items.map(x => x?.current_period_start).filter(Number.isFinite)
  const ends = items.map(x => x?.current_period_end).filter(Number.isFinite)
  if (!starts.length || !ends.length) return null
  return {
    start: new Date(Math.min(...starts) * 1000).toISOString(),
    end: new Date(Math.max(...ends) * 1000).toISOString(),
  }
}
function hasConfiguredPrice(subscription, priceId) {
  return Boolean(priceId) && (subscription?.items?.data || []).some(item => item?.price?.id === priceId)
}
function statusForStripe(status) {
  if (status === 'active' || status === 'trialing') return 'active'
  if (status === 'past_due') return 'past_due'
  if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') return 'cancelled'
  return 'inactive'
}

export function createSmsWebhookHandler({
  constructEvent,
  getSubscription,
  db,
  getPriceId = () => process.env.STRIPE_SMS_ADDON_PRICE_ID,
  now = () => new Date(),
} = {}) {
  async function applySubscription(event, eventRef, leaseToken, subscription) {
    const priceId = getPriceId()
    if (!priceId || !hasConfiguredPrice(subscription, priceId)) return

    const uid = userIdOf(subscription)
    if (!uid) return
    const customerId = customerIdOf(subscription)
    const userRef = db.collection('users').doc(uid)
    const subscriptionId = subscription.id
    const period = periodOf(subscription)
    const nextStatus = statusForStripe(subscription.status)

    await runFencedTransaction(db, eventRef, leaseToken, async tx => {
      const snap = await tx.get(userRef)
      if (!snap.exists) return
      const profile = snap.data()

      // SMS checkout must attach to the same trusted Stripe Customer as
      // the base iDogs subscription. Never adopt an unknown customer here.
      if (!profile.stripeCustomerId || profile.stripeCustomerId !== customerId) return

      // A late event for a superseded SMS subscription must never revive it.
      const timestamps = profile.smsSubscriptionEventTimestamps || {}
      const current = profile.smsLastKnownSubscriptionId
      const knownBefore = Object.prototype.hasOwnProperty.call(timestamps, subscriptionId)
      if (current && current !== subscriptionId && knownBefore) return
      const previousTs = timestamps[subscriptionId]
      if (current === subscriptionId && Number.isFinite(previousTs) && Number.isFinite(event.created) && event.created < previousTs) return

      const periodChanged = nextStatus === 'active' && period &&
        (profile.smsPeriodStart !== period.start || profile.smsPeriodEnd !== period.end)

      tx.set(userRef, {
        smsAddonStatus: nextStatus,
        smsStripeSubscriptionId: nextStatus === 'cancelled' ? null : subscriptionId,
        smsStripePriceId: priceId,
        smsPeriodStart: period?.start || profile.smsPeriodStart || null,
        smsPeriodEnd: period?.end || profile.smsPeriodEnd || null,
        smsCreditsLimit: SMS_MONTHLY_CREDITS,
        ...(periodChanged ? { smsCreditsUsed: 0 } : {}),
        smsLastBillingEventAt: now().toISOString(),
        smsLastKnownSubscriptionId: subscriptionId,
        smsSubscriptionEventTimestamps: { ...timestamps, [subscriptionId]: event.created },
      }, { merge: true })
    })
  }

  return async function process(rawBody, signature) {
    let event
    try { event = constructEvent(rawBody, signature) } catch {
      return { status: 400, body: { error: 'Webhook signature verification failed' } }
    }

    const eventRef = db.collection('processedSmsStripeEvents').doc(event.id)
    const claim = await claimEvent(db, eventRef, event.type, now)
    if (!claim.claimed) return { status: 200, body: { received: true, duplicate: true } }

    try {
      let subscription = null
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object
        if (session?.metadata?.product !== 'sms_addon_v1' || !session.subscription) {
          await runFencedTransaction(db, eventRef, claim.leaseToken, async tx => {
            tx.set(eventRef, { status: 'completed', completedAt: now().toISOString() }, { merge: true })
          })
          return { status: 200, body: { received: true } }
        }
        subscription = await getSubscription(session.subscription)
      } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        subscription = event.data.object
        if (subscription?.metadata?.product !== 'sms_addon_v1') {
          await runFencedTransaction(db, eventRef, claim.leaseToken, async tx => {
            tx.set(eventRef, { status: 'completed', completedAt: now().toISOString() }, { merge: true })
          })
          return { status: 200, body: { received: true } }
        }
      }

      if (subscription) await applySubscription(event, eventRef, claim.leaseToken, subscription)

      await runFencedTransaction(db, eventRef, claim.leaseToken, async tx => {
        tx.set(eventRef, { status: 'completed', completedAt: now().toISOString() }, { merge: true })
      })
      return { status: 200, body: { received: true } }
    } catch {
      try {
        await runFencedTransaction(db, eventRef, claim.leaseToken, async tx => {
          tx.set(eventRef, { status: 'failed', failedAt: now().toISOString() }, { merge: true })
        })
      } catch {}
      return { status: 500, body: { error: 'SMS webhook processing failed' } }
    }
  }
}
