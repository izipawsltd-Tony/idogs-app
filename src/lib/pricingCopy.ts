// iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md, LOCKED) — display-only
// numeric constants shared by the public landing page and the authenticated
// Billing page, so both surfaces quote the same price/cap/quota figures
// instead of duplicating hardcoded numbers. These have no runtime link to
// enforcement — keep them in sync by hand with the real source of truth:
// api/_lib/dog-cap.js (DOG_CAP), api/_lib/entitlements.js (SCAN_QUOTA), and
// api/_lib/checkout-handler.js (CHECKOUT_PRICE_IDS) if any of those change.
//
// The $40/year annual launch-offer price mentioned in Pricing_Decision_
// Record_v1.1.md §1.1 is NOT implemented in checkout-handler.js (only two
// Stripe prices exist: plus_monthly and plus_annual at the standard $49).
// Do not display $40 as a purchasable price until that backend work lands.
export const PLUS_MONTHLY_PRICE_AUD = 5
export const PLUS_ANNUAL_PRICE_AUD = 49
export const DOG_CAP_FREE = 2
export const DOG_CAP_PLUS = 5
export const SCAN_QUOTA_FREE_LIFETIME = 2
export const SCAN_QUOTA_PLUS_MONTHLY = 10
