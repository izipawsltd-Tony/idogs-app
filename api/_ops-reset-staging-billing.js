import crypto from 'node:crypto'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const TARGET_EMAIL = 'idogsbreeder@gmail.com'
const TOKEN_SHA256 = '58a8922dc23e4a681ca8485666312bcd824fbfc567723b2d4d884c98a8df9c29'

function tokenOk(value) {
  const actual = crypto.createHash('sha256').update(String(value || '')).digest('hex')
  const a = Buffer.from(actual)
  const b = Buffer.from(TOKEN_SHA256)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (process.env.VERCEL_ENV !== 'preview' || process.env.FIREBASE_PROJECT_ID !== 'idogs-app-staging') {
    return res.status(404).json({ error: 'Not found' })
  }
  if (!tokenOk(req.query?.token)) return res.status(403).json({ error: 'Forbidden' })

  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }) })
  }

  const authUser = await getAuth().getUserByEmail(TARGET_EMAIL)
  const db = getFirestore()
  const ref = db.collection('users').doc(authUser.uid)
  const snap = await ref.get()
  if (!snap.exists) return res.status(404).json({ error: 'Profile not found' })
  const before = snap.data() || {}

  const deleteFields = [
    'stripeCustomerId','stripeSubscriptionId','trialEndsAt','planActivatedAt','pastDueSince',
    'billingInterval','scanPeriodAnchorDay','plusScansUsed','plusScansPeriodStart',
    'lastKnownSubscriptionId','subscriptionEventTimestamps','plusScansSubscriptionId',
    'smsAddonStatus','smsStripeSubscriptionId','smsStripePriceId','smsPeriodStart','smsPeriodEnd',
    'smsCreditsLimit','smsCreditsUsed','smsLastBillingEventAt'
  ]
  const update = {
    plan: 'free',
    subscriptionStatus: 'inactive',
    billingResetAt: new Date().toISOString(),
    billingResetReason: 'staging_qa_wrong_stripe_sandbox_mapping',
  }
  for (const field of deleteFields) update[field] = FieldValue.delete()
  await ref.update(update)

  const after = (await ref.get()).data() || {}
  const stale = ['stripeCustomerId','stripeSubscriptionId','smsStripeSubscriptionId','smsStripePriceId']
    .filter(field => Object.prototype.hasOwnProperty.call(after, field))
  if (after.plan !== 'free' || after.subscriptionStatus !== 'inactive' || stale.length) {
    return res.status(500).json({ error: 'Reset verification failed' })
  }
  if (before.email && before.email !== after.email) return res.status(500).json({ error: 'Unrelated field changed' })

  return res.status(200).json({ ok: true, plan: after.plan, subscriptionStatus: after.subscriptionStatus, staleBillingIdsPresent: false })
}
