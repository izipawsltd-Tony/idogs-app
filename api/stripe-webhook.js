import { withAccountMutationFence } from './_lib/deletion-fence.js'
// api/stripe-webhook.js — Stripe webhook entrypoint. All subscription
// entitlement logic lives in api/_lib/webhook-handler.js; one-time Extra
// Litter credit grants are verified/idempotent in extra-litter-webhook.js.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createWebhookHandler } from './_lib/webhook-handler.js'
import { grantExtraLitterCreditFromVerifiedEvent } from './_lib/extra-litter-webhook.js'
import { prepareEmulatorVerifiedStripeEvent } from './_lib/deletion-stripe-ingress.js'

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
const getSubscription = subscriptionId => stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price', 'latest_invoice'] })

const processWebhook = createWebhookHandler({
  constructEvent: (rawBody, sig) => stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET),
  getSubscription,
  cancelSubscription: (id, params) => stripe.subscriptions.cancel(id, params),
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

  if(process.env.ACCOUNT_DELETION_MODE==='prototype-emulator'&&verifiedEvent){
    try{
      const [{getAuth},{getStorage}]=await Promise.all([import('firebase-admin/auth'),import('firebase-admin/storage')])
      const auth=getAuth(),projectId=auth.app.options.projectId
      // Never borrow the normal provider client for a prototype invocation.
      const privateTransportRequired=async()=>{throw Object.assign(new Error('WEBHOOK_PRIVATE_TEST_TRANSPORT_REQUIRED'),{code:'WEBHOOK_PRIVATE_TEST_TRANSPORT_REQUIRED',status:423})}
      const scope=await prepareEmulatorVerifiedStripeEvent({db,auth,projectId,bucket:getStorage().bucket(`${projectId}.firebasestorage.app`),rawBody,signature:sig,
        verifyEvent:(body,signature)=>stripe.webhooks.constructEvent(body,signature,process.env.STRIPE_WEBHOOK_SECRET),getSubscription:privateTransportRequired,
        cancelSubscription:privateTransportRequired,executionEnabled:true})
      const guarded=createWebhookHandler({db:scope.db,constructEvent:scope.constructEvent,getSubscription:scope.getSubscription,cancelSubscription:scope.cancelSubscription})
      const result=await guarded(rawBody,sig)
      if(result.status===200)await grantExtraLitterCreditFromVerifiedEvent({db:scope.db,event:scope.event})
      return res.status(result.status).json(result.body)
    }catch(error){return res.status(error.status===423?423:503).json({error:'Verified webhook safety checks held processing',code:error.code||'WEBHOOK_INGRESS_HELD'})}
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
