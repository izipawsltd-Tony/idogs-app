// api/update-litter.js — trusted server-side litter field edits, with
// DOB propagation to still-owned puppies (Codex round 4, Blocker 3;
// hardened Codex round 5, Blockers 6 + 9).
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
// Codex round 5, Blocker 6: the patch is now validated through
// api/_lib/litter-schema.js — an explicit field allowlist (rejecting any
// unknown key outright, not just silently ignoring it) plus real
// calendar-date and length validation, rather than trusting whatever
// shape the client happened to send. damId/sireId/tenantId are never
// part of UPDATE_FIELDS, so there is no field to even attempt
// reassigning through this endpoint.
//
// POST /api/update-litter
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, patch: { name?, matingSuspectedDate?, expectedDueDate?,
//         actualBirthDate?, notes? } }
// Returns: { updatedPuppyCount } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { partitionLitterCandidatesServer } from './_lib/litter-eligibility.js'
import { sanitizeLitterInput, LitterValidationError, UPDATE_FIELDS } from './_lib/litter-schema.js'
import { computeEffectivePlan } from './_lib/entitlements.js'
import {
  hasLitterWithinRollingWindow,
  writeLitterQuotaLedgerEntry,
  LITTER_QUOTA_BLOCK_MESSAGE,
  LITTER_PLAN_GATE_MESSAGE,
  LITTER_DATE_LOCKED_MESSAGE,
} from './_lib/litter-quota.js'

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
  const { litterId, patch } = body
  if (!litterId || typeof litterId !== 'string') {
    throw new ApiError(400, 'litterId is required')
  }
  if (!patch || typeof patch !== 'object') {
    throw new ApiError(400, 'patch is required')
  }

  let safePatch
  try {
    safePatch = sanitizeLitterInput(patch, UPDATE_FIELDS)
  } catch (err) {
    if (err instanceof LitterValidationError) throw new ApiError(400, err.message)
    throw err
  }

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
    if (litter.archived) {
      return { ok: false, status: 409, body: { error: 'This litter has been deleted and can no longer be edited', reason: 'LITTER_ARCHIVED' } }
    }

    const puppyIds = litter.puppyIds || []
    const hasPuppies = puppyIds.length > 0
    const previousActualBirthDate = litter.actualBirthDate || ''
    const dobChanged = Object.prototype.hasOwnProperty.call(safePatch, 'actualBirthDate') &&
      safePatch.actualBirthDate !== previousActualBirthDate

    // iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md §3.4/§4.1,
    // LOCKED) — "Prevent whelpingDate edits from evading quota." The
    // simplest fully-correct enforcement: once a litter has been
    // activated (actualBirthDate already set, meaning a litterQuotaLedger
    // entry already exists for it), that date is locked — no further
    // change, including clearing it back to un-dated. Only the FIRST
    // transition from un-dated to dated (the §4.1 "activation" moment) is
    // allowed, and that path re-runs the same rolling-window check
    // api/create-litter.js applies at creation.
    if (dobChanged && previousActualBirthDate) {
      return { ok: false, status: 409, body: { error: LITTER_DATE_LOCKED_MESSAGE, reason: 'LITTER_DATE_LOCKED' } }
    }

    if (dobChanged && hasPuppies && !safePatch.actualBirthDate) {
      return { ok: false, status: 400, body: { error: 'This litter has puppies — actual birth date cannot be cleared' } }
    }

    const isActivating = dobChanged && !previousActualBirthDate && !!safePatch.actualBirthDate
    if (isActivating) {
      const userSnap = await tx.get(db.collection('users').doc(uid))
      const plan = computeEffectivePlan(userSnap.exists ? userSnap.data() : {})
      if (plan !== 'plus') {
        return { ok: false, status: 403, body: { error: LITTER_PLAN_GATE_MESSAGE, reason: 'LITTER_PLAN_GATE' } }
      }
      const withinWindow = await hasLitterWithinRollingWindow(tx, db, uid, safePatch.actualBirthDate)
      if (withinWindow) {
        return { ok: false, status: 409, body: { error: LITTER_QUOTA_BLOCK_MESSAGE, reason: 'LITTER_QUOTA_EXCEEDED' } }
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
    if (isActivating) {
      writeLitterQuotaLedgerEntry(tx, db, { tenantId: uid, litterId, whelpingDate: safePatch.actualBirthDate })
    }
    return { ok: true, updatedPuppyCount }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json({ updatedPuppyCount: result.updatedPuppyCount })
}

export default withApiErrorHandling('update-litter', handler)
