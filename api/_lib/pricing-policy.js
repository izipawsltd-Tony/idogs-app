// Canonical server-side display policy for the current iDogs commercial model.
// Stripe price IDs remain the authority for actual charges; these numeric values
// mirror the public Billing/Landing copy and are used for read-only admin math.
export const PRICING_POLICY_VERSION = '2026-10-v1'

export const PLUS_MONTHLY_PRICE_AUD = 7
export const PLUS_ANNUAL_PRICE_AUD = 70
export const DOG_CAP_FREE = 2
export const DOG_CAP_PLUS = 5
export const SCAN_QUOTA_FREE_LIFETIME = 2
export const SCAN_QUOTA_PLUS_MONTHLY = 10
export const LITTER_QUOTA_PLUS_ROLLING_12_MONTHS = 2
export const EXTRA_LITTER_PRICE_AUD = 39

export const CURRENT_PLAN_IDS = Object.freeze(['free', 'plus'])
