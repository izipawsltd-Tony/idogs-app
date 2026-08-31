import { CHECKOUT_PRICE_IDS } from './checkout-handler.js'
import { reactivateUpToCapTx } from './dog-cap.js'
import { anchorDayFromDate } from './entitlements.js'

const PRICE_INTERVAL = Object.freeze({
  [CHECKOUT_PRICE_IDS.plus_monthly]: 'monthly',
  [CHECKOUT_PRICE_IDS.plus_annual]: 'annual',
})

function customerIdOf(subscription) {
  if (typeof subscription?.customer === 'string') return subscription.customer
  return subscription?.customer?.id || null
}

export function verifiedPlusInterval(subscription) {
  if (!subscription || !['active', 'trialing'].includes(subscription.status)) return null
  for (const item of subscription.items?.data || []) {
    const interval = PRICE_INTERVAL[item?.price?.id]
    if (interval) return interval
  }
  return null
}

export async function reconcileVerifiedPlusSubscription({ db, subscription, userId, eventCreated, now = () => new Date() }) {
  if (!userId || subscription?.metadata?.userId !== userId) throw new Error('PLUS_RECONCILE_USER_MISMATCH')
  const interval = verifiedPlusInterval(subscription)
  if (!interval) throw new Error('PLUS_RECONCILE_NOT_ACTIVE_PLUS')
  const customerId = customerIdOf(subscription)
  if (!customerId) throw new Error('PLUS_RECONCILE_CUSTOMER_MISSING')

  const nowDate = now()
  const nowIso = nowDate.toISOString()
  const eventTs = Number.isFinite(eventCreated) ? eventCreated : Math.floor(nowDate.getTime() / 1000)
  const userRef = db.collection('users').doc(userId)

  await db.runTransaction(async tx => {
    const snap = await tx.get(userRef)
    const profile = snap.exists ? snap.data() : {}
    await reactivateUpToCapTx(tx, db, userId, 'plus')

    const timestamps = { ...(profile.subscriptionEventTimestamps || {}), [subscription.id]: eventTs }
    const quotaFields = profile.plusScansSubscriptionId === subscription.id
      ? {}
      : {
          plusScansSubscriptionId: subscription.id,
          plusScansUsed: 0,
          plusScansPeriodStart: nowIso,
          planActivatedAt: profile.planActivatedAt || nowIso,
        }

    tx.set(userRef, {
      plan: 'plus',
      subscriptionStatus: subscription.status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      lastKnownSubscriptionId: subscription.id,
      subscriptionEventTimestamps: timestamps,
      billingInterval: interval,
      pastDueSince: null,
      scanPeriodAnchorDay: anchorDayFromDate(new Date(subscription.start_date * 1000)),
      ...quotaFields,
    }, { merge: true })
  })

  return { plan: 'plus', subscriptionStatus: subscription.status, stripeSubscriptionId: subscription.id, billingInterval: interval }
}
