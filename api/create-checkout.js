// api/create-checkout.js — Authenticated Stripe Checkout session creation.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createCheckoutHandler } from './_lib/checkout-handler.js'
import { promotionSessionStore } from './_lib/promotion-session.js'
import { promotionEnvironment } from './_lib/promotion-environment.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const promotionConfig = promotionEnvironment({ environment: process.env.VERCEL_ENV, projectId: process.env.VERCEL_PROJECT_ID,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  testKey: /^(?:sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || ''),
  liveKey: /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || ''),
})

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
  ...(promotionConfig.prices ? { checkoutPriceIds: promotionConfig.prices } : {}),
  promotionCheckoutEnabled: promotionConfig.enabled,
  verifyIdToken: token => getAuth().verifyIdToken(token),
  createSession: (params, options) => stripe.checkout.sessions.create(params, options),
  canReusePromotionCustomer: async customerId => {
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    return !subscriptions.has_more && subscriptions.data.every(subscription => ['canceled', 'incomplete_expired'].includes(subscription.status))
  },
  getProfile: async uid => {
    const snapshot = await getFirestore().collection('users').doc(uid).get()
    return snapshot.exists ? snapshot.data() : null
  },
})
