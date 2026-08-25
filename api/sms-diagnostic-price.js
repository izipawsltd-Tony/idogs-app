import Stripe from 'stripe'

const PRICE_ID = 'price_1TxaNJGHgBd6ZgJEpAhrWark'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (process.env.VERCEL_ENV !== 'preview' || process.env.FIREBASE_PROJECT_ID !== 'idogs-app-staging') {
    return res.status(404).json({ error: 'Not found' })
  }
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    const price = await stripe.prices.retrieve(PRICE_ID, { expand: ['product'] })
    const product = typeof price.product === 'object' ? price.product : null
    return res.status(200).json({
      priceId: price.id,
      active: price.active,
      currency: price.currency,
      unitAmount: price.unit_amount,
      recurring: price.recurring ? { interval: price.recurring.interval, intervalCount: price.recurring.interval_count } : null,
      product: product ? {
        id: product.id,
        name: product.name,
        active: product.active,
        metadata: product.metadata || {},
      } : null,
    })
  } catch (err) {
    console.error('sms-diagnostic-price failed', { code: err?.code || 'unknown' })
    return res.status(500).json({ error: 'Diagnostic failed' })
  }
}
