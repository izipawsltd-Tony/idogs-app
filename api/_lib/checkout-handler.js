import { requireAppUrl } from './require-config.js'
import { logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'

export const CHECKOUT_PRICE_IDS = Object.freeze({
  basic: 'price_1TiaZn5lmfxrCiH3GCzSSuAy',
  pro: 'price_1Tiabb5lmfxrCiH3kBdaQsRH',
  kennel: 'price_1TiU7j5lmfxrCiH3J1WbbrLR',
  sms_addon: 'price_1Tialb5lmfxrCiH3pe82Abps',
})

function bodyOf(req) {
  if (typeof req.body !== 'string') return req.body || {}
  try {
    return JSON.parse(req.body || '{}')
  } catch {
    return {}
  }
}

export function createCheckoutHandler({
  verifyIdToken,
  createSession,
  getAppUrl = requireAppUrl,
} = {}) {
  return async function checkoutHandler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const appUrl = getAppUrl()
    if (!appUrl) {
      logConfigError('create-checkout', 'APP_URL_NOT_CONFIGURED')
      return res.status(500).json({ error: 'APP_URL not configured' })
    }

    const authHeader = req.headers?.authorization || ''
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!idToken) {
      return res.status(401).json({ error: 'Missing Authorization header' })
    }

    let identity
    try {
      identity = await verifyIdToken(idToken)
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    const uid = typeof identity?.uid === 'string' ? identity.uid : ''
    const email = typeof identity?.email === 'string' ? identity.email.trim() : ''
    if (!uid || !email) {
      return res.status(401).json({ error: 'Authenticated identity is incomplete' })
    }

    const body = bodyOf(req)
    if (body.userId !== undefined && body.userId !== uid) {
      return res.status(403).json({ error: 'Authenticated identity mismatch' })
    }
    if (
      body.userEmail !== undefined &&
      (typeof body.userEmail !== 'string' || body.userEmail.trim().toLowerCase() !== email.toLowerCase())
    ) {
      return res.status(403).json({ error: 'Authenticated identity mismatch' })
    }

    const { plan, smsAddon } = body
    const priceId = CHECKOUT_PRICE_IDS[plan]
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid plan' })
    }

    const lineItems = [{ price: priceId, quantity: 1 }]
    if (smsAddon && CHECKOUT_PRICE_IDS.sms_addon) {
      lineItems.push({ price: CHECKOUT_PRICE_IDS.sms_addon, quantity: 1 })
    }

    try {
      const session = await createSession({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: email,
        line_items: lineItems,
        success_url: `${appUrl}/app/billing?success=1`,
        cancel_url: `${appUrl}/app/billing?cancelled=1`,
        metadata: { userId: uid, plan },
        subscription_data: {
          metadata: { userId: uid, plan },
          trial_period_days: 30,
        },
      })
      return res.status(200).json({ url: session.url })
    } catch {
      logSanitizedError('create-checkout', 'CHECKOUT_SESSION_FAILED')
      return res.status(500).json({ error: 'Failed to create checkout' })
    }
  }
}
