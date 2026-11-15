const idOf = value => typeof value === 'string' ? value : value?.id
export const isSeparateSms = sub => sub?.metadata?.purchaseType === 'sms_addon'

export function verifiedSeparateSms(sub, priceId) {
  const items = sub?.items?.data
  return isSeparateSms(sub) && Array.isArray(items) && items.length === 1 &&
    items[0].price?.id === priceId && items[0].quantity === 1
}

// Always read current Stripe state: late cancellation/payment events cannot
// roll back a newer period, reset credits twice, or touch Plus entitlements.
export async function applySeparateSmsEvent({ subscription, event, db, getSubscription,
  smsPriceId, transact, entitlementFields, validBase, cancelSubscription, now }) {
  if (!isSeparateSms(subscription)) return false
  const uid = subscription.metadata?.userId
  if (!uid || !verifiedSeparateSms(subscription, smsPriceId)) throw new Error('SMS_SUBSCRIPTION_UNVERIFIED')
  const baseId = subscription.metadata.baseSubscriptionId
  const base = baseId ? await getSubscription(baseId) : null
  const item = subscription.items.data[0]
  const paid = subscription.status === 'active' && subscription.latest_invoice?.status === 'paid'
  const monthly = Number.isFinite(item.current_period_start) && Number.isFinite(item.current_period_end) &&
    item.current_period_end > item.current_period_start && item.current_period_end - item.current_period_start <= 32 * 86400
  const applied = await transact(async tx => {
    const ref = db.collection('users').doc(uid)
    const stateRef = db.collection('smsSubscriptionState').doc(uid)
    const [snap, stateSnap] = await Promise.all([tx.get(ref), tx.get(stateRef)])
    const profile = snap.data()
    const state = stateSnap.data() || {}
    if (!snap.exists || profile.stripeCustomerId !== idOf(subscription.customer) ||
        base?.metadata?.userId !== uid || idOf(base?.customer) !== profile.stripeCustomerId) throw new Error('SMS_CUSTOMER_MISMATCH')
    // A superseded SMS subscription can never overwrite a replacement.
    if (state.subscriptionId && state.subscriptionId !== subscription.id && state.timestamps?.[subscription.id] !== undefined) return
    if (state.subscriptionId === subscription.id && typeof state.timestamps?.[subscription.id] === 'number' &&
        event.created < state.timestamps[subscription.id]) return
    if (profile.smsStripeSubscriptionId === subscription.id && profile.smsPeriodEnd &&
        Date.parse(profile.smsPeriodEnd) > item.current_period_end * 1000) return
    if (profile.smsStripeSubscriptionId && profile.smsStripeSubscriptionId !== subscription.id &&
        state.subscriptionId === profile.smsStripeSubscriptionId && profile.smsAddonStatus === 'active') throw new Error('SMS_DUPLICATE_SUBSCRIPTION')
    const baseValid = profile.stripeSubscriptionId === baseId && ['active', 'trialing'].includes(base.status) && validBase(base)
    const verified = { ...subscription,
      status: paid && monthly && baseValid ? 'active' :
        ['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status) || !baseValid ? 'canceled' : 'past_due' }
    tx.set(ref, entitlementFields(profile, verified, smsPriceId, now().toISOString()), { merge: true })
    tx.set(stateRef, { subscriptionId: subscription.id, baseSubscriptionId: baseId,
      timestamps: { ...(state.timestamps || {}), [subscription.id]: event.created } }, { merge: true })
    return !baseValid
  })
  // Checkout can finish after its base Plus subscription was canceled. Stop
  // further SMS renewals in that race rather than leaving an orphan charge.
  if (applied?.result === true && !['canceled', 'incomplete_expired'].includes(subscription.status)) {
    if (!cancelSubscription) throw new Error('SMS_CANCEL_UNAVAILABLE')
    await cancelSubscription(subscription.id, { prorate: false, invoice_now: false })
  }
  return true
}
