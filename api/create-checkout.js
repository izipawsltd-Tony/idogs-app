// api/create-checkout.js — Authenticated Stripe Checkout session creation.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createCheckoutHandler } from './_lib/checkout-handler.js'
import { promotionSessionStore } from './_lib/promotion-session.js'

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
  ...promotionSessionStore(getFirestore()),
  verifyIdToken: token => getAuth().verifyIdToken(token),
  createSession: (params, options) => stripe.checkout.sessions.create(params, options),
  getProfile: async uid => {
    const snapshot = await getFirestore().collection('users').doc(uid).get()
    return snapshot.exists ? snapshot.data() : null
  },
})
