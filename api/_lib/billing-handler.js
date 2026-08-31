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

function smsSummary(profile, isSmsConfigured) {
  return {
    configured: Boolean(isSmsConfigured()),
    status: typeof profile?.smsAddonStatus === 'string' ? profile.smsAddonStatus : 'inactive',
    creditsUsed: Number.isInteger(profile?.smsCreditsUsed) && profile.smsCreditsUsed >= 0 ? profile.smsCreditsUsed : 0,
    creditsLimit: Number.isInteger(profile?.smsCreditsLimit) && profile.smsCreditsLimit > 0 ? profile.smsCreditsLimit : 20,
    periodStart: typeof profile?.smsPeriodStart === 'string' ? profile.smsPeriodStart : null,
    periodEnd: typeof profile?.smsPeriodEnd === 'string' ? profile.smsPeriodEnd : null,
  }
}

export function createBillingSummaryHandler({
  verifyIdToken,
  getProfile,
  retrieveSubscription,
  listInvoices,
  isSmsConfigured = () => false,
} = {}) {
  return async function billingSummaryHandler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

    const auth = await authenticate(req, verifyIdToken)
    if (auth.error) return res.status(auth.error.status).json(auth.error.body)

    try {
      const profile = await getProfile(auth.uid)
      const sms = smsSummary(profile, isSmsConfigured)

      // A newly authenticated Free user may not have a Firestore users/{uid}
      // profile yet. Billing is read-only here, so represent that state as an
      // empty Free billing account instead of failing the whole Billing page.
      // Do not create or mutate Firestore from this endpoint.
      if (!profile) {
        return res.status(200).json({ subscription: null, invoices: [], canManageBilling: false, sms })
      }

      const customerId = typeof profile.stripeCustomerId === 'string' ? profile.stripeCustomerId : null
      const subscriptionId = typeof profile.stripeSubscriptionId === 'string' ? profile.stripeSubscriptionId : null
      if (!customerId) {
        return res.status(200).json({ subscription: null, invoices: [], canManageBilling: false, sms })
      }

      let subscription = null
      if (subscriptionId) {
        const stripeSubscription = await retrieveSubscription(subscriptionId)
        if (customerIdOf(stripeSubscription?.customer) !== customerId) {
          logSanitizedError('billing-summary', 'SUBSCRIPTION_CUSTOMER_MISMATCH')
          return res.status(409).json({ error: 'Billing account mismatch' })
        }
        subscription = {
          id: stripeSubscription.id,
          status: stripeSubscription.status || profile.subscriptionStatus || 'unknown',
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end === true,
          currentPeriodEnd: isoFromSeconds(subscriptionPeriodEnd(stripeSubscription)),
        }
      }

      const result = await listInvoices({ customer: customerId, limit: 12 })
      const invoices = (result?.data || []).map(mapInvoice).filter(invoice => invoice.id)
      return res.status(200).json({ subscription, invoices, canManageBilling: true, sms })
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
