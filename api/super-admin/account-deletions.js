import { getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from './_auth.js'
import { DELETION_COLLECTION, classifyDeletionDog } from '../_lib/account-deletion.js'

// Operational queue and conservative inventory, read-only. No "complete" switch
// that could claim success before the permanent processor has done its work.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!await verifySuperAdmin(req, res)) return
  try {
    const db = getFirestore()
    const uid = req.query.uid
    if (uid !== undefined && (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) return res.status(400).json({ error: 'Invalid account identifier' })
    if (!uid) {
      const snap = await db.collection(DELETION_COLLECTION).where('status', 'in', ['requested', 'review_required', 'processing']).limit(100).get()
      return res.status(200).json({ requests: snap.docs.map(d => ({ uid: d.id, ...d.data() })), limit: 100 })
    }
    const request = await db.collection(DELETION_COLLECTION).doc(uid).get()
    if (!request.exists) return res.status(404).json({ error: 'Request not found' })
    const [original, current, profile] = await Promise.all([
      db.collection('dogs').where('tenantId', '==', uid).limit(501).get(),
      db.collection('dogs').where('currentOwnerId', '==', uid).limit(501).get(),
      db.collection('users').doc(uid).get(),
    ])
    const dogs = [...new Map([...original.docs, ...current.docs].map(d => [d.id, d])).values()]
    const data = profile.data() || {}
    return res.status(200).json({ request: request.data(), inventory: {
      complete: false, reason: 'Full records/media inventory and write-freeze verification required before permanent processing.',
      dogQueryTruncated: original.size > 500 || current.size > 500,
      dogs: dogs.map(d => ({ id: d.id, disposition: classifyDeletionDog(d.data(), uid) })),
      billingReviewRequired: !!(data.stripeCustomerId || data.stripeSubscriptionId || data.smsStripeSubscriptionId || data.subscriptionStatus === 'active'),
    } })
  } catch { return res.status(500).json({ error: 'Could not load deletion queue' }) }
}
