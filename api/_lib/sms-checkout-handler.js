import { logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'
import { computeEffectivePlan } from './entitlements.js'
import { CHECKOUT_PRICE_IDS, LEGACY_PLUS_PRICE_INTERVALS } from './checkout-handler.js'
import { requireAppUrl } from './require-config.js'
import { createSeparateSmsCheckout } from './sms-checkout-session.js'

// This is the verified iDogs Plus test-mode price in the iDogs Stripe Test mode
// environment. It is accepted only on Vercel Preview for the isolated iDogs
// staging Firebase project; production continues to accept only CHECKOUT_PRICE_IDS.
const STAGING_PLUS_PRICE_ID = 'price_1TxaNJGHgBd6ZgJEpAhrWark'

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

function allowedBasePlusPriceIds() {
  const allowed = [...Object.values(CHECKOUT_PRICE_IDS), ...Object.keys(LEGACY_PLUS_PRICE_INTERVALS)]
  if (process.env.VERCEL_ENV === 'preview' && process.env.FIREBASE_PROJECT_ID === 'idogs-app-staging') {
    allowed.push(STAGING_PLUS_PRICE_ID)
  }
  return allowed
}

function hasBasePlusPrice(subscription) {
  const allowed = new Set(allowedBasePlusPriceIds())
  return subscriptionPriceIds(subscription).some(id => allowed.has(id))
}

function hasPrice(subscription, priceId) {
  return subscriptionPriceIds(subscription).includes(priceId)
}

function reject409(res, code, message) {
  logSanitizedError('create-sms-addon-checkout', code)
  return res.status(409).json({ error: message })
}

export function createSmsAddonCheckoutHandler({
  verifyIdToken,
  getProfile,
  retrieveSubscription,
  listSubscriptions, createSession, getSmsAttempt, saveSmsSession,
  verifyCheckout = async () => false,
  getAppUrl = requireAppUrl,
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
        return reject409(res, 'SMS_GUARD_PLUS_PRICE_MISMATCH', 'Verified iDogs Plus price not found on subscription')
      }
      if (!['active', 'trialing'].includes(subscription.status)) {
        return reject409(res, 'SMS_GUARD_STRIPE_STATUS', 'Resolve your Plus billing status before adding SMS')
      }
      if (hasPrice(subscription, priceId)) {
        return reject409(res, 'SMS_GUARD_ALREADY_PRESENT', 'SMS add-on already exists; manage it in Billing')
      }

      // A subscription-wide trial also makes newly attached items free. Use
      // an independent paid SMS subscription, preserving the Plus promotion.
      {
        const origin = getAppUrl()
        if (!origin || !listSubscriptions || !createSession || !getSmsAttempt || !saveSmsSession) throw new Error('SMS_CHECKOUT_NOT_CONFIGURED')
        if (!await verifyCheckout(profile, priceId, subscription.livemode)) throw new Error('SMS_PRICE_TAX_UNVERIFIED')
        const session = await createSeparateSmsCheckout({ uid: identity.uid, profile, priceId, origin,
          listSubscriptions, createSession, getSmsAttempt, saveSmsSession })
        return res.status(200).json({ url: session.url })
      }
    } catch (err) {
      logSanitizedError('create-sms-addon-checkout', 'SMS_ADDON_UPDATE_FAILED', { code: err?.code })
      return res.status(500).json({ error: 'Failed to add SMS to your Plus subscription' })
    }
  }
}


export function createSmsAddonRemoveHandler({
  verifyIdToken,
  getProfile,
  retrieveSubscription,
  updateSubscription,
  cancelSubscription,
  getPriceId = () => process.env.STRIPE_SMS_ADDON_PRICE_ID,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const priceId = getPriceId()
    if (!priceId || typeof priceId !== 'string') {
      logConfigError('remove-sms-addon', 'SMS_PRICE_NOT_CONFIGURED')
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
    if (body.priceId !== undefined || body.userId !== undefined || body.subscriptionId !== undefined || body.itemId !== undefined) {
      return res.status(400).json({ error: 'Unsupported add-on fields' })
    }

    try {
      const profile = await getProfile(identity.uid)
      if (!profile) return res.status(404).json({ error: 'Profile not found' })
      if (computeEffectivePlan(profile) !== 'plus') {
        return res.status(403).json({ error: 'iDogs Plus is required for the SMS add-on' })
      }
      if (!profile.stripeCustomerId || !profile.stripeSubscriptionId) {
        return reject409(res, 'SMS_REMOVE_MISSING_BILLING_LINK', 'An active Stripe Plus subscription is required')
      }

      const subscription = await retrieveSubscription(profile.stripeSubscriptionId)
      if (!subscription || subscription.id !== profile.stripeSubscriptionId) {
        return reject409(res, 'SMS_REMOVE_SUBSCRIPTION_VERIFY', 'Plus subscription could not be verified')
      }
      if (customerIdOf(subscription) !== profile.stripeCustomerId) {
        return reject409(res, 'SMS_REMOVE_CUSTOMER_MISMATCH', 'Stripe customer mismatch')
      }
      if (!hasBasePlusPrice(subscription)) {
        return reject409(res, 'SMS_REMOVE_PLUS_PRICE_MISMATCH', 'Verified iDogs Plus price not found on subscription')
      }

      if (profile.smsStripeSubscriptionId && profile.smsStripeSubscriptionId !== subscription.id) {
        const sms = await retrieveSubscription(profile.smsStripeSubscriptionId)
        if (customerIdOf(sms) !== profile.stripeCustomerId || sms.metadata?.userId !== identity.uid ||
            sms.metadata?.purchaseType !== 'sms_addon' || !hasPrice(sms, priceId) || hasBasePlusPrice(sms)) {
          return reject409(res, 'SMS_REMOVE_SEPARATE_MISMATCH', 'SMS subscription could not be verified')
        }
        if (!['canceled', 'incomplete_expired'].includes(sms.status)) await cancelSubscription(sms.id, { prorate: false, invoice_now: false })
        return res.status(200).json({ success: true, status: 'removing' })
      }

      const smsItem = (subscription.items?.data || []).find(item => item?.price?.id === priceId)
      if (!smsItem?.id) {
        return reject409(res, 'SMS_REMOVE_ALREADY_ABSENT', 'SMS add-on is already removed')
      }

      await updateSubscription(subscription.id, {
        items: [{ id: smsItem.id, deleted: true }],
        proration_behavior: 'always_invoice',
      })

      return res.status(200).json({ success: true, status: 'removing' })
    } catch (err) {
      logSanitizedError('remove-sms-addon', 'SMS_REMOVE_FAILED', { code: err?.code })
      return res.status(500).json({ error: 'Failed to remove SMS from your Plus subscription' })
    }
  }
}
