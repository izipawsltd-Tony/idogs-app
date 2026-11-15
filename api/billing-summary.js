import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createBillingSummaryHandler } from './_lib/billing-handler.js'
import { reconcileVerifiedPaidSubscription, verifiedPaidInterval } from './_lib/billing-reconcile.js'

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

export default createBillingSummaryHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  getProfile: async uid => {
    const snap = await db.collection('users').doc(uid).get()
    return snap.exists ? snap.data() : null
  },
  retrieveSubscription: id => stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] }),
  listInvoices: params => stripe.invoices.list(params),
  isSmsConfigured: () => Boolean(process.env.STRIPE_SMS_ADDON_PRICE_ID),
  findReplacementSubscription: async ({ customerId, userId, excludeId }) => {
    const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20, expand: ['data.items.data.price'] })
    return (list.data || [])
      .filter(s => s.id !== excludeId && ['active', 'trialing'].includes(s.status) && s.metadata?.userId === userId && verifiedPaidInterval(s))
      .sort((a, b) => (b.created || 0) - (a.created || 0))[0] || null
  },
  reconcileVerifiedPlus: async ({ subscription, userId }) => {
    if (!verifiedPaidInterval(subscription)) return false
    return reconcileVerifiedPaidSubscription({ db, subscription, userId })
  },
})
