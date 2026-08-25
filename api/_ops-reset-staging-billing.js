import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const TARGET_EMAIL = 'idogsbreeder@gmail.com'
const CONFIRM = 'staging-idogsbreeder-reset-20260826'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (process.env.VERCEL_ENV !== 'preview' || process.env.FIREBASE_PROJECT_ID !== 'idogs-app-staging') return res.status(404).json({ error: 'Not found' })
  if (req.headers['x-reset-confirm'] !== CONFIRM) return res.status(403).json({ error: 'Forbidden' })

  if (!getApps().length) initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }) })

  const authUser = await getAuth().getUserByEmail(TARGET_EMAIL)
  const ref = getFirestore().collection('users').doc(authUser.uid)
  const snap = await ref.get()
  if (!snap.exists) return res.status(404).json({ error: 'Profile not found' })
  const before = snap.data() || {}
  const staleNow = ['stripeCustomerId','stripeSubscriptionId','smsStripeSubscriptionId','smsStripePriceId']
    .some(field => Object.prototype.hasOwnProperty.call(before, field))
  if (!staleNow && before.plan === 'free' && before.subscriptionStatus === 'inactive') {
    return res.status(200).json({ ok: true, alreadyReset: true, plan: 'free', subscriptionStatus: 'inactive', staleBillingIdsPresent: false })
  }

  const deleteFields = [
    'stripeCustomerId','stripeSubscriptionId','trialEndsAt','planActivatedAt','pastDueSince','billingInterval',
    'scanPeriodAnchorDay','plusScansUsed','plusScansPeriodStart','lastKnownSubscriptionId',
    'subscriptionEventTimestamps','plusScansSubscriptionId','smsAddonStatus','smsStripeSubscriptionId',
    'smsStripePriceId','smsPeriodStart','smsPeriodEnd','smsCreditsLimit','smsCreditsUsed','smsLastBillingEventAt'
  ]
  const update = { plan: 'free', subscriptionStatus: 'inactive', billingResetAt: new Date().toISOString(), billingResetReason: 'staging_qa_wrong_stripe_sandbox_mapping' }
  for (const field of deleteFields) update[field] = FieldValue.delete()
  await ref.update(update)

  const after = (await ref.get()).data() || {}
  const stale = ['stripeCustomerId','stripeSubscriptionId','smsStripeSubscriptionId','smsStripePriceId']
    .filter(field => Object.prototype.hasOwnProperty.call(after, field))
  if (after.plan !== 'free' || after.subscriptionStatus !== 'inactive' || stale.length) return res.status(500).json({ error: 'Reset verification failed' })
  if (before.email && before.email !== after.email) return res.status(500).json({ error: 'Unrelated field changed' })
  return res.status(200).json({ ok: true, alreadyReset: false, plan: after.plan, subscriptionStatus: after.subscriptionStatus, staleBillingIdsPresent: false })
}
