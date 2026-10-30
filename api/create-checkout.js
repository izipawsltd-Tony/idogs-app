import { verifyAccountToken } from './_lib/account-onboarding.js'
// api/create-checkout.js — Authenticated Stripe Checkout session creation.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createCheckoutHandler } from './_lib/checkout-handler.js'
import { promotionSessionStore } from './_lib/promotion-session.js'
import { promotionEnvironment, checkoutReturnOrigin } from './_lib/promotion-environment.js'
import { promotionTaxReady } from './_lib/promotion-tax.js'
import { requireAppUrl } from './_lib/require-config.js'

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
  getAppUrl: req => checkoutReturnOrigin({ appUrl: requireAppUrl(), config: promotionConfig,
    vercelUrl: process.env.VERCEL_URL, requestOrigin: req.headers?.origin }),
  ...promotionSessionStore(getFirestore()),
  ...(promotionConfig.prices ? { checkoutPriceIds: promotionConfig.prices } : {}),
  promotionCheckoutEnabled: promotionConfig.enabled,
  getPromotionTaxStatus: (priceId, customerId) => promotionTaxReady(stripe, priceId, /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || ''), customerId),
  verifyIdToken: token => verifyAccountToken(token),
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
