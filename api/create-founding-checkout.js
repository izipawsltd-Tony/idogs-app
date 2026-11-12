// api/create-founding-checkout.js — authenticated one-off Founding Member
// Checkout. Logic and safety gates live in _lib/founding-checkout-handler.js.
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createFoundingCheckoutHandler } from './_lib/founding-checkout-handler.js'
import { ACCESS_GRANT_COUNTERS, counterCount } from './_lib/access-grant-store.js'
import { CHECKOUT_PRICE_IDS } from './_lib/checkout-handler.js'
import { promotionEnvironment, checkoutReturnOrigin } from './_lib/promotion-environment.js'
import { requireAppUrl } from './_lib/require-config.js'
import { FOUNDING_OFFER, LAUNCH_OFFER } from '../shared/access-grants.js'
import { launchOfferState } from './_lib/launch-offer-handler.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const envConfig = promotionEnvironment({ environment: process.env.VERCEL_ENV, projectId: process.env.VERCEL_PROJECT_ID,
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

const db = getFirestore()
const plusMonthlyPriceId = (envConfig.prices || CHECKOUT_PRICE_IDS).plus_monthly

export default createFoundingCheckoutHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  getAppUrl: req => checkoutReturnOrigin({ appUrl: requireAppUrl(), config: envConfig,
    vercelUrl: process.env.VERCEL_URL, requestOrigin: req.headers?.origin }),
  getProfile: async uid => {
    const snap = await db.collection('users').doc(uid).get()
    return snap.exists ? snap.data() : null
  },
  isLaunchActive: async () => process.env.LAUNCH_OFFER_ENABLED === 'true' &&
    launchOfferState({ claimed: counterCount(await db.collection(ACCESS_GRANT_COUNTERS).doc(LAUNCH_OFFER.id).get()), nowMs: Date.now() }).active,
  getSeatsSold: async () => counterCount(await db.collection(ACCESS_GRANT_COUNTERS).doc(FOUNDING_OFFER.id).get()),
  getTaxProductId: async () => {
    const price = await stripe.prices.retrieve(plusMonthlyPriceId)
    return typeof price?.product === 'string' ? price.product : price?.product?.id
  },
  createSession: (params, options) => stripe.checkout.sessions.create(params, options),
})
