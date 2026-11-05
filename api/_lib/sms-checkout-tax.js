// Read-only AU catalog/tax preflight. Never edit a customer's tax settings,
// prices or registrations as a side effect of starting SMS Checkout.
export async function smsCheckoutTaxReady(stripe, profile, priceId, livemode, now = Date.now()) {
  const [price, settings, registrations, customer] = await Promise.all([
    stripe.prices.retrieve(priceId), stripe.tax.settings.retrieve(),
    stripe.tax.registrations.list({ status: 'active', limit: 100 }),
    stripe.customers.retrieve(profile.stripeCustomerId),
  ])
  const taxInclusive = price.tax_behavior === 'inclusive' ||
    (price.tax_behavior === 'unspecified' && settings.defaults?.tax_behavior === 'inferred_by_currency')
  return price.id === priceId && price.active === true && price.livemode === livemode &&
    price.currency === 'aud' && price.unit_amount === 300 && taxInclusive &&
    price.recurring?.interval === 'month' && price.recurring?.interval_count === 1 &&
    settings.status === 'active' && settings.livemode === livemode && !registrations.has_more &&
    registrations.data.some(r => r.country === 'AU' && r.status === 'active' && r.livemode === livemode &&
      r.active_from <= now / 1000 && (!r.expires_at || r.expires_at > now / 1000)) &&
    customer.id === profile.stripeCustomerId && !customer.deleted && customer.livemode === livemode &&
    customer.address?.country === 'AU' && !customer.shipping?.address && customer.tax_exempt === 'none'
}
