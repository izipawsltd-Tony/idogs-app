import { PLUS_PROMOTION_END } from '../../shared/plus-promotion.js'

export const PROMOTION_TAX_POLICY = 'automatic-au-gst-v1'
const idOf = value => typeof value === 'string' ? value : value?.id

// Read-only preflight; never activates Tax or creates registrations/prices.
// Preserve the existing configured classification, not an inferred tax code.
export async function promotionTaxReady(stripe, priceId, livemode, customerId, now = Date.now()) {
  const [settings, registrations, price, customer] = await Promise.all([
    stripe.tax.settings.retrieve(),
    stripe.tax.registrations.list({ status: 'active', limit: 100 }),
    stripe.prices.retrieve(priceId, { expand: ['product'] }),
    customerId ? stripe.customers.retrieve(customerId) : null,
  ])
  if (settings.status !== 'active' || settings.livemode !== livemode ||
      settings.head_office?.address?.country !== 'AU' || registrations.has_more) return false
  // This campaign approval covers Australia only. Additional jurisdictions
  // require review rather than silently enabling tax in another country.
  const active = registrations.data.filter(reg => reg.status === 'active')
  if (active.some(reg => reg.country !== 'AU')) return false
  if (!active.some(reg => reg.country === 'AU' && reg.livemode === livemode &&
      reg.active_from <= now / 1000 && (!reg.expires_at || reg.expires_at > PLUS_PROMOTION_END / 1000))) return false
  const product = price.product
  const taxCode = idOf(product?.tax_code) || idOf(settings.defaults?.tax_code)
  if (price.id !== priceId || price.active !== true || price.livemode !== livemode ||
      price.currency !== 'aud' || price.unit_amount !== 700 || price.tax_behavior !== 'inclusive' ||
      price.recurring?.interval !== 'month' || price.recurring?.interval_count !== 1 ||
      typeof product !== 'object' || product?.deleted || product?.active !== true ||
      product.livemode !== livemode || !taxCode || taxCode === 'txcd_00000000') return false
  // Stripe prioritizes a saved shipping address over Checkout billing. Do not
  // silently use/clear it, or override an existing exemption, for this offer.
  if (customerId && (!customer || customer.deleted || customer.livemode !== livemode ||
      customer.shipping?.address || customer.tax_exempt !== 'none')) return false
  return true
}
