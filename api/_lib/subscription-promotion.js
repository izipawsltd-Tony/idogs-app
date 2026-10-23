import { PLUS_PROMOTION_ID, PLUS_PROMOTION_END } from '../../shared/plus-promotion.js'
import { CHECKOUT_PRICE_IDS } from './checkout-handler.js'
import { STAGING_PLUS_MONTHLY_PRICE_ID } from './promotion-environment.js'

// A legacy trial ending on the campaign date is not proof of enrolment.
// Reflect verified provider terms only; this never migrates billing or grants access.
export function subscriptionPromotionStatus(subscription, userId) {
  const end = PLUS_PROMOTION_END / 1000
  const metadata = subscription?.metadata
  const items = subscription?.items?.data
  if (!userId || metadata?.userId !== userId || metadata?.promotion !== PLUS_PROMOTION_ID ||
      metadata?.promotionConsent !== 'accepted-v1' || !['active', 'trialing'].includes(subscription?.status) ||
      subscription.automatic_tax?.enabled !== true || !Array.isArray(items)) return 'not_confirmed'
  const monthlyPrice = subscription.livemode === true ? CHECKOUT_PRICE_IDS.plus_monthly
    : subscription.livemode === false ? STAGING_PLUS_MONTHLY_PRICE_ID : null
  const item = items.find(item => item.price?.id === monthlyPrice)
  const price = item?.price
  if (!monthlyPrice || item?.quantity !== 1 || price?.currency !== 'aud' || price.unit_amount !== 700 ||
      price.tax_behavior !== 'inclusive' || price.recurring?.interval !== 'month' || price.recurring?.interval_count !== 1) return 'not_confirmed'
  // Checkout uses a trial, or a no-proration anchor in the final 48 hours.
  return subscription.trial_end === end ||
    (subscription.status === 'active' && subscription.billing_cycle_anchor === end)
    ? 'confirmed' : 'not_confirmed'
}
