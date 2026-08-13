// api/super-admin/_pricing.js — Super Admin display-only plan catalogue
//
// Read-only mirror of the current Free/Plus catalogue. This is display math
// only; checkout price IDs and entitlement enforcement remain in api/_lib.

export const SUPER_ADMIN_DATA_MODEL_NOTICE =
  'iDogs derives this read-only view from user profile billing fields. Free and Plus are the only current plans; monthly and annual are billing intervals, not separate tiers.'

export const PLUS_MONTHLY_PRICE_AUD = 5
export const PLUS_ANNUAL_PRICE_AUD = 49

export const SUPER_ADMIN_PLAN_CATALOGUE = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    description: 'Free forever with up to 2 counted dogs and 2 lifetime iDogs Scans.',
  },
  {
    id: 'plus',
    name: 'Plus',
    price: PLUS_MONTHLY_PRICE_AUD,
    annualPrice: PLUS_ANNUAL_PRICE_AUD,
    description: 'Up to 5 counted dogs, 10 iDogs Scans per month, and breeder features. Available monthly or annually.',
  },
]

export function getEstimatedMonthlyPrice(profile) {
  if (profile?.plan !== 'plus') return 0
  return profile.billingInterval === 'annual'
    ? PLUS_ANNUAL_PRICE_AUD / 12
    : PLUS_MONTHLY_PRICE_AUD
}
