// api/set-dog-status.js — trusted server-side dog status transitions for
// iDogs Pricing v1.1/v1.2 (Pricing_Decision_Record_v1.1.md §3.2/§3.3,
// LOCKED, plus the v1.2 litter-puppy cap-eligibility change — see
// api/_lib/dog-cap.js's own header for the full policy history).
//
// WHY THIS EXISTS: firestore.rules cannot safely verify "promoting this
// dog to active would not exceed my plan's cap" — that needs a
// cross-document count over every dog this uid owns, which Rules has no
// aggregate-query primitive for (same limitation already documented for
// litters/heat-cycles/puppies in firestore.rules and solved there the
// same way: move the check to a trusted Admin SDK endpoint). This is that
// endpoint for the dog-status swap/archive/restore/activate actions
// described in §3.3 ("Swapping is always available... provided the
// active count never exceeds the cap") — and, since Pricing v1.2, also
// the ONLY legitimate way a litter puppy's `retainedByBreeder` flag can
// ever change (see 'promote'/'unpromote' below and dogProtectedFieldsUnchanged()
// in firestore.rules, which denies any direct client write to that field).
//
// restrict/archive always succeed (they only ever REDUCE the active
// count). activate/restore/promote re-check the cap inside the SAME
// transaction as the read that established the current active count —
// Codex-style concurrency safety, not a check-then-write race.
// unpromote always succeeds (it only ever REDUCES the active count, same
// as restrict/archive).
//
// POST /api/set-dog-status
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { dogId, action: 'restrict' | 'archive' | 'activate' | 'restore' | 'promote' | 'unpromote' }
// Returns: { status, retainedByBreeder? } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { capForPlan, getOwnedActiveDogsSorted } from './_lib/dog-cap.js'
import { computeEffectivePlan } from './_lib/entitlements.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const PROMOTING_ACTIONS = new Set(['activate', 'restore'])
const STATUS_ACTIONS = new Set(['restrict', 'archive', 'activate', 'restore'])
// Pricing v1.2 — a litter puppy's ONLY path to (or back from) counting
// toward the cap. Deliberately separate from STATUS_ACTIONS: promoting/
// unpromoting never changes `status` at all (a puppy stays 'active'
// throughout) — only `retainedByBreeder` changes.
const RETENTION_ACTIONS = new Set(['promote', 'unpromote'])
const VALID_ACTIONS = new Set([...STATUS_ACTIONS, ...RETENTION_ACTIONS])

// Which starting statuses each action is valid from. A dog mid-transfer
// (status:'transferred' or transferStatus:'pendingClaim') is excluded
// from all four — that flow owns the dog's status until claim/decline.
const FROM_STATUS = {
  restrict: new Set(['active']),
  archive: new Set(['active', 'restricted']),
  activate: new Set(['restricted']),
  restore: new Set(['archived']),
}

const TO_STATUS = { restrict: 'restricted', archive: 'archived', activate: 'active', restore: 'active' }

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
  const { dogId, action } = body
  if (!dogId || typeof dogId !== 'string') {
    throw new ApiError(400, 'dogId is required')
  }
  if (!VALID_ACTIONS.has(action)) {
    throw new ApiError(400, 'Invalid action')
  }

  const db = getFirestore()
  const dogRef = db.collection('dogs').doc(dogId)
  const userRef = db.collection('users').doc(uid)

  const result = await db.runTransaction(async tx => {
    // ── Reads first (transaction rule: all reads precede all writes) ──
    const dogSnap = await tx.get(dogRef)
    if (!dogSnap.exists) {
      return { ok: false, status: 404, body: { error: 'Dog not found' } }
    }
    const dog = dogSnap.data()
    if (dog.currentOwnerId !== uid) {
      return { ok: false, status: 403, body: { error: 'Not your dog' } }
    }
    if (dog.status === 'transferred' || dog.transferStatus === 'pendingClaim') {
      return { ok: false, status: 409, body: { error: 'This dog has a pending or completed transfer and cannot change status', reason: 'DOG_TRANSFER_IN_PROGRESS' } }
    }
    const currentStatus = dog.status || 'active'

    // ── Pricing v1.2 retention actions — handled entirely separately
    // from the status-transition logic below, since `status` never
    // changes here. ──
    if (RETENTION_ACTIONS.has(action)) {
      if (!dog.litterId) {
        return { ok: false, status: 409, body: { error: 'Only a litter puppy can be promoted or unpromoted', reason: 'NOT_A_LITTER_PUPPY' } }
      }
      if (currentStatus !== 'active') {
        return { ok: false, status: 409, body: { error: `Cannot ${action} a dog with status '${currentStatus}'`, reason: 'INVALID_STATUS_TRANSITION' } }
      }
      const isRetained = dog.retainedByBreeder === true

      if (action === 'promote') {
        if (isRetained) {
          return { ok: false, status: 409, body: { error: 'This puppy is already retained', reason: 'ALREADY_RETAINED' } }
        }
        // Same anti-evasion cap check as activate/restore below — a
        // promotion must never be allowed to push the active-eligible
        // count past the cap. Never restricts as a fallback (unlike
        // creation) — promotion is an explicit, deliberate breeder
        // action, so it is BLOCKED outright when there's no room,
        // consistent with this file's existing activate/restore
        // precedent for other explicit reactivation-style actions.
        const userSnap = await tx.get(userRef)
        const profile = userSnap.exists ? userSnap.data() : {}
        const plan = computeEffectivePlan(profile)
        const cap = capForPlan(plan)
        const activeDogs = await getOwnedActiveDogsSorted(tx, db, uid)
        if (activeDogs.length >= cap) {
          return {
            ok: false,
            status: 409,
            body: {
              error: `Retaining this puppy would exceed your plan's limit of ${cap} active dogs`,
              reason: 'DOG_CAP_EXCEEDED',
              cap,
              activeCount: activeDogs.length,
            },
          }
        }
        tx.update(dogRef, { retainedByBreeder: true, updatedAt: new Date().toISOString() })
        return { ok: true, status: currentStatus, retainedByBreeder: true }
      }

      // action === 'unpromote' — always succeeds when currently retained;
      // freeing a slot never needs a cap check, same posture as
      // restrict/archive below.
      if (!isRetained) {
        return { ok: false, status: 409, body: { error: 'This puppy is not currently retained', reason: 'NOT_RETAINED' } }
      }
      tx.update(dogRef, { retainedByBreeder: false, updatedAt: new Date().toISOString() })
      return { ok: true, status: currentStatus, retainedByBreeder: false }
    }

    if (!FROM_STATUS[action].has(currentStatus)) {
      return { ok: false, status: 409, body: { error: `Cannot ${action} a dog with status '${currentStatus}'`, reason: 'INVALID_STATUS_TRANSITION' } }
    }

    let activeDogs = null
    if (PROMOTING_ACTIONS.has(action)) {
      const userSnap = await tx.get(userRef)
      const profile = userSnap.exists ? userSnap.data() : {}
      const plan = computeEffectivePlan(profile)
      const cap = capForPlan(plan)
      activeDogs = await getOwnedActiveDogsSorted(tx, db, uid)
      // Anti-evasion (§3.2/§3.3): archive→restore or restricted→activate
      // must never be allowed to push the active count past the cap —
      // the exact quota-evasion path the record calls out explicitly.
      if (activeDogs.length >= cap) {
        return {
          ok: false,
          status: 409,
          body: {
            error: `Activating this dog would exceed your plan's limit of ${cap} active dogs`,
            reason: 'DOG_CAP_EXCEEDED',
            cap,
            activeCount: activeDogs.length,
          },
        }
      }
    }

    // ── Writes ──
    tx.update(dogRef, { status: TO_STATUS[action], updatedAt: new Date().toISOString() })
    return { ok: true, status: TO_STATUS[action] }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json(
    'retainedByBreeder' in result ? { status: result.status, retainedByBreeder: result.retainedByBreeder } : { status: result.status }
  )
}

export default withApiErrorHandling('set-dog-status', handler)
