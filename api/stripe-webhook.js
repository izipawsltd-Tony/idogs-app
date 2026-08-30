// api/stripe-webhook.js — Stripe webhook entrypoint. Entitlement logic lives
// in api/_lib/webhook-handler.js; this file also wires Stripe-confirmed paid
// invoices to Meta Conversions API.
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
  getSubscription,
  db,
})

const processMetaInvoice = createMetaInvoiceProcessor({ db, getSubscription })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const sig = req.headers['stripe-signature']
  const rawBody = await getRawBody(req)

  const result = await processWebhook(rawBody, sig)
  if (result.status !== 200) return res.status(result.status).json(result.body)

  try {
    const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
    if (event.type === 'invoice.payment_succeeded') {
      const metaResult = await processMetaInvoice(event)
      console.log('stripe-webhook: meta capi result', {
        type: event.type,
        sent: Boolean(metaResult?.sent),
        skipped: Boolean(metaResult?.skipped),
        reason: metaResult?.reason || null,
        eventName: metaResult?.eventName || null,
      })
    }
  } catch {
    console.error('stripe-webhook: meta capi delivery failed', { type: 'invoice.payment_succeeded' })
    return res.status(500).json({ error: 'Webhook downstream delivery failed' })
  }

  return res.status(result.status).json(result.body)
}
