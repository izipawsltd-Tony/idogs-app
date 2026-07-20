// api/create-checkout.js — Create Stripe checkout session
import Stripe from 'stripe'
import { requireAppUrl, logConfigError } from './_lib/require-config.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const PRICE_IDS = {
  basic: 'price_1TiaZn5lmfxrCiH3GCzSSuAy',   // $5/month
  pro: 'price_1Tiabb5lmfxrCiH3kBdaQsRH',     // $12/month
  kennel: 'price_1TiU7j5lmfxrCiH3J1WbbrLR',  // $29/month
  sms_addon: 'price_1Tialb5lmfxrCiH3pe82Abps', // $3/month
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { plan, userId, userEmail, smsAddon } = req.body
  if (!plan || !userId || !userEmail) return res.status(400).json({ error: 'Missing params' })

  const priceId = PRICE_IDS[plan]
  if (!priceId) return res.status(400).json({ error: 'Invalid plan' })

  // Fail closed BEFORE creating the Stripe session — its success/cancel
  // URLs are baked in at creation time, so a missing/malformed APP_URL
  // must never be papered over by redirecting a real paying customer to
  // production instead of this deployment.
  const appUrl = requireAppUrl()
  if (!appUrl) {
    logConfigError('create-checkout', 'APP_URL_NOT_CONFIGURED')
    return res.status(500).json({ error: 'APP_URL not configured' })
  }

  try {
    const lineItems = [{ price: priceId, quantity: 1 }]
    if (smsAddon && PRICE_IDS.sms_addon) {
      lineItems.push({ price: PRICE_IDS.sms_addon, quantity: 1 })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: userEmail,
      line_items: lineItems,
      success_url: `${appUrl}/app/billing?success=1`,
      cancel_url: `${appUrl}/app/billing?cancelled=1`,
      metadata: { userId, plan },
      subscription_data: {
        metadata: { userId, plan },
        trial_period_days: 30,
      },
    })
    return res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('Checkout error:', err)
    return res.status(500).json({ error: 'Failed to create checkout', message: err.message })
  }
}
