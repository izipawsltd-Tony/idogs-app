import { logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'
import { computeEffectivePlan } from './entitlements.js'
import { CHECKOUT_PRICE_IDS } from './checkout-handler.js'

function parseBody(req) {
  if (typeof req.body !== 'string') return req.body || {}
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

function customerIdOf(subscription) {
  if (typeof subscription?.customer === 'string') return subscription.customer
  return subscription?.customer?.id || null
}

function subscriptionPriceIds(subscription) {
  return (subscription?.items?.data || [])
    .map(item => item?.price?.id)
    .filter(id => typeof id === 'string' && id)
}

function hasBasePlusPrice(subscription) {
  const allowed = new Set(Object.values(CHECKOUT_PRICE_IDS))
  return subscriptionPriceIds(subscription).some(id => allowed.has(id))
}

function hasPrice(subscription, priceId) {
  return subscriptionPriceIds(subscription).includes(priceId)
}

function reject409(res, code, message, details) {
  logSanitizedError('create-sms-addon-checkout', code, details)
  return res.status(409).json({ error: message })
}

export function createSmsAddonCheckoutHandler({
  verifyIdToken,
  getProfile,
  retrieveSubscription,
  updateSubscription,
  getPriceId = () => process.env.STRIPE_SMS_ADDON_PRICE_ID,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
    if (body.priceId !== undefined || body.userId !== undefined || body.subscriptionId !== undefined) {
      return res.status(400).json({ error: 'Unsupported add-on fields' })
    }

    try {
      const profile = await getProfile(identity.uid)
      if (!profile) return res.status(404).json({ error: 'Profile not found' })
      if (computeEffectivePlan(profile) !== 'plus') {
        return res.status(403).json({ error: 'iDogs Plus is required for the SMS add-on' })
      }
      if (!profile.stripeCustomerId || !profile.stripeSubscriptionId) {
        return reject409(res, 'SMS_GUARD_MISSING_BILLING_LINK', 'An active Stripe Plus subscription is required')
      }
      if (profile.subscriptionStatus !== 'active' && profile.subscriptionStatus !== 'trialing') {
        return reject409(res, 'SMS_GUARD_SUBSCRIPTION_STATUS', 'Resolve your Plus subscription billing status before adding SMS')
      }

      const subscription = await retrieveSubscription(profile.stripeSubscriptionId)
      if (!subscription || subscription.id !== profile.stripeSubscriptionId) {
        return reject409(res, 'SMS_GUARD_SUBSCRIPTION_VERIFY', 'Plus subscription could not be verified')
      }
      if (customerIdOf(subscription) !== profile.stripeCustomerId) {
        return reject409(res, 'SMS_GUARD_CUSTOMER_MISMATCH', 'Stripe customer mismatch')
      }
      if (!hasBasePlusPrice(subscription)) {
        return reject409(
          res,
          'SMS_GUARD_PLUS_PRICE_MISMATCH',
          'Verified iDogs Plus price not found on subscription',
          {
            subscriptionPriceIds: subscriptionPriceIds(subscription),
            allowedPlusPriceIds: Object.values(CHECKOUT_PRICE_IDS),
          },
        )
      }
      if (hasPrice(subscription, priceId)) {
        return reject409(res, 'SMS_GUARD_ALREADY_PRESENT', 'SMS add-on already exists; manage it in Billing')
      }

      const updated = await updateSubscription(subscription.id, {
        items: [{ price: priceId, quantity: 1 }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        expand: ['latest_invoice'],
      })

      const pending = Boolean(updated?.pending_update)
      const hostedInvoiceUrl = typeof updated?.latest_invoice === 'object'
        ? updated.latest_invoice?.hosted_invoice_url || null
        : null

      return res.status(pending ? 202 : 200).json({
        success: true,
        status: pending ? 'pending_payment' : 'activating',
        hostedInvoiceUrl,
      })
    } catch (err) {
      logSanitizedError('create-sms-addon-checkout', 'SMS_ADDON_UPDATE_FAILED', { code: err?.code })
      return res.status(500).json({ error: 'Failed to add SMS to your Plus subscription' })
    }
  }
}
