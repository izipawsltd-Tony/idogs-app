// api/update-showcase-puppy.js — trusted server-side single-puppy
// visibility/availability update for a Litter Showcase (iDogs Litter
// Showcase MVP, Slice 1).
//
// Slice 1 requirement 3: "Show in Showcase" must be explicitly enabled
// per puppy — this is that explicit action. Requirement 5: availability
// changes must never alter visibility (and vice versa) — enforced
// structurally by mergePuppyEntry() (api/_lib/showcase-schema.js), which
// only ever overwrites the field(s) actually present in the request,
// carrying the other field's existing (or default, on first touch)
// value forward unchanged. Requirement 7: this endpoint never reads or
// writes the `dogs` collection — a puppy's underlying Dog record is
// untouched no matter what its Showcase visibility/availability is set
// to.
//
// puppyId must be a CURRENT member of litter.puppyIds — this is a
// simple forward-membership check (not the two-sided
// resolveLitterMembership used by litter-eligibility.js for destructive
// dog mutations), because this endpoint never mutates the Dog document;
// it only records a reference to it inside the breeder's own Showcase
// doc, so the only thing that needs confirming is "this puppy is
// currently, genuinely part of this litter" — no ownership-history
// gating is relevant here at all.
//
// POST /api/update-showcase-puppy
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, puppyId, visible?: boolean, availability?: string }
// Returns: { showcase } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { checkBreederPlusAccess, loadOwnedLitter, loadOwnedShowcase, readShowcaseForResponse } from './_lib/showcase-access.js'
import { mergePuppyEntry, validatePuppyPatch, ShowcaseValidationError } from './_lib/showcase-schema.js'

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
  const { litterId, puppyId, ...rest } = body
  if (!litterId || typeof litterId !== 'string') {
    throw new ApiError(400, 'litterId is required')
  }
  if (!puppyId || typeof puppyId !== 'string') {
    throw new ApiError(400, 'puppyId is required')
  }

  let patch
  try {
    patch = validatePuppyPatch(rest)
  } catch (err) {
    if (err instanceof ShowcaseValidationError) throw new ApiError(400, err.message)
    throw err
  }

  const db = getFirestore()
  const showcaseRef = db.collection('litterShowcases').doc(litterId)

  const result = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(db.collection('users').doc(uid))
    const profile = userSnap.exists ? userSnap.data() : {}
    const accessError = checkBreederPlusAccess(profile)
    if (accessError) return accessError

    const { litter, error: litterError } = await loadOwnedLitter(tx, db, litterId, uid)
    if (litterError) return litterError

    if (!(litter.puppyIds || []).includes(puppyId)) {
      return { ok: false, status: 409, body: { error: 'This puppy is not currently a member of this litter', reason: 'PUPPY_NOT_IN_LITTER' } }
    }

    const { showcase, error: showcaseError } = await loadOwnedShowcase(tx, db, litterId, uid)
    if (showcaseError) return showcaseError

    const existingEntry = showcase.puppies?.[puppyId]
    const mergedEntry = mergePuppyEntry(existingEntry, patch)

    // set()+merge:true deep-merges nested map fields — this only ever
    // touches puppies.<puppyId>, leaving every sibling puppy entry (and
    // any other top-level field) untouched, without needing a
    // dot-notation field path built from a dynamic (Dog-document) id.
    // Codex fix-round finding 1: updatedAt is a trusted Firestore server
    // timestamp — see readShowcaseForResponse (showcase-access.js).
    tx.set(showcaseRef, { puppies: { [puppyId]: mergedEntry }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })

    return { ok: true }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  const showcase = await readShowcaseForResponse(db, litterId)
  return res.status(200).json({ showcase })
}

export default withApiErrorHandling('update-showcase-puppy', handler)
