// api/stripe-webhook.js — Stripe webhook entrypoint. All entitlement
// logic lives in api/_lib/webhook-handler.js (testable without a live
// Stripe account); this file only wires up real Stripe/Firestore clients
// and the Vercel raw-body/req/res shape.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createWebhookHandler } from './_lib/webhook-handler.js'

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

const processWebhook = createWebhookHandler({
  constructEvent: (rawBody, sig) => stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET),
  getSubscription: subscriptionId => stripe.subscriptions.retrieve(subscriptionId),
  db: getFirestore(),
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const sig = req.headers['stripe-signature']
  const rawBody = await getRawBody(req)

  const result = await processWebhook(rawBody, sig)
  return res.status(result.status).json(result.body)
}
