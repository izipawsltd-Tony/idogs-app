// api/super-admin/_pricing.js — Super Admin display-only plan catalogue
//
// iDogs V1 has no central exported pricing module (BillingPage.tsx, api/create-checkout.js,
// and api/super-admin/dashboard.js each keep their own copy of plan prices). This file is a
// Super Admin-only mirror of those figures for read-only display — it is NOT a shared runtime
// pricing source and must never be wired into checkout/Stripe.

export const SUPER_ADMIN_DATA_MODEL_NOTICE =
  'iDogs V1 currently derives subscription status from user profile plan fields until formal billing records are introduced.'

export const SMS_ADDON_MONTHLY_PRICE = 3

export const SUPER_ADMIN_PLAN_CATALOGUE = [
  {
    id: 'trial',
    name: 'Trial',
    price: 0,
    description: '30-day free trial with full feature access before choosing a paid plan.',
  },
  {
    id: 'free',
    name: 'Free',
    price: 0,
    description: 'Free forever for pet owners with 1-2 dogs.',
  },
  {
    id: 'basic',
    name: 'Basic',
    price: 5,
    description: 'For casual breeders and growing families.',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 12,
    description: 'For active breeders and growing kennels.',
  },
  {
    id: 'kennel',
    name: 'Kennel',
    price: 29,
    description: 'For professional kennels — unlimited dogs.',
  },
]

export function getPlanPrice(planId) {
  const plan = SUPER_ADMIN_PLAN_CATALOGUE.find(p => p.id === planId)
  return plan ? plan.price : 0
}
