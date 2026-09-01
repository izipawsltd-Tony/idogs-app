import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createExtraLitterCheckoutHandler } from './_lib/extra-litter-checkout-handler.js'
import { relatedTenantIdsForBreederTx } from './_lib/breeder-profile.js'
import {
  LITTER_INCLUDED_QUOTA,
  litterUsageWithinRollingWindow,
  listExtraLitterCreditsTx,
} from './_lib/litter-quota.js'

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

export default createExtraLitterCheckoutHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  getProfile: async uid => {
    const snap = await db.collection('users').doc(uid).get()
    return snap.exists ? snap.data() : null
  },
  retrieveSubscription: id => stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] }),
  getPurchaseEligibility: ({ uid, profile, authEmail }) => db.runTransaction(async tx => {
    const scope = await relatedTenantIdsForBreederTx(tx, db, { uid, profile, authEmail })
    const today = new Date().toISOString().slice(0, 10)
    const usage = await litterUsageWithinRollingWindow(tx, db, {
      breederProfileId: scope.breederProfileId,
      tenantIds: scope.tenantIds,
      newDate: today,
    })
    const credits = await listExtraLitterCreditsTx(tx, db, {
      breederProfileId: scope.breederProfileId,
      purchasedByUid: uid,
    })
    return {
      includedExhausted: usage.includedUsed >= LITTER_INCLUDED_QUOTA,
      availableCredits: credits.filter(credit => credit.status === 'available').length,
    }
  }),
  createSession: (params, options) => stripe.checkout.sessions.create(params, options),
})
