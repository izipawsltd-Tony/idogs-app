// api/save-heat-cycle.js — trusted server-side heat cycle create/update
// (Codex round 3, Blocker 1; hardened Codex round 4, Blocker 1).
//
// Same rationale as create-litter.js: firestore.rules can check a Sire
// reference's ownership/sex/deceased/DOB-format but has no date
// arithmetic to enforce actual minimum breeding maturity, so that check
// moves here. On CREATE, both the Dam (dogId) and Sire (sireId, if an
// in-account dog was selected) are re-validated fresh via the Admin SDK.
// On UPDATE, the Dam reference itself is immutable (dogId never changes
// on an existing record — see firestore.rules) and isn't re-validated
// for CURRENT eligibility, since editing a historical record (e.g.
// fixing a typo) must remain possible even if the Dam has since been
// transferred or passed away; only a newly-set/changed sireId is
// re-validated. firestore.rules denies direct client writes to
// heatCycles/{id} create and update entirely — this endpoint is now the
// only path for both.
//
// Codex round 4, Blocker 1: every read this endpoint relies on for a
// validation decision — the Dam/Sire eligibility reads on CREATE, and
// the access-check + Sire-eligibility reads on UPDATE — now happens
// inside a single db.runTransaction alongside the write, for the same
// reason as create-litter.js: a plain get()-then-write() sequence has a
// window where a concurrent transfer/claim/deceased-marking could
// invalidate the read between validation and commit. A transaction
// closes that window by re-validating (via Firestore's own optimistic
// concurrency check) that nothing read here has changed by commit time,
// automatically retrying the whole callback against fresh state if it has.
//
// POST /api/save-heat-cycle
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { cycleId?: string, dogId: string, cycle: {...HeatCycle fields except id} }
// Returns: { cycleId } | { error, reason? }

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
  const { cycleId, dogId, cycle } = body

  if (!dogId || typeof dogId !== 'string' || !cycle || typeof cycle !== 'object') {
    return res.status(400).json({ error: 'dogId and cycle are required' })
  }
  if (!cycle.heatStartDate) {
    return res.status(400).json({ error: 'heatStartDate is required' })
  }

  try {
    const db = getFirestore()

    if (!cycleId) {
      // CREATE — full Dam + (optional) Sire eligibility check, read and
      // written inside one transaction.
      const damRef = db.collection('dogs').doc(dogId)
      const sireRef = cycle.sireId ? db.collection('dogs').doc(cycle.sireId) : null
      const cycleRef = db.collection('heatCycles').doc()

      const result = await db.runTransaction(async (tx) => {
        const damSnap = await tx.get(damRef)
        const sireSnap = sireRef ? await tx.get(sireRef) : null

        const damCheck = validateBreedingParent(damSnap.exists ? damSnap.data() : null, { uid, requiredSex: 'female' })
        if (!damCheck.valid) {
          return { ok: false, status: 400, body: { error: 'Dam is not an eligible breeding parent', reason: damCheck.reason } }
        }
        if (sireRef) {
          const sireCheck = validateBreedingParent(sireSnap.exists ? sireSnap.data() : null, { uid, requiredSex: 'male' })
          if (!sireCheck.valid) {
            return { ok: false, status: 400, body: { error: 'Sire is not an eligible breeding parent', reason: sireCheck.reason } }
          }
        }

        const dam = damSnap.data()
        tx.set(cycleRef, {
          ...cycle,
          dogId,
          tenantId: dam.tenantId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        return { ok: true }
      })

      if (!result.ok) return res.status(result.status).json(result.body)
      return res.status(200).json({ cycleId: cycleRef.id })
    }

    // UPDATE — access check on the Dam (tenantId OR currentOwnerId,
    // matching firestore.rules' own dogBelongsToUser semantics for
    // historical-record access), and only re-validates the Sire if this
    // update actually sets/changes one. The Dam herself isn't
    // re-validated for current eligibility — editing a HISTORICAL
    // record must remain possible even if she's since been transferred
    // or passed away. All reads + the write happen inside one
    // transaction so a concurrent Sire mutation between validation and
    // commit is caught and retried, same as CREATE above.
    const existingRef = db.collection('heatCycles').doc(cycleId)
    const damRef = db.collection('dogs').doc(dogId)
    const sireRef = cycle.sireId ? db.collection('dogs').doc(cycle.sireId) : null

    const result = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(existingRef)
      const damSnap = await tx.get(damRef)
      const sireSnap = sireRef ? await tx.get(sireRef) : null

      if (!existingSnap.exists || existingSnap.data().dogId !== dogId) {
        return { ok: false, status: 404, body: { error: 'Heat cycle record not found' } }
      }
      if (!damSnap.exists) {
        return { ok: false, status: 404, body: { error: 'Dam not found' } }
      }
      const dam = damSnap.data()
      if (dam.tenantId !== uid && dam.currentOwnerId !== uid) {
        return { ok: false, status: 403, body: { error: 'Not your dog' } }
      }
      if (sireRef) {
        const sireCheck = validateBreedingParent(sireSnap.exists ? sireSnap.data() : null, { uid, requiredSex: 'male' })
        if (!sireCheck.valid) {
          return { ok: false, status: 400, body: { error: 'Sire is not an eligible breeding parent', reason: sireCheck.reason } }
        }
      }

      tx.update(existingRef, {
        ...cycle,
        dogId,
        tenantId: dam.tenantId,
        updatedAt: new Date().toISOString(),
      })
      return { ok: true }
    })

    if (!result.ok) return res.status(result.status).json(result.body)
    return res.status(200).json({ cycleId })
  } catch (err) {
    console.error('save-heat-cycle error:', err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
