// api/delete-litter.js — trusted server-side litter deletion (Codex
// round 4, Blocker 3).
//
// WHY THIS EXISTS: round 3 implemented safe litter deletion as a CLIENT
// Firestore transaction (LittersPage.tsx's handleDeleteLitter), relying
// on firestore.rules' litters.delete rule (tenantId ownership only) plus
// the app's own client-side logic to decide which puppies to delete
// alongside it. Codex round 4 flagged that this rule has no way to
// verify puppy handling actually happened — a plain deleteDoc() call
// (bypassing the app's own transaction logic entirely, e.g. from
// browser devtools, a bug, or any other direct write) is EQUALLY
// permitted by that same rule, and would orphan every puppy whose
// litterId pointed at the now-deleted litter. firestore.rules now denies
// litters delete unconditionally for clients — this endpoint is the only
// path, and it owns the ENTIRE decision itself (Admin SDK, bypasses
// Rules), re-implementing the exact same transaction logic round 3 had
// client-side, just moved here where Rules can no longer be bypassed by
// a stray direct write.
//
// POST /api/delete-litter
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId }
// Returns: { deletedCount, preservedCount, ambiguousCount } | { error }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { partitionLitterCandidatesServer } from './_lib/litter-eligibility.js'

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
  const { litterId } = body
  if (!litterId || typeof litterId !== 'string') {
    return res.status(400).json({ error: 'litterId is required' })
  }

  try {
    const db = getFirestore()
    const litterRef = db.collection('litters').doc(litterId)

    const outcome = await db.runTransaction(async (tx) => {
      const litterSnap = await tx.get(litterRef)
      if (!litterSnap.exists) {
        return { deletedCount: 0, preservedCount: 0, ambiguousCount: 0, notFound: true }
      }
      const litter = litterSnap.data()
      if (litter.tenantId !== uid) {
        throw new Error('NOT_YOUR_LITTER')
      }
      const puppyIds = litter.puppyIds || []
      const candidateSnaps = await Promise.all(puppyIds.map(id => tx.get(db.collection('dogs').doc(id))))
      const fetched = candidateSnaps
        .filter(s => s.exists)
        .map(s => ({ id: s.id, ...s.data() }))
      const { eligible, preserved, ambiguousCount } = partitionLitterCandidatesServer(litterId, fetched, uid)

      tx.delete(litterRef)
      for (const puppy of eligible) {
        tx.delete(db.collection('dogs').doc(puppy.id))
      }
      return { deletedCount: eligible.length, preservedCount: preserved, ambiguousCount, notFound: false }
    })

    return res.status(200).json(outcome)
  } catch (err) {
    if (err.message === 'NOT_YOUR_LITTER') {
      return res.status(403).json({ error: 'Not your litter' })
    }
    console.error('delete-litter error:', err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
