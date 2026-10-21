// Fail closed if the optional Extra Litter checkout is enabled without an
// explicitly configured Stripe-mode-specific inclusive GST rate. No tax rate
// is inferred, created, or copied between Stripe environments.
export function checkoutTaxRatesForStripeMode(livemode) {
  const id = process.env[livemode === true ? 'STRIPE_GST_TAX_RATE_ID' : 'STRIPE_TEST_GST_TAX_RATE_ID']
  if (!/^txr_[A-Za-z0-9]+$/.test(id || '')) throw new Error('CHECKOUT_TAX_RATE_NOT_CONFIGURED')
  return [id]
}
