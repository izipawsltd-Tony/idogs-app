// api/super-admin/_pricing.js — Super Admin read-only pricing model.
//
// Values come from the canonical server pricing policy used by admin/revenue
// calculations. Actual charges remain authoritative in Stripe via checkout price IDs.
import {
  PRICING_POLICY_VERSION,
  PLUS_MONTHLY_PRICE_AUD,
  PLUS_ANNUAL_PRICE_AUD,
  DOG_CAP_FREE,
  DOG_CAP_PLUS,
  SCAN_QUOTA_FREE_LIFETIME,
  SCAN_QUOTA_PLUS_MONTHLY,
  LITTER_QUOTA_PLUS_ROLLING_12_MONTHS,
  EXTRA_LITTER_PRICE_AUD,
} from '../_lib/pricing-policy.js'

export {
  PRICING_POLICY_VERSION,
  PLUS_MONTHLY_PRICE_AUD,
  PLUS_ANNUAL_PRICE_AUD,
}

export const SUPER_ADMIN_DATA_MODEL_NOTICE =
  'Free and Plus are the only current plans. Monthly and annual are billing intervals, not separate tiers. Admin revenue figures are read-only estimates from stored subscription state; Stripe remains the charging authority.'

export const SUPER_ADMIN_PLAN_CATALOGUE = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    annualPrice: 0,
    dogCap: DOG_CAP_FREE,
    scanQuota: String(SCAN_QUOTA_FREE_LIFETIME) + ' lifetime',
    litterQuota: null,
    extraLitterPrice: null,
    description: 'Free forever with up to ' + DOG_CAP_FREE + ' counted dogs and ' + SCAN_QUOTA_FREE_LIFETIME + ' lifetime iDogs Scans.',
  },
  {
    id: 'plus',
    name: 'Plus',
    price: PLUS_MONTHLY_PRICE_AUD,
    annualPrice: PLUS_ANNUAL_PRICE_AUD,
    dogCap: DOG_CAP_PLUS,
    scanQuota: String(SCAN_QUOTA_PLUS_MONTHLY) + '/month',
    litterQuota: String(LITTER_QUOTA_PLUS_ROLLING_12_MONTHS) + ' per rolling 12 months',
    extraLitterPrice: EXTRA_LITTER_PRICE_AUD,
    description: 'Up to ' + DOG_CAP_PLUS + ' counted dogs, ' + SCAN_QUOTA_PLUS_MONTHLY + ' iDogs Scans per month, ' + LITTER_QUOTA_PLUS_ROLLING_12_MONTHS + ' litters per rolling 12 months, and breeder features.',
  },
]

export function getEstimatedMonthlyPrice(profile) {
  if (profile?.plan !== 'plus') return 0
  return profile.billingInterval === 'annual'
    ? PLUS_ANNUAL_PRICE_AUD / 12
    : PLUS_MONTHLY_PRICE_AUD
}
