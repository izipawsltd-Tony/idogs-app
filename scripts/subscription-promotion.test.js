import { describe, expect, it } from 'vitest'
import { subscriptionPromotionStatus } from '../api/_lib/subscription-promotion.js'
import { createBillingSummaryHandler } from '../api/_lib/billing-handler.js'
import { PLUS_PROMOTION_ID, PLUS_PROMOTION_END } from '../shared/plus-promotion.js'
import { STAGING_PLUS_MONTHLY_PRICE_ID } from '../api/_lib/promotion-environment.js'
import { CHECKOUT_PRICE_IDS } from '../api/_lib/checkout-handler.js'

function fixture() {
  return { id: 'sub_synthetic', customer: 'cus_synthetic', livemode: false, status: 'trialing',
    metadata: { userId: 'qa', promotion: PLUS_PROMOTION_ID, promotionConsent: 'accepted-v1' },
    automatic_tax: { enabled: true }, trial_end: PLUS_PROMOTION_END / 1000,
    items: { data: [{ quantity: 1, price: { id: STAGING_PLUS_MONTHLY_PRICE_ID, currency: 'aud', unit_amount: 700,
      tax_behavior: 'inclusive', recurring: { interval: 'month', interval_count: 1 } } }] } }
}

describe('provider-verified campaign display', () => {
  it('confirms the test campaign trial and the final-window anchor', () => {
    const s = fixture()
    expect(subscriptionPromotionStatus(s, 'qa')).toBe('confirmed')
    s.status = 'active'; s.trial_end = null; s.billing_cycle_anchor = PLUS_PROMOTION_END / 1000
    expect(subscriptionPromotionStatus(s, 'qa')).toBe('confirmed')
  })
  it('uses the correct price for each Stripe mode', () => {
    const s = fixture(); s.livemode = true
    expect(subscriptionPromotionStatus(s, 'qa')).toBe('not_confirmed')
    s.items.data[0].price.id = CHECKOUT_PRICE_IDS.plus_monthly
    expect(subscriptionPromotionStatus(s, 'qa')).toBe('confirmed')
  })
  it.each(['legacy', 'identity', 'consent', 'price', 'amount', 'currency', 'tax', 'date', 'status', 'quantity', 'annual', 'mode'])(
    'does not confirm a %s mismatch or infer enrolment from the date', key => {
      const s = fixture(); const p = s.items.data[0].price
      if (key === 'legacy') s.metadata = {}
      if (key === 'identity') s.metadata.userId = 'another-owner'
      if (key === 'consent') delete s.metadata.promotionConsent
      if (key === 'price') p.id = 'price_legacy'
      if (key === 'amount') p.unit_amount = 500
      if (key === 'currency') p.currency = 'usd'
      if (key === 'tax') s.automatic_tax.enabled = false
      if (key === 'date') s.trial_end--
      if (key === 'status') s.status = 'canceled'
      if (key === 'quantity') s.items.data[0].quantity = 2
      if (key === 'annual') p.recurring.interval = 'year'
      if (key === 'mode') delete s.livemode
      expect(subscriptionPromotionStatus(s, 'qa')).toBe('not_confirmed')
    })
  it('exposes only the confirmation state and trial date through authenticated summary', async () => {
    const s = fixture(); s.metadata.private = 'never-return-this'
    const handler = createBillingSummaryHandler({ verifyIdToken: async () => ({ uid: 'qa' }),
      getProfile: async () => ({ stripeCustomerId: s.customer, stripeSubscriptionId: s.id }),
      retrieveSubscription: async () => s, listInvoices: async () => ({ data: [] }) })
    const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method: 'GET', headers: { authorization: 'Bearer synthetic' } }, res)
    expect(res.code).toBe(200)
    expect(res.body.subscription.promotionStatus).toBe('confirmed')
    expect(res.body.subscription.trialEnd).toBe(new Date(PLUS_PROMOTION_END).toISOString())
    expect(JSON.stringify(res.body)).not.toMatch(/never-return-this|accepted-v1|metadata/)
  })
})
