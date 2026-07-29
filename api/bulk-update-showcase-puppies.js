// api/bulk-update-showcase-puppies.js — trusted server-side deliberate
// bulk visibility actions for a Litter Showcase (iDogs Litter Showcase
// MVP, Slice 1 requirement 6: "Select all" / "Clear all" / "Show
// available puppies only").
//
// Recomputes the ENTIRE puppies map from litter.puppyIds (the current,
// authoritative membership list) rather than patching individual keys —
// this is the one endpoint that also prunes stale entries for puppies
// no longer in the litter (e.g. unlinked via api/remove-litter-puppy.js
// since the Showcase was last touched). Availability is never modified
// by any bulk action (requirement 5) — see applyBulkAction()
// (api/_lib/showcase-schema.js), which only ever computes `visible` per
// puppy, carrying each puppy's existing (or default) availability
// forward unchanged.
//
// POST /api/bulk-update-showcase-puppies
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, action: 'select_all' | 'clear_all' | 'show_available_only' }
// Returns: { showcase } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { checkBreederPlusAccess, loadOwnedLitter, loadOwnedShowcase } from './_lib/showcase-access.js'
import { applyBulkAction, validateBulkAction, ShowcaseValidationError } from './_lib/showcase-schema.js'

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
  const { litterId, action } = body
  if (!litterId || typeof litterId !== 'string') {
    throw new ApiError(400, 'litterId is required')
  }
  try {
    validateBulkAction(action)
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

    const { showcase, error: showcaseError } = await loadOwnedShowcase(tx, db, litterId, uid)
    if (showcaseError) return showcaseError

    const puppyIds = litter.puppyIds || []
    const newPuppies = applyBulkAction(action, showcase.puppies, puppyIds)
    const nowIso = new Date().toISOString()

    // Plain update() replaces the whole `puppies` field (not a merge) —
    // deliberate here, so entries for puppies no longer in litter.puppyIds
    // are actually dropped rather than retained forever.
    tx.update(showcaseRef, { puppies: newPuppies, updatedAt: nowIso })

    return { ok: true, showcase: { ...showcase, puppies: newPuppies, updatedAt: nowIso } }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json({ showcase: result.showcase })
}

export default withApiErrorHandling('bulk-update-showcase-puppies', handler)
