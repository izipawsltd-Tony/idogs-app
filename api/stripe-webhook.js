import { withAccountMutationFence } from './_lib/deletion-fence.js'
// api/stripe-webhook.js — Stripe webhook entrypoint. All subscription
// entitlement logic lives in api/_lib/webhook-handler.js; one-time Extra
// Litter credit grants are verified/idempotent in extra-litter-webhook.js.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createWebhookHandler } from './_lib/webhook-handler.js'
import { grantExtraLitterCreditFromVerifiedEvent } from './_lib/extra-litter-webhook.js'

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

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const sig = req.headers['stripe-signature']
  const rawBody = await getRawBody(req)

  let verifiedEvent = null
  try {
    verifiedEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch {
    // The core handler owns the canonical 400 response for invalid signatures.
  }

  const result = await processWebhook(rawBody, sig)
  if (result.status === 200 && verifiedEvent) {
    try {
      // No-op for every event except a fully-paid, server-created
      // Extra Litter Checkout session. Deterministic session-id document
      // makes Stripe redelivery safe and prevents double-credit.
      await grantExtraLitterCreditFromVerifiedEvent({ db, event: verifiedEvent })
    } catch (error) {
      console.error('stripe-webhook: verified post-processing failed', { code: error?.message || 'POST_PROCESSING_FAILED' })
      // Return 500 so Stripe retries. Extra-litter grants are idempotent,
      // and subscription effects remain in the fenced core handler.
      return res.status(500).json({ error: 'Webhook entitlement post-processing failed' })
    }
  }
  return res.status(result.status).json(result.body)
}

export default withAccountMutationFence(handler, { route: 'api/stripe-webhook.js' })
