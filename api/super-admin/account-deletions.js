import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import Stripe from 'stripe'
import { verifySuperAdmin } from './_auth.js'
import { DELETION_COLLECTION } from '../_lib/account-deletion.js'
import { buildDeletionInventory } from '../_lib/account-deletion-inventory.js'
import { planDeletion, processDeletion, markDeletionCompleted } from '../_lib/account-deletion-operator.js'
import { requireStorageBucket } from '../_lib/require-config.js'

// Deletion queue for Super Admin. GET = queue / inventory (read-only).
// POST actions: preview (read-only plan), process (does the deletion and
// sends the confirmation email), mark_completed (records completion only,
// refused unless every processing step has evidence).
const QUEUE = ['requested', 'review_required', 'processing', 'processed']
const UID = /^[A-Za-z0-9_-]{1,128}$/

export async function sendResendEmail({ to, subject, text, idempotencyKey }) {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('Email is not configured')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: 'iDogs <noreply@idogs.com.au>', to: [to], subject, text }),
  })
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`)
}

export function makeAccountDeletionsHandler(deps) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store')
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const admin = await deps.verify(req, res)
    if (!admin) return
    try {
      const { db } = deps
      if (req.method === 'GET' && req.query?.environment === '1') {
        // Non-secret backend identity, so an operator can prove which systems a deletion will touch.
        const key = process.env.STRIPE_SECRET_KEY || ''
        return res.status(200).json({ environment: {
          vercelEnv: process.env.VERCEL_ENV || null,
          firebaseProject: process.env.FIREBASE_PROJECT_ID || null,
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET || null,
          stripeMode: key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'test' : key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : key ? 'unknown' : 'not_configured',
          emailConfigured: Boolean(process.env.RESEND_API_KEY),
        } })
      }
      if (req.method === 'GET') {
        const uid = req.query?.uid
        if (uid !== undefined && (typeof uid !== 'string' || !UID.test(uid))) return res.status(400).json({ error: 'Invalid account identifier' })
        if (!uid) {
          const snap = await db.collection(DELETION_COLLECTION).where('status', 'in', QUEUE).limit(100).get()
          return res.status(200).json({ requests: snap.docs.map(d => ({ uid: d.id, ...d.data() })), limit: 100 })
        }
        const request = await db.collection(DELETION_COLLECTION).doc(uid).get()
        if (!request.exists) return res.status(404).json({ error: 'Request not found' })
        return res.status(200).json({ request: request.data(), inventory: await buildDeletionInventory({ db, uid }) })
      }
      const { action, uid, confirmation } = req.body || {}
      if (typeof uid !== 'string' || !UID.test(uid)) return res.status(400).json({ error: 'Invalid account identifier' })
      const operator = admin.email
      if (action === 'preview') return res.status(200).json({ plan: await planDeletion({ db, uid }) })
      if (action === 'process') {
        const key = process.env.STRIPE_SECRET_KEY || ''
        if (process.env.VERCEL_ENV === 'preview' && /^(sk|rk)_live_/.test(key)) return res.status(409).json({ error: 'Preview is configured with live Stripe; refusing to process.' })
        if (confirmation !== `DELETE ${uid}`) return res.status(400).json({ error: 'Type the confirmation exactly to process this deletion.' })
        const result = await processDeletion({ db, auth: deps.auth, bucket: deps.bucket(), stripe: deps.stripe(), sendEmail: deps.sendEmail, uid, operator })
        return res.status(200).json(result)
      }
      if (action === 'mark_completed') return res.status(200).json(await markDeletionCompleted({ db, uid, operator }))
      return res.status(400).json({ error: 'Unknown action' })
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      return res.status(status).json({ error: status === 500 ? 'Deletion operation failed' : error.message,
        ...(error?.blockers ? { blockers: error.blockers } : {}), ...(error?.missing ? { missing: error.missing } : {}) })
    }
  }
}

let handlerInstance
export default async function handler(req, res) {
  if (!handlerInstance) {
    handlerInstance = makeAccountDeletionsHandler({
      verify: (rq, rs) => verifySuperAdmin(rq, rs),
      get db() { return getFirestore() },
      get auth() { return getAuth() },
      bucket: () => { const name = requireStorageBucket(); if (!name) throw Object.assign(new Error('Storage bucket is not configured.'), { status: 503 }); return getStorage().bucket(name) },
      stripe: () => process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null,
      sendEmail: sendResendEmail,
    })
  }
  return handlerInstance(req, res)
}
