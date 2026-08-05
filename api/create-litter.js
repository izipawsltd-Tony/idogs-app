// api/create-litter.js — trusted server-side litter creation (Codex
// round 3, Blocker 1; hardened Codex round 4, Blocker 1; hardened Codex
// round 5, Blocker 6).
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
// Codex round 4, Blocker 1: the Dam/Sire reads and the litter write now
// happen inside ONE db.runTransaction — see that round's own note on why
// a plain get()-then-set() sequence has a stale-read race window a
// transaction closes.
//
// Codex round 5, Blocker 6: name/sireName/notes/dates are now validated
// through api/_lib/litter-schema.js — an explicit field allowlist
// (unknown keys rejected outright) plus real calendar-date and length
// checks, rather than the previous `field || ''` fallbacks that accepted
// any string (including an impossible or future-dated actualBirthDate)
// as long as the client's own UI happened not to send one.
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
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { sanitizeLitterInput, LitterValidationError, CREATE_FIELDS } from './_lib/litter-schema.js'
import { computeEffectivePlan, hasValidInternalEntitlement } from './_lib/entitlements.js'
import {
  hasLitterWithinRollingWindow,
  hasOtherUndatedPlannedLitter,
  writeLitterQuotaLedgerEntry,
  LITTER_QUOTA_BLOCK_MESSAGE,
  LITTER_PLAN_GATE_MESSAGE,
  LITTER_PLANNED_DUPLICATE_MESSAGE,
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
  const { damId, sireId, ...rest } = body

  if (!damId || typeof damId !== 'string') {
    throw new ApiError(400, 'damId is required')
  }
  // Codex Medium item: a client omitting the sire safely sends `sireId:
  // null` (e.g. JSON.stringify of an unset form field), not `undefined` —
  // treat both the same as "no sire", not a validation error.
  if (sireId !== undefined && sireId !== null && typeof sireId !== 'string') {
    throw new ApiError(400, 'sireId must be a string')
  }

  let safeFields
  try {
    safeFields = sanitizeLitterInput(rest, CREATE_FIELDS)
  } catch (err) {
    if (err instanceof LitterValidationError) throw new ApiError(400, err.message)
    throw err
  }

  const useInAccountSire = sireId && sireId !== '__external__'

  const db = getFirestore()
  const damRef = db.collection('dogs').doc(damId)
  const sireRef = useInAccountSire ? db.collection('dogs').doc(sireId) : null
  const litterRef = db.collection('litters').doc()

  const result = await db.runTransaction(async (tx) => {
    // Reads must precede writes in a transaction — both parent reads
    // happen first, then validation, then (only if both pass) the
    // single write. If either read's document changes before this
    // transaction commits, Firestore retries this whole callback
    // against the fresh state rather than committing against data
    // that was true a moment ago but no longer is.
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

    // iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md §1.1/§3.4/§4.1,
    // LOCKED): Free has 0 litter allowance; Plus is capped at one
    // whelped litter per rolling 365 days, plus at most one un-dated
    // planned litter at a time. All reads happen here, before the single
    // write below, per transaction rules.
    const userSnap = await tx.get(db.collection('users').doc(uid))
    const profile = userSnap.exists ? userSnap.data() : {}
    const plan = computeEffectivePlan(profile)
    if (plan !== 'plus') {
      return { ok: false, status: 403, body: { error: LITTER_PLAN_GATE_MESSAGE, reason: 'LITTER_PLAN_GATE' } }
    }

    // Super Admin fix round: a verified internal entitlement bypasses the
    // rolling-window/one-planned-litter limits entirely (QA needs to
    // create more than one test litter without waiting a year) — it does
    // NOT bypass the plan gate above, which internalEntitlement already
    // satisfies via computeEffectivePlan() resolving to 'plus'. The
    // ledger entry is still written below for a dated litter either way,
    // so historical quota accounting stays accurate even if the override
    // is later revoked.
    const isUnlimited = hasValidInternalEntitlement(profile)

    const whelpingDate = safeFields.actualBirthDate || ''
    if (whelpingDate) {
      if (!isUnlimited) {
        const withinWindow = await hasLitterWithinRollingWindow(tx, db, uid, whelpingDate)
        if (withinWindow) {
          return { ok: false, status: 409, body: { error: LITTER_QUOTA_BLOCK_MESSAGE, reason: 'LITTER_QUOTA_EXCEEDED' } }
        }
      }
    } else if (!isUnlimited) {
      const hasPlanned = await hasOtherUndatedPlannedLitter(tx, db, uid)
      if (hasPlanned) {
        return { ok: false, status: 409, body: { error: LITTER_PLANNED_DUPLICATE_MESSAGE, reason: 'LITTER_PLANNED_DUPLICATE' } }
      }
    }

    const dam = damSnap.data()
    tx.set(litterRef, {
      tenantId: uid,
      name: safeFields.name?.trim() || `${dam.name} Litter`,
      damId,
      sireId: useInAccountSire ? sireId : null,
      sireName: sireId === '__external__' ? (safeFields.sireName?.trim() || null) : null,
      matingSuspectedDate: safeFields.matingSuspectedDate || '',
      expectedDueDate: safeFields.expectedDueDate || '',
      actualBirthDate: safeFields.actualBirthDate || '',
      notes: safeFields.notes || '',
      puppyIds: [],
      createdAt: new Date().toISOString(),
    })
    if (whelpingDate) {
      writeLitterQuotaLedgerEntry(tx, db, { tenantId: uid, litterId: litterRef.id, whelpingDate })
    }
    return { ok: true }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json({ litterId: litterRef.id })
}

export default withApiErrorHandling('create-litter', handler)
