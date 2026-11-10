import { requireAppUrl } from './require-config.js'
import { logSanitizedError } from './http-helpers.js'

function bearerToken(req) {
  const value = req.headers?.authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

async function authenticate(req, verifyIdToken) {
  const token = bearerToken(req)
  if (!token) return { error: { status: 401, body: { error: 'Missing Authorization header' } } }
  try {
    const identity = await verifyIdToken(token)
    if (!identity?.uid) return { error: { status: 401, body: { error: 'Authenticated identity is incomplete' } } }
    return { uid: identity.uid }
  } catch {
    return { error: { status: 401, body: { error: 'Invalid or expired token' } } }
  }
}

function customerIdOf(value) {
  if (typeof value === 'string') return value
  if (value && typeof value.id === 'string') return value.id
  return null
}

function isoFromSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null
}

function subscriptionPeriodEnd(subscription) {
  if (typeof subscription?.current_period_end === 'number') return subscription.current_period_end
  const items = subscription?.items?.data || []
  const ends = items.map(item => item?.current_period_end).filter(value => typeof value === 'number')
  return ends.length ? Math.max(...ends) : null
}

function mapInvoice(invoice) {
  return {
    id: typeof invoice?.id === 'string' ? invoice.id : '',
    number: typeof invoice?.number === 'string' ? invoice.number : null,
    status: typeof invoice?.status === 'string' ? invoice.status : 'unknown',
    amountPaid: Number.isFinite(invoice?.amount_paid) ? invoice.amount_paid : 0,
    amountDue: Number.isFinite(invoice?.amount_due) ? invoice.amount_due : 0,
    currency: typeof invoice?.currency === 'string' ? invoice.currency.toUpperCase() : 'AUD',
    createdAt: isoFromSeconds(invoice?.created),
    hostedInvoiceUrl: typeof invoice?.hosted_invoice_url === 'string' ? invoice.hosted_invoice_url : null,
    invoicePdf: typeof invoice?.invoice_pdf === 'string' ? invoice.invoice_pdf : null,
  }
}

function profileEntitlement(profile) {
  return {
    plan: profile?.plan === 'plus' ? 'plus' : 'free',
    billingInterval: profile?.billingInterval === 'annual'
      ? 'annual'
      : profile?.billingInterval === 'monthly' ? 'monthly' : null,
    subscriptionStatus: typeof profile?.subscriptionStatus === 'string'
      ? profile.subscriptionStatus
      : null,
  }
}

const ENDED_SUBSCRIPTION_STATUSES = ['canceled', 'incomplete_expired', 'unpaid']

function isMissingStripeResource(error) {
  return error?.code === 'resource_missing' && (error?.statusCode === 404 || error?.raw?.statusCode === 404 || error?.type === 'StripeInvalidRequestError')
}

export function createBillingSummaryHandler({
  verifyIdToken,
  getProfile,
  retrieveSubscription,
  listInvoices,
  isSmsConfigured = () => false,
  reconcileVerifiedPlus = async () => false,
  // Newest active/trialing Plus subscription for this Stripe customer that was
  // created for this account (metadata.userId). Used only when the stored one
  // has ended or is missing, so a delayed or undelivered webhook cannot leave a
  // paying account showing Free.
  findReplacementSubscription = async () => null,
} = {}) {
  return async function billingSummaryHandler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

    const auth = await authenticate(req, verifyIdToken)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    try {
      const profile = await getProfile(auth.uid)
      if (!profile) return res.status(404).json({ error: 'Profile not found' })

      const sms = {
        configured: Boolean(isSmsConfigured()),
        status: typeof profile.smsAddonStatus === 'string' ? profile.smsAddonStatus : 'inactive',
        creditsUsed: Number.isInteger(profile.smsCreditsUsed) && profile.smsCreditsUsed >= 0 ? profile.smsCreditsUsed : 0,
        creditsLimit: Number.isInteger(profile.smsCreditsLimit) && profile.smsCreditsLimit > 0 ? profile.smsCreditsLimit : 20,
        periodStart: typeof profile.smsPeriodStart === 'string' ? profile.smsPeriodStart : null,
        periodEnd: typeof profile.smsPeriodEnd === 'string' ? profile.smsPeriodEnd : null,
      }
      let entitlement = profileEntitlement(profile)
      const customerId = typeof profile.stripeCustomerId === 'string' ? profile.stripeCustomerId : null
      const subscriptionId = typeof profile.stripeSubscriptionId === 'string' ? profile.stripeSubscriptionId : null
      if (!customerId) {
        return res.status(200).json({ subscription: null, invoices: [], canManageBilling: false, sms, entitlement })
      }

      let subscription = null
      let stripeSubscription = null
      let storedSubscriptionMissing = false
      if (subscriptionId) {
        try {
          stripeSubscription = await retrieveSubscription(subscriptionId)
        } catch (error) {
          // Only a stored id that Stripe no longer has falls through to the
          // guarded replacement lookup; every other failure stays a 500.
          if (!isMissingStripeResource(error)) throw error
          storedSubscriptionMissing = true
          logSanitizedError('billing-summary', 'STORED_SUBSCRIPTION_MISSING')
        }
      }
      if (stripeSubscription && customerIdOf(stripeSubscription.customer) !== customerId) {
        logSanitizedError('billing-summary', 'SUBSCRIPTION_CUSTOMER_MISMATCH')
        return res.status(409).json({ error: 'Billing account mismatch' })
      }
      if (!stripeSubscription || ENDED_SUBSCRIPTION_STATUSES.includes(stripeSubscription.status)) {
        const replacement = await findReplacementSubscription({ customerId, userId: auth.uid, excludeId: stripeSubscription?.id || null })
        if (replacement && replacement.id !== stripeSubscription?.id
          && customerIdOf(replacement.customer) === customerId
          && replacement.metadata?.userId === auth.uid
          && ['active', 'trialing'].includes(replacement.status)) {
          stripeSubscription = replacement
        }
      }
      if (storedSubscriptionMissing && !stripeSubscription) {
        // The stored subscription no longer exists in Stripe and no verified
        // replacement was found, so nothing backs a Plus plan from the stale
        // profile. Response only: the profile is not rewritten here
        // (Codex P2 6762625363).
        entitlement = { plan: 'free', billingInterval: null, subscriptionStatus: null }
      }
      if (stripeSubscription) {

        const reconciled = await reconcileVerifiedPlus({
          subscription: stripeSubscription,
          userId: auth.uid,
        })
        if (reconciled && typeof reconciled === 'object') {
          entitlement = {
            plan: reconciled.plan === 'plus' ? 'plus' : 'free',
            billingInterval: reconciled.billingInterval === 'annual'
              ? 'annual'
              : reconciled.billingInterval === 'monthly' ? 'monthly' : null,
            subscriptionStatus: typeof reconciled.subscriptionStatus === 'string'
              ? reconciled.subscriptionStatus
              : null,
          }
        }

        subscription = {
          id: stripeSubscription.id,
          status: stripeSubscription.status || profile.subscriptionStatus || 'unknown',
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end === true,
          currentPeriodEnd: isoFromSeconds(subscriptionPeriodEnd(stripeSubscription)),
        }
        // A canceled Stripe subscription cannot be shown as active from a stale
        // Firestore profile. This response does not rewrite customer records.
        if (ENDED_SUBSCRIPTION_STATUSES.includes(stripeSubscription.status)) {
          entitlement = { plan: 'free', billingInterval: null, subscriptionStatus: stripeSubscription.status }
          sms.status = 'cancelled'
        }
      }

      const result = await listInvoices({ customer: customerId, limit: 12 })
      const invoices = (result?.data || []).map(mapInvoice).filter(invoice => invoice.id)
      return res.status(200).json({ subscription, invoices, canManageBilling: true, sms, entitlement })
    } catch {
      logSanitizedError('billing-summary', 'BILLING_SUMMARY_FAILED')
      return res.status(500).json({ error: 'Failed to load billing details' })
    }
  }
}

export function createBillingPortalHandler({
  verifyIdToken,
  getProfile,
  createPortalSession,
  getAppUrl = requireAppUrl,
} = {}) {
  return async function billingPortalHandler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const auth = await authenticate(req, verifyIdToken)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    const appUrl = getAppUrl()
    if (!appUrl) return res.status(500).json({ error: 'APP_URL not configured' })

    try {
      const profile = await getProfile(auth.uid)
      const customerId = typeof profile?.stripeCustomerId === 'string' ? profile.stripeCustomerId : null
      if (!customerId) return res.status(409).json({ error: 'No Stripe billing account is linked' })

      const session = await createPortalSession({
        customer: customerId,
        return_url: `${appUrl}/app/billing`,
      })
      if (!session?.url) throw new Error('Portal URL missing')
      return res.status(200).json({ url: session.url })
    } catch (error) {
      if (error?.message === 'Portal URL missing') {
        logSanitizedError('billing-portal', 'PORTAL_URL_MISSING')
      } else {
        logSanitizedError('billing-portal', 'PORTAL_SESSION_FAILED')
      }
      return res.status(500).json({ error: 'Failed to open billing portal' })
    }
  }
}
