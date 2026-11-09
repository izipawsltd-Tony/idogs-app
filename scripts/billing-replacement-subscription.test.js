import { describe, it, expect, vi } from 'vitest'
import { createBillingSummaryHandler } from '../api/_lib/billing-handler.js'

// Codex 6740277035 (09 Nov): a new Plus Test subscription existed in Stripe,
// but the profile still pointed at the old cancelled one, so Billing showed
// Free and the old 27 Oct renewal. Billing must find the account's current
// subscription on the same Stripe customer instead of relying on the webhook.
const end = 1801000000
const old = { id: 'sub_old', customer: 'cus_qa', status: 'canceled', metadata: { userId: 'qa' }, items: { data: [{ current_period_end: 1793000000 }] } }
const fresh = { id: 'sub_new', customer: 'cus_qa', status: 'trialing', metadata: { userId: 'qa' }, cancel_at_period_end: false, items: { data: [{ current_period_end: end }] } }

async function run({ profile, stored = old, replacement = fresh, reconcile } = {}) {
  const find = vi.fn(async () => replacement)
  const reconcileVerifiedPlus = reconcile || vi.fn(async ({ subscription }) => ({ plan: 'plus', billingInterval: 'monthly', subscriptionStatus: subscription.status }))
  const handler = createBillingSummaryHandler({
    verifyIdToken: async () => ({ uid: 'qa' }),
    getProfile: async () => profile || { plan: 'plus', stripeCustomerId: 'cus_qa', stripeSubscriptionId: 'sub_old' },
    retrieveSubscription: async id => (id === stored?.id ? structuredClone(stored) : null),
    listInvoices: async () => ({ data: [] }),
    findReplacementSubscription: find,
    reconcileVerifiedPlus,
  })
  const out = {}; const res = { status: s => { out.status = s; return res }, json: b => { out.body = b } }
  await handler({ method: 'GET', headers: { authorization: 'Bearer synthetic' } }, res)
  return { out, find, reconcileVerifiedPlus }
}

describe('Billing uses the current subscription when the stored one has ended', () => {
  it('shows the new trialing Plus subscription and reconciles the profile to it', async () => {
    const { out, find, reconcileVerifiedPlus } = await run()
    expect(out.status).toBe(200)
    expect(find).toHaveBeenCalledWith({ customerId: 'cus_qa', userId: 'qa', excludeId: 'sub_old' })
    expect(reconcileVerifiedPlus).toHaveBeenCalledWith({ subscription: expect.objectContaining({ id: 'sub_new' }), userId: 'qa' })
    expect(out.body.entitlement).toMatchObject({ plan: 'plus', subscriptionStatus: 'trialing' })
    expect(out.body.subscription).toMatchObject({ id: 'sub_new', status: 'trialing', currentPeriodEnd: new Date(end * 1000).toISOString() })
  })

  it('also works when the profile has a customer but no stored subscription', async () => {
    const { out } = await run({ profile: { plan: 'free', stripeCustomerId: 'cus_qa' }, stored: null })
    expect(out.body.subscription?.id).toBe('sub_new')
    expect(out.body.entitlement.plan).toBe('plus')
  })

  it('stays Free when there is no replacement', async () => {
    const { out, reconcileVerifiedPlus } = await run({ replacement: null })
    expect(out.body.entitlement).toMatchObject({ plan: 'free', subscriptionStatus: 'canceled' })
    expect(out.body.subscription.id).toBe('sub_old')
    expect(reconcileVerifiedPlus).toHaveBeenCalledTimes(1)
  })

  it('never adopts a subscription for another account, another customer, or one that is not active', async () => {
    for (const replacement of [{ ...fresh, metadata: { userId: 'someone-else' } }, { ...fresh, customer: 'cus_other' }, { ...fresh, status: 'past_due' }, { ...fresh, status: 'canceled' }]) {
      const { out } = await run({ replacement })
      expect(out.body.subscription.id).toBe('sub_old')
      expect(out.body.entitlement.plan).toBe('free')
    }
  })

  it('does not look for a replacement while the stored subscription is still active', async () => {
    const { out, find } = await run({ stored: { ...old, status: 'active' } })
    expect(find).not.toHaveBeenCalled()
    expect(out.body.subscription.id).toBe('sub_old')
  })
})
