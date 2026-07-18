// api/save-heat-cycle.js — trusted server-side heat cycle create/update
// (Codex round 3, Blocker 1; hardened Codex round 4, Blocker 1; hardened
// Codex round 5, Blocker 5).
//
// Same rationale as create-litter.js: firestore.rules can check a Sire
// reference's ownership/sex/deceased/DOB-format but has no date
// arithmetic to enforce actual minimum breeding maturity, so that check
// moves here. firestore.rules denies direct client writes to
// heatCycles/{id} create and update entirely — this endpoint is now the
// only path for both.
//
// Codex round 5, Blocker 5 — two changes from round 4:
//
// 1. The Dam is now FULLY validated (validateBreedingParent — ownership,
//    sex, deceased, active status, real breeding maturity) inside the
//    UPDATE transaction too, not just on CREATE. Round 3/4 deliberately
//    left UPDATE with an access-only check (tenantId/currentOwnerId),
//    reasoning that editing a HISTORICAL record should stay possible
//    even after the Dam is later transferred or passes away. Codex round
//    5 explicitly requires full validation on update without that
//    carve-out — this is a genuine behavior change: editing an existing
//    Heat Cycle record now requires the Dam to currently pass the full
//    eligibility bar, same as creating a new one. Flagged as a known
//    trade-off in the round 5 report (a legitimate historical-record
//    typo-fix for an since-transferred Dam is no longer possible through
//    this endpoint).
//
// 2. The write itself no longer spreads the client's `cycle` object
//    directly (`{...cycle, ...}`) — see api/_lib/heat-cycle-schema.js's
//    own comment for why that was a mass-assignment risk. Every field is
//    now validated against an explicit allowlist; createdAt is
//    server-maintained and preserved exactly across updates (re-read
//    from the existing document, never taken from the client, never
//    reset).
//
// POST /api/save-heat-cycle
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { cycleId?: string, dogId: string, cycle: {...HeatCycle fields except id} }
// Returns: { cycleId } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { validateBreedingParent } from './_lib/parent-eligibility.js'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { sanitizeHeatCycleInput, HeatCycleValidationError } from './_lib/heat-cycle-schema.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    throw new ApiError(405, 'Method not allowed')
  }

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    throw new ApiError(401, 'Missing Authorization header')
  }

  let uid
  try {
    const decoded = await getAuth().verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    throw new ApiError(401, 'Invalid or expired token')
  }

  const body = parseJsonBody(req)
  const { cycleId, dogId, cycle } = body

  if (!dogId || typeof dogId !== 'string' || !cycle || typeof cycle !== 'object') {
    throw new ApiError(400, 'dogId and cycle are required')
  }

  let safeCycle
  try {
    safeCycle = sanitizeHeatCycleInput(cycle, { requireHeatStartDate: !cycleId })
  } catch (err) {
    if (err instanceof HeatCycleValidationError) throw new ApiError(400, err.message)
    throw err
  }

  const db = getFirestore()

  if (!cycleId) {
    // CREATE — full Dam + (optional) Sire eligibility check, read and
    // written inside one transaction.
    const damRef = db.collection('dogs').doc(dogId)
    const sireRef = safeCycle.sireId ? db.collection('dogs').doc(safeCycle.sireId) : null
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
      const nowIso = new Date().toISOString()
      tx.set(cycleRef, {
        ...safeCycle,
        dogId,
        tenantId: dam.tenantId,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      return { ok: true }
    })

    if (!result.ok) return res.status(result.status).json(result.body)
    return res.status(200).json({ cycleId: cycleRef.id })
  }

  // UPDATE — the Dam is now fully re-validated too (Codex round 5,
  // Blocker 5 — see this file's own top comment on the trade-off), and
  // only re-validates the Sire if this update actually sets/changes one.
  // All reads + the write happen inside one transaction.
  const existingRef = db.collection('heatCycles').doc(cycleId)
  const damRef = db.collection('dogs').doc(dogId)
  const sireRef = safeCycle.sireId ? db.collection('dogs').doc(safeCycle.sireId) : null

  const result = await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(existingRef)
    const damSnap = await tx.get(damRef)
    const sireSnap = sireRef ? await tx.get(sireRef) : null

    if (!existingSnap.exists || existingSnap.data().dogId !== dogId) {
      return { ok: false, status: 404, body: { error: 'Heat cycle record not found' } }
    }
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
    const existing = existingSnap.data()
    tx.update(existingRef, {
      ...safeCycle,
      dogId,
      tenantId: dam.tenantId,
      // Preserve createdAt exactly — it's never in ALL_FIELDS (a
      // client-supplied one is rejected outright as an unknown field
      // before this point is ever reached), and is re-set here from the
      // EXISTING document, never from the client, never reset to "now".
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    })
    return { ok: true }
  })

  if (!result.ok) return res.status(result.status).json(result.body)
  return res.status(200).json({ cycleId })
}

export default withApiErrorHandling('save-heat-cycle', handler)
