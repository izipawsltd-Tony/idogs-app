// api/create-checkout.js — Authenticated Stripe Checkout session creation.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { createCheckoutHandler } from './_lib/checkout-handler.js'

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

export default createCheckoutHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  createSession: params => stripe.checkout.sessions.create(params),
})
