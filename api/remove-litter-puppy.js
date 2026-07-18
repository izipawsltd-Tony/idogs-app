// api/remove-litter-puppy.js — trusted server-side puppy-unlink (Codex
// round 4, Blocker 3).
//
// WHY THIS EXISTS: round 3's handleDeletePuppy() (LittersPage.tsx)
// called updateLitter(litter.id, { puppyIds: filtered }) — a DIRECT
// client write to litters/{id}.puppyIds, exactly the "clients directly
// changing puppyIds" bypass Codex round 4, Blocker 3 calls out by name.
// This does NOT delete the Dog document — it only unlinks it from the
// litter (matches the existing "Remove this puppy from the litter?"
// UI copy), and requires CONFIRMED membership (dog.litterId === the
// litter being edited) before removing it, so a stale/wrong litterId
// can never unlink an unrelated dog's litter reference.
//
// POST /api/remove-litter-puppy
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, puppyId }
// Returns: { ok: true } | { error }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  let uid
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const { litterId, puppyId } = body
  if (!litterId || typeof litterId !== 'string') {
    return res.status(400).json({ error: 'litterId is required' })
  }
  if (!puppyId || typeof puppyId !== 'string') {
    return res.status(400).json({ error: 'puppyId is required' })
  }

  try {
    const db = getFirestore()
    const litterRef = db.collection('litters').doc(litterId)
    const dogRef = db.collection('dogs').doc(puppyId)

    const result = await db.runTransaction(async (tx) => {
      const litterSnap = await tx.get(litterRef)
      const dogSnap = await tx.get(dogRef)

      if (!litterSnap.exists) {
        return { ok: false, status: 404, body: { error: 'Litter not found' } }
      }
      const litter = litterSnap.data()
      if (litter.tenantId !== uid) {
        return { ok: false, status: 403, body: { error: 'Not your litter' } }
      }
      // Confirmed-membership check, mirroring litter-eligibility.js's
      // own definition — a dog's own litterId must explicitly agree,
      // never just the litter's forward puppyIds reference alone.
      if (dogSnap.exists && dogSnap.data().litterId !== litterId) {
        return { ok: false, status: 409, body: { error: 'This dog is not a confirmed member of this litter' } }
      }

      tx.update(litterRef, { puppyIds: FieldValue.arrayRemove(puppyId) })
      return { ok: true }
    })

    if (!result.ok) {
      return res.status(result.status).json(result.body)
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('remove-litter-puppy error:', err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
