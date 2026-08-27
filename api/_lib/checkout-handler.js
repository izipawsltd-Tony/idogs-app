import { requireAppUrl } from './require-config.js'
import { logConfigError } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'

// iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md, LOCKED). Only two
// real Stripe Checkout price ids exist for iDogs — Plus Monthly and Plus
// Annual. The legacy Basic/Pro/Kennel/SMS-addon four-tier prices are
// retired here (no live customers referenced them — see CLAUDE.md
// "Trạng thái production"), never selectable through this endpoint again.
// The $40 launch-offer price mentioned in §1.1 of the record is explicitly
// NOT implemented per this round's scope.
const LIVE_CHECKOUT_PRICE_IDS = Object.freeze({
  plus_monthly: 'price_1TxMJ9GHgBd6ZgJEcwyahH58',
  plus_annual: 'price_1TxMJ8GHgBd6ZgJEt56IzJJd',
})

const STAGING_CHECKOUT_PRICE_IDS = Object.freeze({
  plus_monthly: 'price_1TxaNJGHgBd6ZgJEpAhrWark',
  plus_annual: 'price_1TxaReGHgBd6ZgJETSXH6ICp',
})

function checkoutPricesForCurrentEnvironment() {
  // Route prices by Firebase project identity, not Vercel target. The stable
  // staging alias is deployed with `vercel --prod` inside the staging Vercel
  // project, so VERCEL_ENV is "production" there even though it must still
  // use the isolated iDogs TEST Stripe prices. Production Firebase continues
  // to resolve only LIVE prices.
  return process.env.FIREBASE_PROJECT_ID === 'idogs-app-staging'
    ? STAGING_CHECKOUT_PRICE_IDS
    : LIVE_CHECKOUT_PRICE_IDS
}

// Keep the existing exported shape so checkout, webhook and SMS guards all
// resolve the same allowlisted base Plus prices. Accessors deliberately
// resolve at runtime so staging Firebase always uses test prices while the
// production Firebase project uses live prices.
export const CHECKOUT_PRICE_IDS = Object.freeze({
  get plus_monthly() { return checkoutPricesForCurrentEnvironment().plus_monthly },
  get plus_annual() { return checkoutPricesForCurrentEnvironment().plus_annual },
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

    const { plan: planKey } = body
    const priceId = CHECKOUT_PRICE_IDS[planKey]
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid plan' })
    }
    const interval = INTERVAL_BY_PLAN_KEY[planKey]

    try {
      const session = await createSession({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${appUrl}/app/billing?success=1`,
        cancel_url: `${appUrl}/app/billing?cancelled=1`,
        metadata: { userId: uid, plan: 'plus', interval, priceId },
        subscription_data: {
          metadata: { userId: uid, plan: 'plus', interval, priceId },
        },
      })
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
