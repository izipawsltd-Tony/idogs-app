import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createSmsAddonCheckoutHandler } from './_lib/sms-checkout-handler.js'

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

export default createSmsAddonCheckoutHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  getProfile: async uid => {
    const snap = await db.collection('users').doc(uid).get()
    return snap.exists ? snap.data() : null
  },
  createSession: params => stripe.checkout.sessions.create(params),
})
