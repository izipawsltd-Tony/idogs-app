import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createSmsWebhookHandler } from './_lib/sms-webhook-handler.js'

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
async function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const processSmsWebhook = createSmsWebhookHandler({
  constructEvent: (body, sig) => stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_SMS_WEBHOOK_SECRET),
  getSubscription: id => stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] }),
  db: getFirestore(),
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const result = await processSmsWebhook(await rawBody(req), req.headers['stripe-signature'])
  return res.status(result.status).json(result.body)
}
