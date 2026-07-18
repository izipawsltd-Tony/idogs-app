// api/create-litter.js — trusted server-side litter creation (Codex
// round 3, Blocker 1).
//
// WHY THIS EXISTS: firestore.rules can verify a Sire/Dam reference's
// ownership/sex/deceased/DOB-format, but has no date-arithmetic
// functions to compute an age from a DOB string — so "meets actual
// minimum breeding maturity" can't be enforced there. Per the explicit
// instruction to move any mutation Rules can't fully validate to a
// trusted server endpoint, litter creation now happens here: the Dam
// (and Sire, if an in-account dog was selected) are re-read fresh from
// Firestore via the Admin SDK and validated against the single canonical
// policy in _lib/parent-eligibility.js, never trusting anything the
// client submitted about them. firestore.rules denies direct client
// writes to litters/{id} create entirely — this endpoint is now the
// only path.
//
// POST /api/create-litter
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { name?, damId, sireId?, sireName?, matingSuspectedDate?,
//         expectedDueDate?, actualBirthDate?, notes? }
// Returns: { litterId } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { validateBreedingParent } from './_lib/parent-eligibility.js'

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
  const { name, damId, sireId, sireName, matingSuspectedDate, expectedDueDate, actualBirthDate, notes } = body

  if (!damId || typeof damId !== 'string') {
    return res.status(400).json({ error: 'damId is required' })
  }

  try {
    const db = getFirestore()

    const damSnap = await db.collection('dogs').doc(damId).get()
    const damCheck = validateBreedingParent(damSnap.exists ? damSnap.data() : null, { uid, requiredSex: 'female' })
    if (!damCheck.valid) {
      return res.status(400).json({ error: 'Dam is not an eligible breeding parent', reason: damCheck.reason })
    }

    const useInAccountSire = sireId && sireId !== '__external__'
    if (useInAccountSire) {
      const sireSnap = await db.collection('dogs').doc(sireId).get()
      const sireCheck = validateBreedingParent(sireSnap.exists ? sireSnap.data() : null, { uid, requiredSex: 'male' })
      if (!sireCheck.valid) {
        return res.status(400).json({ error: 'Sire is not an eligible breeding parent', reason: sireCheck.reason })
      }
    }

    const dam = damSnap.data()
    const litterRef = db.collection('litters').doc()
    await litterRef.set({
      tenantId: uid,
      name: (name && String(name).trim()) || `${dam.name} Litter`,
      damId,
      sireId: useInAccountSire ? sireId : null,
      sireName: sireId === '__external__' ? ((sireName && String(sireName).trim()) || null) : null,
      matingSuspectedDate: matingSuspectedDate || '',
      expectedDueDate: expectedDueDate || '',
      actualBirthDate: actualBirthDate || '',
      notes: notes || '',
      puppyIds: [],
      createdAt: new Date().toISOString(),
    })

    return res.status(200).json({ litterId: litterRef.id })
  } catch (err) {
    console.error('create-litter error:', err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
