// api/remove-litter-puppy.js — trusted server-side puppy-unlink (Codex
// round 4, Blocker 3; hardened Codex round 5, Blocker 1).
//
// WHY THIS EXISTS: round 3's handleDeletePuppy() (LittersPage.tsx)
// called updateLitter(litter.id, { puppyIds: filtered }) — a DIRECT
// client write to litters/{id}.puppyIds, exactly the "clients directly
// changing puppyIds" bypass Codex round 4, Blocker 3 calls out by name.
// This does NOT delete the Dog document — it only unlinks it from the
// litter (matches the existing "Remove this puppy from the litter?"
// UI copy).
//
// Codex round 5, Blocker 1: round 4's version only checked CONFIRMED
// membership (dog.litterId === litterId) before unlinking — it never
// checked whether the Dog was still safe to detach at all. A transferred,
// pending-claim, claimed, or otherwise history-bearing Dog could be
// silently unlinked from its own litter record, destroying the buyer's
// ability to trace their dog's origin litter for no reason (unlinking
// doesn't even affect who owns the dog — there's no legitimate case for
// it). Now uses the same isDogSafeToDetach gate as delete-litter.js:
// only a Dog still fully, cleanly controlled by the requester can be
// unlinked. And critically: on a successful unlink, this now ALSO clears
// the Dog's own litterId back-reference — round 4's version only ever
// updated litter.puppyIds, leaving dog.litterId still pointing at a
// litter the Dog was supposedly removed from (a one-sided membership
// state neither "confirmed member" nor "not a member" could correctly
// interpret afterward).
//
// Codex round 6, Blocker 2: round 5's confirmed-membership check only
// verified the REVERSE direction (dog.litterId === litterId) — it never
// checked the FORWARD direction (litter.puppyIds actually contains
// puppyId). A reverse-only dog (its own litterId points here, but it
// was never added to this litter's puppyIds — e.g. a partial write)
// would pass that single check and get "removed": litter.puppyIds gets
// an arrayRemove of an id it never contained (a silent no-op there) AND
// the dog's litterId gets cleared anyway — mutating a dog that was
// never actually a two-sided, confirmed member of this litter in the
// first place. Confirmed membership now requires BOTH directions to
// agree before anything is written; reverse-only, forward-only,
// contradictory, or otherwise ambiguous membership is rejected outright
// with zero writes.
//
// POST /api/remove-litter-puppy
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, puppyId }
// Returns: { ok: true } | { error }

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
      return { ok: true }
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
    if (!isDogSafeToDetach(dog, uid)) {
      return { ok: false, status: 409, body: { error: 'This dog cannot be removed from the litter — it is transferred, pending claim, claimed, or otherwise no longer exclusively yours', reason: 'DOG_PROTECTED' } }
    }

    // Two-sided: clear the Dog's own back-reference in the SAME
    // transaction as unlinking it from the litter — after this commits,
    // litter.puppyIds and dog.litterId are guaranteed to agree (neither
    // references the other) rather than leaving a one-sided state.
    tx.update(litterRef, { puppyIds: FieldValue.arrayRemove(puppyId) })
    tx.update(dogRef, { litterId: FieldValue.delete() })
    return { ok: true }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json({ ok: true })
}

export default withApiErrorHandling('remove-litter-puppy', handler)
