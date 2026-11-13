// api/_lib/founding-checkout-handler.js — one-off A$49 Founding Member
// Checkout (15 months of Plus, no subscription, no renewal). Web only:
// the iOS app never shows or links to this purchase.
import { FOUNDING_OFFER } from '../../shared/access-grants.js'
import { logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,100}$/
const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])

function parseBody(req) {
  if (typeof req.body !== 'string') return req.body || {}
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

export function createFoundingCheckoutHandler({
  verifyIdToken,
  getProfile,
  getSeatsSold,
  getTaxProductId,
  createSession,
  getAppUrl,
  isEnabled = () => process.env.FOUNDING_CHECKOUT_ENABLED === 'true',
  // Owner decision 12 Nov 2026: the 15-month pass is sold only once the free
  // Gift Vouchers are gone (or the voucher campaign is off). Same rule as
  // /api/offer-status, enforced here so a direct API call cannot bypass it.
  isLaunchActive = async () => false,
  now = Date.now,
  offer = FOUNDING_OFFER,
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

    // Finance safety gate: deployable to Preview with zero chance of a
    // Checkout Session until the Owner turns it on.
    if (!isEnabled()) {
      logConfigError('create-founding-checkout', 'FOUNDING_CHECKOUT_DISABLED')
      return res.status(503).json({ error: 'The Founding Member offer is not open yet. No payment has been taken.', code: 'FOUNDING_CHECKOUT_DISABLED' })
    }

    const appUrl = getAppUrl(req)
    if (!appUrl) {
      logConfigError('create-founding-checkout', 'APP_URL_NOT_CONFIGURED')
      return res.status(500).json({ error: 'APP_URL not configured' })
    }

    const body = parseBody(req)
    if (Object.keys(body).some(key => key !== 'requestId' && key !== 'acceptTerms')) {
      return res.status(400).json({ error: 'Unsupported checkout fields' })
    }
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
    if (!REQUEST_ID_RE.test(requestId)) return res.status(400).json({ error: 'A valid requestId is required' })
    if (body.acceptTerms !== true) return res.status(400).json({ error: 'Please accept the Founding Member terms.' })

    const t = now()
    if (!(t >= offer.salesStart && t < offer.salesEnd)) {
      return res.status(409).json({ error: 'The Founding Member offer has closed. No payment has been taken.', code: 'FOUNDING_OFFER_CLOSED' })
    }

    try {
      if (await isLaunchActive()) {
        return res.status(409).json({ error: 'Free Gift Vouchers are still available — claim yours instead. No payment has been taken.', code: 'FOUNDING_VOUCHERS_AVAILABLE' })
      }
      const profile = await getProfile(uid)
      if (!profile) return res.status(409).json({ error: 'Account details are not ready. Please refresh Billing.' })
      // Never sell a one-off pass on top of a live subscription (including
      // the A$0 promotion): the customer would pay twice for the same Plus.
      if (profile.stripeSubscriptionId || LIVE_SUBSCRIPTION_STATUSES.has(profile.subscriptionStatus)) {
        return res.status(409).json({
          error: 'You already have an iDogs Plus subscription. The Founding Member pass is for accounts without a subscription. No payment has been taken.',
          code: 'FOUNDING_HAS_SUBSCRIPTION',
        })
      }

      const sold = await getSeatsSold()
      if (!(sold < offer.seats)) {
        return res.status(409).json({ error: 'All Founding Member places have been taken. No payment has been taken.', code: 'FOUNDING_SOLD_OUT' })
      }

      // Re-use the configured Plus product so Stripe Tax applies the same
      // classification as the Plus subscription (GST inclusive).
      const productId = await getTaxProductId()
      if (typeof productId !== 'string' || !productId) throw new Error('FOUNDING_TAX_PRODUCT_MISSING')

      const metadata = { purchaseType: 'founding_member', userId: uid, offerId: offer.id }
      const session = await createSession({
        mode: 'payment',
        automatic_tax: { enabled: true },
        billing_address_collection: 'required',
        ...(profile.stripeCustomerId
          ? { customer: profile.stripeCustomerId, customer_update: { address: 'auto' } }
          : { customer_creation: 'always', ...(email ? { customer_email: email } : {}) }),
        client_reference_id: uid,
        line_items: [{
          price_data: {
            currency: offer.currency,
            unit_amount: offer.priceCents,
            tax_behavior: 'inclusive',
            product: productId,
          },
          quantity: 1,
        }],
        custom_text: { submit: { message: offer.terms } },
        success_url: `${appUrl}/app/billing?founding=success`,
        cancel_url: `${appUrl}/app/billing?founding=cancelled`,
        metadata,
        payment_intent_data: { metadata, description: offer.productName },
      }, { idempotencyKey: `founding:${uid}:${requestId}` })

      if (!session?.url) throw new Error('CHECKOUT_URL_MISSING')
      return res.status(200).json({ url: session.url })
    } catch (err) {
      logSanitizedError('create-founding-checkout', 'FOUNDING_CHECKOUT_FAILED', { code: err?.code, message: err?.message })
      return res.status(500).json({ error: 'Failed to create Founding Member checkout. No payment has been taken.' })
    }
  }
}
