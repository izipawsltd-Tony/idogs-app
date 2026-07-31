// api/reconcile-litter-puppy.js — Codex fix-round (Finding 3, HIGH):
// explicit, scoped, authenticated reconciliation for a SINGLE legacy
// litter puppy that may have been mis-restricted by the old (pre-Pricing
// v1.2) cap logic, before restrictionReason existed to prove it.
//
// WHY THIS EXISTS SEPARATELY from api/reconcile-dog-cap.js: that endpoint
// (and api/_lib/dog-cap.js's reconcileDogCapTx/reactivateUpToCapTx, which
// it and the Stripe webhook both call) only ever auto-reactivates a
// restricted litter puppy when restrictionReason is EXPLICITLY
// 'plan_cap_exceeded' — see dog-cap.js's own header comment for why
// shape alone (restricted + litterId + unretained) is no longer trusted
// as proof of WHY a dog was restricted. A dog restricted BEFORE that field
// existed has no restrictionReason recorded at all, so the automatic path
// correctly leaves it alone — Codex's explicit instruction was "do not
// automatically reactivate records based only on their shape."
//
// This endpoint is the deliberately narrower, conservative alternative:
// scoped to exactly ONE dog per call (never a blanket account/production
// sweep), requires the caller to explicitly name the dog they believe was
// mis-restricted, and independently validates real litter ownership (the
// referenced litters/{litterId} document must exist and belong to the
// caller — not just trusting the stored litterId string) before touching
// anything. It explicitly REFUSES a dog tagged restrictionReason:'manual'
// (a deliberate, non-cap restriction) — the safety rail against exactly
// the ambiguity Codex flagged. Idempotent: calling it again on an
// already-active dog is a harmless no-op, not an error.
//
// Any breeder can reconcile their own genuinely-eligible legacy litter
// puppy through this — including staging fixtures like "Green Boy" —
// through ordinary, already-authenticated application behavior. Nothing
// here is specific to any one account/dog/email, and nothing here touches
// more than the single dog named in the request.
//
// POST /api/reconcile-litter-puppy
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { dogId }
// Returns: { status: 'active', alreadyActive?: true } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'

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
  const { dogId } = body
  if (!dogId || typeof dogId !== 'string') {
    throw new ApiError(400, 'dogId is required')
  }

  const db = getFirestore()
  const dogRef = db.collection('dogs').doc(dogId)

  const result = await db.runTransaction(async tx => {
    // ── Reads first (transaction rule: all reads precede all writes) ──
    const dogSnap = await tx.get(dogRef)
    if (!dogSnap.exists) {
      return { ok: false, status: 404, body: { error: 'Dog not found' } }
    }
    const dog = dogSnap.data()

    if (dog.currentOwnerId !== uid || dog.tenantId !== uid) {
      // Tenant-scoped: only the ORIGINATING breeder (still the current
      // owner too — this is only ever true for an unpromoted litter
      // puppy that never left them) can reconcile it. A former breeder
      // who transferred the dog away, or anyone else, gets the same
      // opaque denial as "not your dog" elsewhere in this codebase.
      return { ok: false, status: 403, body: { error: 'Not your dog' } }
    }
    if (!dog.litterId) {
      return { ok: false, status: 409, body: { error: 'This dog is not a litter puppy', reason: 'NOT_A_LITTER_PUPPY' } }
    }
    if (dog.retainedByBreeder === true) {
      return { ok: false, status: 409, body: { error: 'This puppy has already been retained and counts toward your plan like any other dog — use Activate instead if it needs reactivating', reason: 'ALREADY_RETAINED' } }
    }
    if (dog.isDeceased === true) {
      return { ok: false, status: 409, body: { error: 'This dog is marked deceased', reason: 'DECEASED' } }
    }
    if (dog.status === 'active') {
      // Idempotent no-op — calling this twice (or on a dog that was
      // already reconciled some other way) is not an error.
      return { ok: true, status: 'active', alreadyActive: true }
    }
    if (dog.status !== 'restricted') {
      return { ok: false, status: 409, body: { error: `Cannot reconcile a dog with status '${dog.status}'`, reason: 'INVALID_STATUS_TRANSITION' } }
    }
    if (dog.restrictionReason === 'manual') {
      // The one deliberate, non-cap restriction path this codebase has
      // (api/set-dog-status.js's 'restrict' action) — never silently
      // undone here, regardless of how the dog otherwise looks.
      return { ok: false, status: 409, body: { error: 'This puppy was manually restricted, not cap-restricted — it cannot be reconciled through this action', reason: 'MANUALLY_RESTRICTED' } }
    }

    // ── Validate REAL litter ownership — not just the stored litterId
    // string. Closes the gap a forged/dangling litterId could otherwise
    // exploit (firestore.rules already makes litterId immutable once set,
    // but this is an independent, defense-in-depth cross-document check,
    // consistent with how api/create-litter-puppy.js itself validates the
    // litter document before ever attaching a dog to it). ──
    const litterRef = db.collection('litters').doc(dog.litterId)
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists) {
      return { ok: false, status: 409, body: { error: 'The litter this puppy references no longer exists', reason: 'LITTER_NOT_FOUND' } }
    }
    const litter = litterSnap.data()
    if (litter.tenantId !== uid) {
      return { ok: false, status: 403, body: { error: 'Not your litter', reason: 'LITTER_OWNERSHIP_MISMATCH' } }
    }

    // ── Write — no cap check needed at all: an unpromoted litter puppy
    // is exempt from the cap by definition (isEligibleForCap()), so
    // reactivating it never costs "room". ──
    tx.update(dogRef, { status: 'active', restrictionReason: FieldValue.delete(), updatedAt: new Date().toISOString() })
    return { ok: true, status: 'active' }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json(
    result.alreadyActive ? { status: result.status, alreadyActive: true } : { status: result.status }
  )
}

export default withApiErrorHandling('reconcile-litter-puppy', handler)
