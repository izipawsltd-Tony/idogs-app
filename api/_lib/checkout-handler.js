import { PROMOTION_TAX_POLICY } from './promotion-tax.js'
import { requireAppUrl } from './require-config.js'
import { logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'
import { createHash } from 'node:crypto'
import { isPlusPromotionActive, PLUS_PROMOTION_ID, PLUS_PROMOTION_END, PLUS_PROMOTION_TERMS } from '../../shared/plus-promotion.js'

// iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md, LOCKED). Only two
// real Stripe Checkout price ids exist for iDogs — Plus Monthly and Plus
// Annual. The legacy Basic/Pro/Kennel/SMS-addon four-tier prices are
// retired from NEW checkout selection, but existing paid subscriptions are
// still honored by the webhook compatibility allowlist below.
// The $40 launch-offer price mentioned in §1.1 of the record is explicitly
// NOT implemented per this round's scope.
export const CHECKOUT_PRICE_IDS = Object.freeze({
  // Read-only verified in the iDogs Stripe account: AUD700/month and
  // AUD7000/year, both active on the existing iDogs Plus product.
  plus_monthly: 'price_1UAInbGHgBd6ZgJE0NAikQgm',
  plus_annual: 'price_1UAIngGHgBd6ZgJEh3njs6hZ',
})

// Never strand existing/older Plus subscriptions when new Checkout moves to
// the verified A$7/A$70 prices. These are recognition-only, not new checkout.
export const LEGACY_PLUS_PRICE_INTERVALS = Object.freeze({
  // Existing staging A$7 test Price, also used by isolated promotion QA.
  price_1U9YwuGHgBd6ZgJEX1Bdjz5x: 'monthly',
  price_1TxaNJGHgBd6ZgJEpAhrWark: 'monthly',
  price_1TxMJ9GHgBd6ZgJEcwyahH58: 'monthly',
  price_1TxMJ8GHgBd6ZgJEt56IzJJd: 'annual',
  price_1U9i9EGHgBd6ZgJEMoELFmE5: 'monthly',
  price_1U9i9LGHgBd6ZgJEdQWL2WTN: 'annual',
})

// Legacy paid subscriptions remain entitlement-compatible for renewals.
// They are deliberately NOT exposed by createCheckoutHandler, so no new
// Basic/Pro/Kennel subscriptions can be created. Existing subscribers who
// are still being charged must not fall back to Free merely because the
// public pricing model moved to Free/Plus.
export const LEGACY_PAID_PRICE_IDS = Object.freeze({
  basic: 'price_1TiaZn5lmfxrCiH3GCzSSuAy',
  pro: 'price_1Tiabb5lmfxrCiH3kBdaQsRH',
  kennel: 'price_1TiU7j5lmfxrCiH3J1WbbrLR',
})

// Both keys resolve to the same entitlement — Plus. The billing interval
// (monthly vs annual) only matters for the Stripe price/checkout UI and for
// computing the AI-scan reset anchor (api/stripe-webhook.js); it is never a
// separate entitlement tier.
const INTERVAL_BY_PLAN_KEY = Object.freeze({
  plus_monthly: 'monthly',
  plus_annual: 'annual',
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
  getProfile,
  getPromotionTaxStatus,
  getPromotionAttempt,
  savePromotionSession,
  canReusePromotionCustomer,
  checkoutPriceIds = CHECKOUT_PRICE_IDS,
  promotionCheckoutEnabled = true,
  now = Date.now,
} = {}) {
  return async function checkoutHandler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const appUrl = getAppUrl(req)
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

    const { plan: planKey } = body
    const priceId = checkoutPriceIds[planKey]
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid plan' })
    }
    const interval = INTERVAL_BY_PLAN_KEY[planKey]

    const promotion = body.promotion !== undefined
    if (promotion && !promotionCheckoutEnabled) return res.status(503).json({ error: 'Promotion checkout is not configured for this environment. No payment has been taken.' })
    let timestamp = now()
    if (promotion && (body.promotion !== PLUS_PROMOTION_ID || planKey !== 'plus_monthly' || body.acceptPromotionTerms !== true)) {
      return res.status(400).json({ error: 'Please accept the monthly promotion terms.' })
    }
    if (promotion && (!isPlusPromotionActive(timestamp) || PLUS_PROMOTION_END - timestamp <= 32 * 60_000)) {
      return res.status(409).json({ error: 'This offer can no longer be started. No payment has been taken. Refresh Billing to view available plans.' })
    }

    try {
      let profile
      let attempt
      if (promotion) {
        // Server-owned profile only: never accept subscription/customer IDs
        // from the browser. Existing subscribers need their own migration.
        if (!getProfile) throw new Error('Promotion profile verification unavailable')
        profile = await getProfile(uid)
        if (!profile) return res.status(409).json({ error: 'Account details are not ready. Please refresh Billing.' })
        const knownBilling = profile.stripeSubscriptionId || ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'].includes(profile.subscriptionStatus)
        // Historical profile fields can outlive a canceled Stripe subscription.
        // Only the existing server-side, exhaustive Stripe customer check can
        // permit a new checkout; a stale profile must never grant that permission.
        const reusableCustomer = profile.stripeCustomerId && canReusePromotionCustomer
          ? await canReusePromotionCustomer(profile.stripeCustomerId) : false
        if (knownBilling && !reusableCustomer) {
          return res.status(409).json({ error: 'Your existing billing account must be reviewed for this offer. Please use Manage subscription; do not create another subscription.' })
        }
        if (profile.stripeCustomerId && !reusableCustomer) {
          return res.status(409).json({ error: 'Your existing billing account must be reviewed before starting another subscription.' })
        }
        if (!getPromotionAttempt || !savePromotionSession) throw new Error('Promotion session verification unavailable')
        if (!getPromotionTaxStatus || await getPromotionTaxStatus(priceId, profile.stripeCustomerId || null) !== true) return res.status(503).json({ error: 'Tax configuration or billing address requires review. No payment has been taken.' })
        attempt = await getPromotionAttempt(uid, timestamp, profile.stripeCustomerId || null, appUrl, PROMOTION_TAX_POLICY,
          reusableCustomer ? { subscriptionId: profile.stripeSubscriptionId || null, status: profile.subscriptionStatus || null } : null)
        if (attempt.checkoutPolicy !== PROMOTION_TAX_POLICY) return res.status(409).json({ error: 'An earlier checkout uses older tax terms. Wait until it expires or contact support; do not start another subscription.' })
        if (attempt.returnOrigin !== appUrl) return res.status(409).json({ error: 'An earlier checkout uses a different page. Do not start another checkout. Reopen Billing where that checkout started or contact support.' })
        if (attempt.url) return res.status(200).json({ url: attempt.url })
        timestamp = attempt.createdAt
      }
      const session = await createSession({
        mode: 'subscription',
        ...(promotion ? {
          automatic_tax: { enabled: true },
          billing_address_collection: 'required',
          ...(profile?.stripeCustomerId ? { customer_update: { address: 'auto' } } : {}),
          payment_method_collection: 'always',
          expires_at: Math.floor(Math.min(timestamp + 23 * 60 * 60_000, PLUS_PROMOTION_END - 60_000) / 1000),
          custom_text: { submit: { message: PLUS_PROMOTION_TERMS } },
        } : {}),
        ...(promotion && profile?.stripeCustomerId ? { customer: profile.stripeCustomerId } : { customer_email: email }),
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${appUrl}/app/billing?success=1`,
        cancel_url: `${appUrl}/app/billing?cancelled=1`,
        metadata: { userId: uid, plan: 'plus', interval, priceId, ...(promotion ? { promotion: PLUS_PROMOTION_ID } : {}) },
        subscription_data: {
          metadata: { userId: uid, plan: 'plus', interval, priceId, ...(promotion ? { promotion: PLUS_PROMOTION_ID, promotionConsent: 'accepted-v1' } : {}) },
          ...(promotion ? (PLUS_PROMOTION_END - timestamp >= 48 * 60 * 60_000
            ? { trial_end: Math.floor(PLUS_PROMOTION_END / 1000), trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } }
            : { billing_cycle_anchor: Math.floor(PLUS_PROMOTION_END / 1000), proration_behavior: 'none' }) : {}),
        },
      }, promotion ? { idempotencyKey: `plus-promotion-${createHash('sha256').update(`${uid}/${PLUS_PROMOTION_ID}/${timestamp}/${attempt.checkoutPolicy}`).digest('hex')}` } : undefined)
      if (promotion) await savePromotionSession(uid, attempt, session)
      return res.status(200).json({ url: session.url })
    } catch (err) {
      logSanitizedError('create-checkout', 'CHECKOUT_SESSION_FAILED', {
        message: err?.message,
        code: err?.code,
      })
      return res.status(500).json({ error: 'Failed to create checkout' })
    }
  }
}
