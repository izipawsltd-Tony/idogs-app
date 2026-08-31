import { computeEffectivePlan } from './entitlements.js'
import { breederIdentity } from './breeder-profile.js'
import { checkoutTaxRatesForStripeMode } from './checkout-handler.js'
import { verifiedPlusInterval } from './billing-reconcile.js'
import { requireAppUrl, logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'
import { EXTRA_LITTER_PRICE_CENTS } from './litter-quota.js'

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,100}$/

function parseBody(req) {
  if (typeof req.body !== 'string') return req.body || {}
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

function customerIdOf(subscription) {
  if (typeof subscription?.customer === 'string') return subscription.customer
  return subscription?.customer?.id || null
}

export function createExtraLitterCheckoutHandler({
  verifyIdToken,
  getProfile,
  retrieveSubscription,
  createSession,
  getAppUrl = requireAppUrl,
  isEnabled = () => process.env.EXTRA_LITTER_CHECKOUT_ENABLED === 'true',
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const authHeader = req.headers?.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return res.status(401).json({ error: 'Missing Authorization header' })

    let identity
    try { identity = await verifyIdToken(token) } catch {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    const uid = typeof identity?.uid === 'string' ? identity.uid : ''
    const email = typeof identity?.email === 'string' ? identity.email.trim() : ''
    if (!uid) return res.status(401).json({ error: 'Authenticated identity is incomplete' })

    // Finance safety gate. Code can be deployed to Preview and fully tested
    // without any possibility of creating a Stripe Checkout Session.
    if (!isEnabled()) {
      logConfigError('create-extra-litter-checkout', 'EXTRA_LITTER_CHECKOUT_DISABLED')
      return res.status(503).json({
        error: 'Extra litter checkout is not enabled yet',
        code: 'EXTRA_LITTER_CHECKOUT_DISABLED',
      })
    }

    const appUrl = getAppUrl()
    if (!appUrl) {
      logConfigError('create-extra-litter-checkout', 'APP_URL_NOT_CONFIGURED')
      return res.status(500).json({ error: 'APP_URL not configured' })
    }

    const body = parseBody(req)
    const keys = Object.keys(body)
    if (keys.some(key => key !== 'requestId')) {
      return res.status(400).json({ error: 'Unsupported checkout fields' })
    }
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
    if (!REQUEST_ID_RE.test(requestId)) {
      return res.status(400).json({ error: 'A valid requestId is required' })
    }

    try {
      const profile = await getProfile(uid)
      if (!profile) return res.status(404).json({ error: 'Profile not found' })
      if (computeEffectivePlan(profile) !== 'plus') {
        return res.status(403).json({ error: 'iDogs Plus is required to buy an Extra Litter credit' })
      }
      if (!profile.stripeCustomerId || !profile.stripeSubscriptionId) {
        return res.status(409).json({ error: 'An active Stripe Plus subscription is required' })
      }
      if (profile.subscriptionStatus !== 'active' && profile.subscriptionStatus !== 'trialing') {
        return res.status(409).json({ error: 'Resolve your Plus subscription billing status before buying an Extra Litter credit' })
      }

      const subscription = await retrieveSubscription(profile.stripeSubscriptionId)
      if (!subscription || subscription.id !== profile.stripeSubscriptionId) {
        return res.status(409).json({ error: 'Plus subscription could not be verified' })
      }
      if (customerIdOf(subscription) !== profile.stripeCustomerId) {
        return res.status(409).json({ error: 'Stripe customer mismatch' })
      }
      if (!verifiedPlusInterval(subscription)) {
        return res.status(409).json({ error: 'Verified iDogs Plus price not found on subscription' })
      }

      const { breederProfileId } = breederIdentity(profile, { uid, authEmail: email })
      const metadata = {
        purchaseType: 'extra_litter',
        userId: uid,
        breederProfileId,
        pricingVersion: '2026-09-01',
      }
      const session = await createSession(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          customer: profile.stripeCustomerId,
          client_reference_id: uid,
          line_items: [{
            price_data: {
              currency: 'aud',
              unit_amount: EXTRA_LITTER_PRICE_CENTS,
              tax_behavior: 'inclusive',
              product_data: { name: 'iDogs Extra Litter Credit' },
            },
            quantity: 1,
            tax_rates: checkoutTaxRatesForStripeMode(subscription.livemode),
          }],
          success_url: `${appUrl}/app/litters?extra_litter=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${appUrl}/app/litters?extra_litter=cancelled`,
          metadata,
          payment_intent_data: { metadata },
        },
        { idempotencyKey: `extra-litter:${uid}:${requestId}` },
      )

      if (!session?.url) throw new Error('CHECKOUT_URL_MISSING')
      return res.status(200).json({ url: session.url })
    } catch (err) {
      logSanitizedError('create-extra-litter-checkout', 'EXTRA_LITTER_CHECKOUT_FAILED', {
        code: err?.code,
        message: err?.message,
      })
      return res.status(500).json({ error: 'Failed to create Extra Litter checkout' })
    }
  }
}
