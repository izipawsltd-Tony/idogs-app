import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { reconcileVerifiedPlusSubscription, verifiedPlusInterval } from './_lib/billing-reconcile.js'

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
const EMAIL = 'idogspetowner@gmail.com'
const SUBSCRIPTION_ID = 'sub_1UAN6VGHgBd6ZgJEe08VQQ9h'
const EXPECTED_PROJECT_ID = 'prj_UsnGhC1BWtYnmF5rKMYBR9KWkbIo'
const REPAIR_NONCE = 'approved-plus-repair-20260831'

function safeProfile(data = {}) {
  return {
    plan: data.plan || null,
    subscriptionStatus: data.subscriptionStatus || null,
    stripeCustomerId: data.stripeCustomerId || null,
    stripeSubscriptionId: data.stripeSubscriptionId || null,
    lastKnownSubscriptionId: data.lastKnownSubscriptionId || null,
    billingInterval: data.billingInterval || null,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_PROJECT_ID !== EXPECTED_PROJECT_ID || process.env.FIREBASE_PROJECT_ID !== 'idogs-app') {
    return res.status(403).json({ error: 'QA repair is Preview-only and production-project scoped' })
  }

  try {
    const authUser = await getAuth().getUserByEmail(EMAIL)
    const uid = authUser.uid
    const subscription = await stripe.subscriptions.retrieve(SUBSCRIPTION_ID, { expand: ['items.data.price', 'customer'] })
    const interval = verifiedPlusInterval(subscription)
    const customerEmail = typeof subscription.customer === 'object' ? subscription.customer?.email : null
    const guards = {
      uidMatchesMetadata: subscription?.metadata?.userId === uid,
      customerEmailMatches: customerEmail === EMAIL,
      activeVerifiedPlus: Boolean(interval),
      subscriptionIdMatches: subscription?.id === SUBSCRIPTION_ID,
    }
    if (!Object.values(guards).every(Boolean)) return res.status(409).json({ error: 'Repair guards failed', guards })

    const ref = db.collection('users').doc(uid)
    const beforeSnap = await ref.get()
    const before = safeProfile(beforeSnap.exists ? beforeSnap.data() : {})
    const shouldRepair = req.query?.repair === REPAIR_NONCE

    if (shouldRepair) {
      await reconcileVerifiedPlusSubscription({ db, subscription, userId: uid })
    }

    const afterSnap = await ref.get()
    return res.status(200).json({
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
      email: EMAIL,
      uid,
      subscriptionId: SUBSCRIPTION_ID,
      guards,
      before,
      after: safeProfile(afterSnap.exists ? afterSnap.data() : {}),
      repaired: shouldRepair,
    })
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'QA_REPAIR_FAILED' })
  }
}
