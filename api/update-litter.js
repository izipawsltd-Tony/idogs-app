// api/update-litter.js — trusted server-side litter field edits, with
// DOB propagation to still-owned puppies (Codex round 4, Blocker 3).
//
// WHY THIS EXISTS: round 3's handleSaveLitter() (LittersPage.tsx) wrote
// directly to litters/{id} via a client writeBatch, relying on
// firestore.rules' litters.update rule (tenantId ownership +
// damId/sireId/tenantId immutability + actualBirthDate format-when-
// puppies-exist) to keep it safe. Codex round 4, Blocker 3 requires
// denying ALL direct client litters update — there is no longer a rule
// path for this write at all, so it moves here (Admin SDK, bypasses
// Rules — this endpoint alone owns the safety of the operation).
//
// Only name/matingSuspectedDate/expectedDueDate/actualBirthDate/notes
// are ever accepted — damId/sireId/tenantId are never part of the patch
// (the client UI never exposes editing them either; this endpoint simply
// never reads them from the request body, so there's no field to even
// attempt reassigning).
//
// POST /api/update-litter
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, patch: { name?, matingSuspectedDate?, expectedDueDate?,
//         actualBirthDate?, notes? } }
// Returns: { updatedPuppyCount } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDobStrictServer } from './_lib/parent-eligibility.js'
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

const PATCHABLE_FIELDS = ['name', 'matingSuspectedDate', 'expectedDueDate', 'actualBirthDate', 'notes']

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
  const { litterId, patch } = body
  if (!litterId || typeof litterId !== 'string') {
    return res.status(400).json({ error: 'litterId is required' })
  }
  if (!patch || typeof patch !== 'object') {
    return res.status(400).json({ error: 'patch is required' })
  }
  const safePatch = {}
  for (const field of PATCHABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) safePatch[field] = patch[field]
  }

  try {
    const db = getFirestore()
    const litterRef = db.collection('litters').doc(litterId)

    const result = await db.runTransaction(async (tx) => {
      const litterSnap = await tx.get(litterRef)
      if (!litterSnap.exists) {
        return { ok: false, status: 404, body: { error: 'Litter not found' } }
      }
      const litter = litterSnap.data()
      if (litter.tenantId !== uid) {
        return { ok: false, status: 403, body: { error: 'Not your litter' } }
      }

      const puppyIds = litter.puppyIds || []
      const hasPuppies = puppyIds.length > 0
      const dobChanged = Object.prototype.hasOwnProperty.call(safePatch, 'actualBirthDate') &&
        safePatch.actualBirthDate !== (litter.actualBirthDate || '')

      if (dobChanged) {
        if (hasPuppies && !safePatch.actualBirthDate) {
          return { ok: false, status: 400, body: { error: 'This litter has puppies — actual birth date cannot be cleared' } }
        }
        if (safePatch.actualBirthDate && !parseDobStrictServer(safePatch.actualBirthDate)) {
          return { ok: false, status: 400, body: { error: 'Actual birth date is not a valid past date' } }
        }
      }

      let updatedPuppyCount = 0
      if (dobChanged && safePatch.actualBirthDate && hasPuppies) {
        const candidateSnaps = await Promise.all(puppyIds.map(id => tx.get(db.collection('dogs').doc(id))))
        const fetched = candidateSnaps.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }))
        const { eligible } = partitionLitterCandidatesServer(litterId, fetched, uid)
        const nowIso = new Date().toISOString()
        for (const puppy of eligible) {
          tx.update(db.collection('dogs').doc(puppy.id), { dateOfBirth: safePatch.actualBirthDate, updatedAt: nowIso })
        }
        updatedPuppyCount = eligible.length
      }

      tx.update(litterRef, safePatch)
      return { ok: true, updatedPuppyCount }
    })

    if (!result.ok) {
      return res.status(result.status).json(result.body)
    }
    return res.status(200).json({ updatedPuppyCount: result.updatedPuppyCount })
  } catch (err) {
    console.error('update-litter error:', err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
