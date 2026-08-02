// api/remove-litter-puppy.js — trusted server-side litter-puppy deletion
// (Codex round 4, Blocker 3; hardened Codex round 5, Blocker 1; hardened
// Codex round 6, Blocker 2).
//
// WHY THIS EXISTS: round 3's handleDeletePuppy() (LittersPage.tsx)
// called updateLitter(litter.id, { puppyIds: filtered }) — a DIRECT
// client write to litters/{id}.puppyIds, exactly the "clients directly
// changing puppyIds" bypass Codex round 4, Blocker 3 calls out by name.
//
// Codex round 5, Blocker 1: round 4's version only checked CONFIRMED
// membership (dog.litterId === litterId) before unlinking — it never
// checked whether the Dog was still safe to detach at all. A transferred,
// pending-claim, claimed, or otherwise history-bearing Dog could be
// silently unlinked from its own litter record, destroying the buyer's
// ability to trace their dog's origin litter for no reason. Now uses the
// same isDogSafeToDetach gate as delete-litter.js: only a Dog still
// fully, cleanly controlled by the requester can be touched at all.
//
// Codex round 6, Blocker 2: round 5's confirmed-membership check only
// verified the REVERSE direction (dog.litterId === litterId) — it never
// checked the FORWARD direction (litter.puppyIds actually contains
// puppyId). A reverse-only dog (its own litterId points here, but it
// was never added to this litter's puppyIds — e.g. a partial write)
// would pass that single check and get touched anyway — mutating a dog
// that was never actually a two-sided, confirmed member of this litter
// in the first place. Confirmed membership now requires BOTH directions
// to agree before anything is written; reverse-only, forward-only,
// contradictory, or otherwise ambiguous membership is rejected outright
// with zero writes.
//
// Fix round (promoted-puppy delete bug — production evidence: puppy
// "disappeared from the litter but remained active and editable in My
// Dogs, was not archived, and could still be marked Available"): rounds
// 4-6 above deliberately made this endpoint UNLINK-ONLY — it cleared
// dog.litterId but never deleted the Dog document, matching the old
// "Remove this puppy from the litter?" UI copy. That was itself the bug:
// the dogs/{id} document IS the "My Dogs" record — there are not two
// linked records, one shared document — and isDogEligibleForCap() (see
// src/lib/utils.ts) only exempts a dog from the plan cap WHILE litterId
// is still present. Unlinking therefore silently converted ANY litter
// puppy — promoted or not — into a full, independent, cap-counted,
// editable, sellable "My Dogs" dog with zero explicit action from the
// breeder. This endpoint now does one of two things once a dog is
// confirmed a safe, eligible litter member:
//   - retainedByBreeder === true (the breeder explicitly promoted this
//     puppy onto their Dog List — see api/set-dog-status.js's 'promote'
//     action): deletion is REJECTED outright, zero writes. A promoted
//     puppy already IS a deliberately-kept My Dogs record; the correct
//     path is api/set-dog-status.js's 'unpromote' action (return it to
//     litter-only) first, or DogDetailPage's own archive-instead-of-
//     delete flow if its history needs to be retained.
//   - otherwise (a litter-only puppy, never promoted): the Dog document
//     is now HARD-DELETED (not merely unlinked) alongside removing it
//     from litter.puppyIds — this is the "permanent deletion after clear
//     confirmation" the UI now asks for, and it's what actually prevents
//     the orphaned-active-record bug: there is no unlinked-but-alive
//     state left behind. The Showcase projection needs no separate
//     cleanup write: api/showcase-public.js already re-fetches and
//     validates each puppy's own dog document fresh on every read
//     (dropping any that no longer exists or no longer resolves back to
//     this litter/tenant — see that file's own header comment), and the
//     breeder-facing Showcase panel in LittersPage.tsx is driven off the
//     litter's CURRENT puppyIds, not off litterShowcases/{id}.puppies'
//     map keys — so a deleted puppy disappears from both automatically.
// The existing isDogSafeToDetach gate (transferred/pending-claim/claimed/
// history-bearing/not-currently-owned) is completely unchanged and still
// applies BEFORE the promoted check even runs — this fix adds a new,
// additional gate, it does not loosen the existing ones.
//
// Deliberately NOT folded into isDogSafeToDetach itself (api/_lib/
// litter-eligibility.js) — that helper is also shared by
// api/delete-litter.js (whole-litter deletion) and api/update-litter.js.
// Changing its shared semantics would silently change whole-litter
// deletion behavior too, an entirely different, unreported workflow.
// This endpoint's own promoted-puppy guard is intentionally local.
//
// POST /api/remove-litter-puppy
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, puppyId }
// Returns: { ok: true, deleted: true } | { error, reason }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { isDogSafeToDetach } from './_lib/litter-eligibility.js'

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
  const { litterId, puppyId } = body
  if (!litterId || typeof litterId !== 'string') {
    throw new ApiError(400, 'litterId is required')
  }
  if (!puppyId || typeof puppyId !== 'string') {
    throw new ApiError(400, 'puppyId is required')
  }

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
    if (litter.archived) {
      return { ok: false, status: 409, body: { error: 'This litter has been deleted and can no longer be edited', reason: 'LITTER_ARCHIVED' } }
    }
    if (!dogSnap.exists) {
      // Stale puppyIds entry pointing at an already-deleted dog — safe
      // to clean up, there is no Dog left to protect or leave dangling.
      tx.update(litterRef, { puppyIds: FieldValue.arrayRemove(puppyId) })
      return { ok: true, deleted: false }
    }
    const dog = dogSnap.data()
    // Two-sided confirmed-membership check (Codex round 6, Blocker 2):
    // the dog's own litterId must agree (reverse) AND the litter's own
    // puppyIds must actually list this dog (forward). Either direction
    // alone is ambiguous, not confirmed.
    const reverseConfirmed = dog.litterId === litterId
    const forwardConfirmed = (litter.puppyIds || []).includes(puppyId)
    if (!reverseConfirmed || !forwardConfirmed) {
      return { ok: false, status: 409, body: { error: 'This dog is not a confirmed (two-sided) member of this litter', reason: 'NOT_CONFIRMED_MEMBER' } }
    }
    // Promoted-puppy guard (fix round, see header comment): a dog the
    // breeder has explicitly kept on their Dog List is a deliberate,
    // active My Dogs record — deleting it from the litter view would
    // silently destroy that record. Checked BEFORE isDogSafeToDetach so
    // the message is always the more specific/actionable one when both
    // would otherwise apply (archiving from My Dogs remains valid advice
    // even if the dog also happens to carry transfer/claim history).
    if (dog.retainedByBreeder === true) {
      return {
        ok: false,
        status: 409,
        body: {
          error: 'This puppy is currently in My Dogs. Return it to litter-only before deleting, or archive it from My Dogs to retain its history.',
          reason: 'PROMOTED_ACTIVE_IN_MY_DOGS',
        },
      }
    }
    if (!isDogSafeToDetach(dog, uid)) {
      return { ok: false, status: 409, body: { error: 'This dog cannot be deleted — it is transferred, pending claim, claimed, or otherwise no longer exclusively yours', reason: 'DOG_PROTECTED' } }
    }

    // Fix round: hard-delete, not unlink — see header comment. Removed
    // from litter.puppyIds in the SAME transaction as the Dog document
    // deletion so the two are guaranteed to agree.
    tx.update(litterRef, { puppyIds: FieldValue.arrayRemove(puppyId) })
    tx.delete(dogRef)
    return { ok: true, deleted: true }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json({ ok: true, deleted: result.deleted })
}

export default withApiErrorHandling('remove-litter-puppy', handler)
