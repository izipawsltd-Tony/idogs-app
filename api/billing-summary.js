import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createBillingSummaryHandler } from './_lib/billing-handler.js'
import { reconcileVerifiedPlusSubscription, verifiedPlusInterval } from './_lib/billing-reconcile.js'
import { logSanitizedError } from './_lib/http-helpers.js'

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

const db = getFirestore()

function logBillingStageFailure(stage, error) {
  logSanitizedError('billing-summary', `BILLING_SUMMARY_${stage}_FAILED`, {
    message: error?.message,
    code: error?.code || error?.type,
  })
}

export default createBillingSummaryHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  getProfile: async uid => {
    const snap = await db.collection('users').doc(uid).get()
    return snap.exists ? snap.data() : null
  },
  retrieveSubscription: async id => {
    try {
      return await stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] })
    } catch (error) {
      logBillingStageFailure('SUBSCRIPTION_RETRIEVE', error)
      throw error
    }
  },
  listInvoices: async params => {
    try {
      return await stripe.invoices.list(params)
    } catch (error) {
      logBillingStageFailure('INVOICE_LIST', error)
      throw error
    }
  },
  isSmsConfigured: () => Boolean(process.env.STRIPE_SMS_ADDON_PRICE_ID),
  getSmsPriceId: () => process.env.STRIPE_SMS_ADDON_PRICE_ID || null,
  reconcileVerifiedPlus: async ({ subscription, userId }) => {
    if (!verifiedPlusInterval(subscription)) return false
    try {
      return await reconcileVerifiedPlusSubscription({ db, subscription, userId })
    } catch (error) {
      logBillingStageFailure('PLUS_RECONCILE', error)
      throw error
    }
  },
})
