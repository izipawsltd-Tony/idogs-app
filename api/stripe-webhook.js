// api/stripe-webhook.js — Stripe webhook entrypoint. All entitlement
// logic lives in api/_lib/webhook-handler.js (testable without a live
// Stripe account); this file wires up real Stripe/Firestore clients plus
// server-side Meta CAPI delivery for Stripe-confirmed paid invoices.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createWebhookHandler } from './_lib/webhook-handler.js'
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
  // Explicit expand — `items.data[].price` is not guaranteed present on a
  // bare subscriptions.retrieve() call across every Stripe API version;
  // resolveInterval() (webhook-handler.js) needs the real price id to
  // allowlist-check against CHECKOUT_PRICE_IDS.
  getSubscription,
  db,
})

const processMetaInvoice = createMetaInvoiceProcessor({
  db,
  getSubscription,
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const sig = req.headers['stripe-signature']
  const rawBody = await getRawBody(req)

  // Entitlements remain the primary Stripe webhook responsibility. This
  // call verifies the Stripe signature and keeps its existing idempotent,
  // fenced state machine unchanged.
  const result = await processWebhook(rawBody, sig)
  if (result.status !== 200) return res.status(result.status).json(result.body)

  // Reconstruct only after the trusted webhook handler accepted the same
  // signed payload. If Meta delivery fails, return 500 so Stripe retries.
  // The billing event may already be marked completed; that is safe: the
  // independent metaCapiEvents state retries CAPI while the billing path
  // no-ops, and the stable Meta event_id prevents duplicate counting if
  // Meta accepted a request just before a network failure.
  try {
    const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
    if (event.type === 'invoice.payment_succeeded') {
      await processMetaInvoice(event)
    }
  } catch (err) {
    console.error('stripe-webhook: meta capi delivery failed', { type: 'invoice.payment_succeeded' })
    return res.status(500).json({ error: 'Webhook downstream delivery failed' })
  }

  return res.status(result.status).json(result.body)
}
