import crypto from 'node:crypto'
import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { verifiedPlusInterval } from './_lib/billing-reconcile.js'

const STAGING_PROJECT_ID = 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o'
const ALLOWED = new Map([
  ['edb3deb42b3a310b28c1c5741b7a85b360997ae1f3c3907cbfe19484d168c8a5', 'petowner'],
  ['8d0cf092cff34afc9eaef1293719519ef9d8d0f836f5e4ac666949110d373fc4', 'breeder'],
])

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const auth = getAuth()
const db = getFirestore()

function fail(stage, error) {
  return {
    stage,
    ok: false,
    code: typeof error?.code === 'string' ? error.code : 'unknown',
    type: typeof error?.type === 'string' ? error.type : (error?.name || 'unknown'),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_PROJECT_ID !== STAGING_PROJECT_ID) {
    return res.status(404).json({ error: 'Not found' })
  }

  const email = typeof req.query?.email === 'string' ? req.query.email.trim().toLowerCase() : ''
  const digest = crypto.createHash('sha256').update(email).digest('hex')
  const label = ALLOWED.get(digest)
  if (!label) return res.status(404).json({ error: 'Not found' })

  try {
    const user = await auth.getUserByEmail(email)
    const snap = await db.collection('users').doc(user.uid).get()
    const profile = snap.exists ? snap.data() : null
    if (!profile) return res.status(200).json({ label, authUserFound: true, profileFound: false })

    const customerId = typeof profile.stripeCustomerId === 'string' ? profile.stripeCustomerId : ''
    const subscriptionId = typeof profile.stripeSubscriptionId === 'string' ? profile.stripeSubscriptionId : ''
    const result = {
      label,
      authUserFound: true,
      profileFound: true,
      profile: {
        plan: profile.plan || null,
        subscriptionStatus: profile.subscriptionStatus || null,
        billingInterval: profile.billingInterval || null,
        smsAddonStatus: profile.smsAddonStatus || null,
        hasCustomerId: Boolean(customerId),
        hasSubscriptionId: Boolean(subscriptionId),
      },
      customer: { attempted: Boolean(customerId) },
      subscription: { attempted: Boolean(subscriptionId) },
      invoices: { attempted: Boolean(customerId) },
    }

    if (customerId) {
      try {
        const customer = await stripe.customers.retrieve(customerId)
        result.customer = {
          attempted: true,
          ok: true,
          deleted: customer?.deleted === true,
          livemode: customer?.livemode === true ? 'LIVE' : customer?.livemode === false ? 'TEST' : 'UNKNOWN',
        }
      } catch (error) {
        result.customer = { attempted: true, ...fail('CUSTOMER_RETRIEVE', error) }
      }
    }

    if (subscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] })
        const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id
        result.subscription = {
          attempted: true,
          ok: true,
          status: subscription.status || null,
          livemode: subscription.livemode === true ? 'LIVE' : subscription.livemode === false ? 'TEST' : 'UNKNOWN',
          customerMatch: Boolean(customerId) && stripeCustomerId === customerId,
          metadataUserMatch: subscription?.metadata?.userId === user.uid,
          verifiedPlusInterval: verifiedPlusInterval(subscription) || null,
          smsItemPresent: Boolean(process.env.STRIPE_SMS_ADDON_PRICE_ID) && (subscription.items?.data || []).some(item => item?.price?.id === process.env.STRIPE_SMS_ADDON_PRICE_ID),
        }
      } catch (error) {
        result.subscription = { attempted: true, ...fail('SUBSCRIPTION_RETRIEVE', error) }
      }
    }

    if (customerId) {
      try {
        const invoices = await stripe.invoices.list({ customer: customerId, limit: 3 })
        result.invoices = { attempted: true, ok: true, count: Array.isArray(invoices?.data) ? invoices.data.length : 0 }
      } catch (error) {
        result.invoices = { attempted: true, ...fail('INVOICE_LIST', error) }
      }
    }

    return res.status(200).json(result)
  } catch (error) {
    return res.status(200).json({ label, ...fail('AUTH_OR_PROFILE_READ', error) })
  }
}
