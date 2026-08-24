import { requireAppUrl, logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'
import { computeEffectivePlan } from './entitlements.js'

function parseBody(req) {
  if (typeof req.body !== 'string') return req.body || {}
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

export function createSmsAddonCheckoutHandler({
  verifyIdToken,
  getProfile,
  createSession,
  getPriceId = () => process.env.STRIPE_SMS_ADDON_PRICE_ID,
  getAppUrl = requireAppUrl,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const appUrl = getAppUrl()
    if (!appUrl) {
      logConfigError('create-sms-addon-checkout', 'APP_URL_NOT_CONFIGURED')
      return res.status(500).json({ error: 'APP_URL not configured' })
    }

    const priceId = getPriceId()
    if (!priceId || typeof priceId !== 'string') {
      logConfigError('create-sms-addon-checkout', 'SMS_PRICE_NOT_CONFIGURED')
      return res.status(503).json({ error: 'SMS add-on is not configured' })
    }

    const authHeader = req.headers?.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return res.status(401).json({ error: 'Missing Authorization header' })

    let identity
    try { identity = await verifyIdToken(token) } catch {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    if (!identity?.uid) return res.status(401).json({ error: 'Authenticated identity is incomplete' })

    const body = parseBody(req)
    if (body.priceId !== undefined || body.userId !== undefined) {
      return res.status(400).json({ error: 'Unsupported checkout fields' })
    }

    try {
      const profile = await getProfile(identity.uid)
      if (!profile) return res.status(404).json({ error: 'Profile not found' })
      if (computeEffectivePlan(profile) !== 'plus') {
        return res.status(403).json({ error: 'iDogs Plus is required for the SMS add-on' })
      }
      if (!profile.stripeCustomerId || typeof profile.stripeCustomerId !== 'string') {
        return res.status(409).json({ error: 'A Stripe billing account is required' })
      }
      if (profile.smsAddonStatus === 'active' || profile.smsAddonStatus === 'past_due') {
        return res.status(409).json({ error: 'SMS add-on already exists; manage it in Billing' })
      }

      const session = await createSession({
        mode: 'subscription',
        customer: profile.stripeCustomerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${appUrl}/app/billing?sms_success=1`,
        cancel_url: `${appUrl}/app/billing?sms_cancelled=1`,
        metadata: { userId: identity.uid, product: 'sms_addon_v1' },
        subscription_data: {
          metadata: { userId: identity.uid, product: 'sms_addon_v1' },
        },
      })
      if (!session?.url) throw new Error('SESSION_URL_MISSING')
      return res.status(200).json({ url: session.url })
    } catch (err) {
      logSanitizedError('create-sms-addon-checkout', 'SMS_CHECKOUT_FAILED', {
        code: err?.code,
      })
      return res.status(500).json({ error: 'Failed to start SMS add-on checkout' })
    }
  }
}
