import { withAccountMutationFence } from './_lib/deletion-fence.js'
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createSmsAddonRemoveHandler } from './_lib/sms-checkout-handler.js'

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

export default withAccountMutationFence(createSmsAddonRemoveHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  getProfile: async uid => {
    const snap = await db.collection('users').doc(uid).get()
    return snap.exists ? snap.data() : null
  },
  retrieveSubscription: id => stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] }),
  updateSubscription: (id, params) => stripe.subscriptions.update(id, params),
  cancelSubscription: (id, params) => stripe.subscriptions.cancel(id, params),
}), { route: 'api/remove-sms-addon.js' })
