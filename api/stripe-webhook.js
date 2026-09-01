// api/stripe-webhook.js — Stripe webhook entrypoint. Subscription
// entitlement logic lives in api/_lib/webhook-handler.js. This entrypoint
// also grants verified Extra Litter credits and preserves Meta Purchase CAPI.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createWebhookHandler } from './_lib/webhook-handler.js'
import { grantExtraLitterCreditFromVerifiedEvent } from './_lib/extra-litter-webhook.js'
import { reconcileVerifiedPlusSubscription, verifiedPlusInterval } from './_lib/billing-reconcile.js'
import { createMetaInvoiceProcessor } from './_lib/meta-capi.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export const config = { api: { bodyParser: false } }

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const db = getFirestore()
const getSubscription = subscriptionId => stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })

const processWebhook = createWebhookHandler({
  constructEvent: (rawBody, sig) => stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET),
  getSubscription,
  db,
})
const processMetaInvoice = createMetaInvoiceProcessor({ db, getSubscription })

function subscriptionIdFromVerifiedEvent(event) {
  const object = event?.data?.object
  if (!object) return null
  if (event.type === 'checkout.session.completed') {
    return typeof object.subscription === 'string' ? object.subscription : object.subscription?.id || null
  }
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    return object.id || null
  }
  if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
    const legacy = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id
    if (legacy) return legacy
    const current = object.parent?.subscription_details?.subscription
    return typeof current === 'string' ? current : current?.id || null
  }
  return null
}

async function reconcileActivePlusFromVerifiedEvent(event) {
  const subscriptionId = subscriptionIdFromVerifiedEvent(event)
  if (!subscriptionId) return
  const subscription = event.type.startsWith('customer.subscription.')
    ? event.data.object
    : await getSubscription(subscriptionId)
  if (!verifiedPlusInterval(subscription)) return
  const userId = subscription?.metadata?.userId
  if (!userId) return
  await reconcileVerifiedPlusSubscription({ db, subscription, userId, eventCreated: event.created })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const sig = req.headers['stripe-signature']
  const rawBody = await getRawBody(req)

  let verifiedEvent = null
  try {
    verifiedEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch {
    // Core handler owns the canonical invalid-signature response.
  }

  const result = await processWebhook(rawBody, sig)
  if (result.status !== 200 || !verifiedEvent) return res.status(result.status).json(result.body)

  try {
    await grantExtraLitterCreditFromVerifiedEvent({ db, event: verifiedEvent })
    await reconcileActivePlusFromVerifiedEvent(verifiedEvent)

    if (verifiedEvent.type === 'invoice.payment_succeeded') {
      const metaResult = await processMetaInvoice(verifiedEvent)
      console.log('stripe-webhook: meta capi result', {
        type: verifiedEvent.type,
        sent: Boolean(metaResult?.sent),
        skipped: Boolean(metaResult?.skipped),
        reason: metaResult?.reason || null,
        eventName: metaResult?.eventName || null,
      })
    }
  } catch (error) {
    console.error('stripe-webhook: verified downstream processing failed', {
      code: error?.message || 'POST_PROCESSING_FAILED',
    })
    return res.status(500).json({ error: 'Webhook downstream processing failed' })
  }

  return res.status(result.status).json(result.body)
}
