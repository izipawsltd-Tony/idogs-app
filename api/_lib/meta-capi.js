// api/_lib/meta-capi.js — server-side Meta Conversions API delivery for
// Stripe-confirmed iDogs revenue events.
import { createHash } from 'node:crypto'
import { CHECKOUT_PRICE_IDS } from './checkout-handler.js'

export const META_DATASET_ID = '1648101183992434'
export const META_GRAPH_API_VERSION = 'v26.0'
const CLAIM_STALE_MS = 60 * 1000

function sha256(value) {
  return createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex')
}

function subscriptionIdOf(invoice) {
  const direct = invoice?.subscription
  if (typeof direct === 'string') return direct
  if (direct?.id) return direct.id
  const parent = invoice?.parent?.subscription_details?.subscription
  if (typeof parent === 'string') return parent
  if (parent?.id) return parent.id
  return null
}

function idOf(value) {
  if (typeof value === 'string') return value
  if (value && typeof value.id === 'string') return value.id
  return null
}

function linePriceId(line) {
  return idOf(line?.pricing?.price_details?.price) || idOf(line?.price) || idOf(line?.plan) || null
}

function positivePriceIds(invoice) {
  return (invoice?.lines?.data || [])
    .filter(line => Number(line?.amount) > 0)
    .map(linePriceId)
    .filter(Boolean)
}

function extractUserId(subscription, invoice) {
  const candidates = [
    subscription?.metadata?.userId,
    invoice?.subscription_details?.metadata?.userId,
    invoice?.parent?.subscription_details?.metadata?.userId,
  ]
  return candidates.find(value => typeof value === 'string' && value.length > 0) || null
}

function invoiceEmail(invoice) {
  const candidates = [invoice?.customer_email, invoice?.customer?.email]
  return candidates.find(value => typeof value === 'string' && value.trim().length > 0) || null
}

export function classifyPaidInvoice(invoice, {
  smsPriceId = process.env.STRIPE_SMS_ADDON_PRICE_ID,
  plusPriceIds = Object.values(CHECKOUT_PRICE_IDS),
} = {}) {
  if (!invoice || Number(invoice.amount_paid) <= 0) return null
  const currency = String(invoice.currency || '').toUpperCase()
  if (!currency) return null
  const priceIds = positivePriceIds(invoice)
  const hasPlus = priceIds.some(id => plusPriceIds.includes(id))
  const hasSms = Boolean(smsPriceId && priceIds.includes(smsPriceId))

  // Purchase is acquisition only: initial paid Plus subscription. Renewals and
  // failed/zero-dollar invoices must never inflate Meta purchase conversions.
  if (invoice.billing_reason === 'subscription_create' && hasPlus) {
    return {
      eventName: 'Purchase',
      kind: hasSms ? 'plus_with_sms_initial' : 'plus_initial',
      value: Number(invoice.amount_paid) / 100,
      currency,
    }
  }

  // Keep SMS revenue separately classified so it cannot be mistaken for a
  // new Plus acquisition by the Sales campaign.
  if (invoice.billing_reason === 'subscription_update' && hasSms) {
    return {
      eventName: 'SmsAddonPurchase',
      kind: 'sms_addon_existing_plus',
      value: Number(invoice.amount_paid) / 100,
      currency,
    }
  }
  return null
}

export function buildMetaServerEvent({ stripeEvent, invoice, subscription, classification }) {
  const userId = extractUserId(subscription, invoice)
  if (!userId) throw new Error('META_CAPI_USER_ID_MISSING')
  const paidAt = invoice?.status_transitions?.paid_at
  const eventTime = Number.isFinite(paidAt) ? paidAt : stripeEvent.created
  if (!Number.isFinite(eventTime)) throw new Error('META_CAPI_EVENT_TIME_MISSING')

  const isStagingPreview = process.env.FIREBASE_PROJECT_ID === 'idogs-app-staging' && process.env.VERCEL_ENV === 'preview'
  const previewSource = isStagingPreview && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null
  const email = invoiceEmail(invoice)
  const userData = { external_id: [sha256(userId)] }
  if (email) userData.em = [sha256(email)]

  return {
    event_name: classification.eventName,
    event_time: eventTime,
    event_id: `idogs:${invoice.id}:${classification.eventName}`,
    action_source: 'website',
    event_source_url: previewSource || 'https://idogs.com.au/',
    user_data: userData,
    custom_data: { currency: classification.currency, value: classification.value },
  }
}

export function createMetaHttpSender({
  accessToken = process.env.META_CAPI_ACCESS_TOKEN,
  datasetId = process.env.META_DATASET_ID || META_DATASET_ID,
  apiVersion = process.env.META_GRAPH_API_VERSION || META_GRAPH_API_VERSION,
  testEventCode = process.env.META_CAPI_TEST_EVENT_CODE || undefined,
  fetchImpl = globalThis.fetch,
} = {}) {
  const enabled = Boolean(accessToken && datasetId && fetchImpl)

  async function send(serverEvent) {
    if (!enabled) return { skipped: true, reason: 'META_CAPI_NOT_CONFIGURED' }
    const url = `https://graph.facebook.com/${apiVersion}/${datasetId}/events?access_token=${encodeURIComponent(accessToken)}`
    const body = { data: [serverEvent] }
    if (testEventCode) body.test_event_code = testEventCode

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    let payload = null
    try { payload = await response.json() } catch { }
    if (!response.ok || (payload?.events_received !== undefined && payload.events_received < 1)) {
      throw new Error(`META_CAPI_DELIVERY_FAILED_${response.status}`)
    }
    return { skipped: false, payload }
  }

  return { enabled, send }
}

export function createMetaInvoiceProcessor({
  db,
  getSubscription,
  sender = createMetaHttpSender(),
  getSmsPriceId = () => process.env.STRIPE_SMS_ADDON_PRICE_ID,
  now = () => new Date(),
} = {}) {
  if (!db || typeof getSubscription !== 'function') throw new Error('META_CAPI_PROCESSOR_CONFIG_INVALID')

  return async function processMetaInvoice(stripeEvent) {
    if (stripeEvent?.type !== 'invoice.payment_succeeded') return { skipped: true, reason: 'NOT_PAID_INVOICE' }
    if (!sender.enabled) return { skipped: true, reason: 'META_CAPI_NOT_CONFIGURED' }

    const invoice = stripeEvent.data?.object
    const classification = classifyPaidInvoice(invoice, { smsPriceId: getSmsPriceId() })
    if (!classification) return { skipped: true, reason: 'NOT_TRACKED_REVENUE_EVENT' }

    const subscriptionId = subscriptionIdOf(invoice)
    if (!subscriptionId) throw new Error('META_CAPI_SUBSCRIPTION_MISSING')
    const subscription = await getSubscription(subscriptionId)
    const serverEvent = buildMetaServerEvent({ stripeEvent, invoice, subscription, classification })
    const ref = db.collection('metaCapiEvents').doc(serverEvent.event_id)

    const claim = await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      if (snap.exists) {
        const data = snap.data()
        if (data.status === 'completed') return { claimed: false, completed: true }
        if (data.status === 'pending') {
          const claimedAtMs = new Date(data.claimedAt).getTime()
          const stale = Number.isFinite(claimedAtMs) && now().getTime() - claimedAtMs > CLAIM_STALE_MS
          if (!stale) return { claimed: false, completed: false }
        }
      }

      tx.set(ref, {
        status: 'pending',
        eventName: classification.eventName,
        kind: classification.kind,
        invoiceId: invoice.id,
        stripeEventId: stripeEvent.id,
        value: classification.value,
        currency: classification.currency,
        claimedAt: now().toISOString(),
        attempts: (snap.exists ? (snap.data().attempts || 0) : 0) + 1,
      }, { merge: true })
      return { claimed: true }
    })

    if (!claim.claimed) return { skipped: true, reason: claim.completed ? 'ALREADY_SENT' : 'IN_FLIGHT' }

    try {
      const result = await sender.send(serverEvent)
      await ref.set({ status: 'completed', completedAt: now().toISOString() }, { merge: true })
      return { sent: true, eventName: classification.eventName, eventId: serverEvent.event_id, result }
    } catch (err) {
      await ref.set({ status: 'failed', failedAt: now().toISOString() }, { merge: true })
      throw err
    }
  }
}
