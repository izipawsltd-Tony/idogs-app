// api/set-showcase-enabled.js — trusted server-side enable/disable
// toggle for a Litter Showcase (iDogs Litter Showcase MVP, Slice 1).
//
// Deliberately touches ONLY `enabled` + `updatedAt` — never the puppies
// map. Slice 1 requirement 8 ("Disabling a Showcase preserves its
// configuration") holds because there is no code path here that can
// touch puppies at all, not because of a convention that happens to be
// followed. Re-enabling a previously-disabled Showcase restores exactly
// the puppy selection it had before — never resets to zero-visible
// (that only happens once, structurally, at CREATE — see
// create-showcase.js).
//
// POST /api/set-showcase-enabled
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, enabled: boolean }
// Returns: { showcase } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { checkBreederPlusAccess, loadOwnedLitter, loadOwnedShowcase, readShowcaseForResponse } from './_lib/showcase-access.js'

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
  const { litterId, enabled } = body
  if (!litterId || typeof litterId !== 'string') {
    throw new ApiError(400, 'litterId is required')
  }
  if (typeof enabled !== 'boolean') {
    throw new ApiError(400, 'enabled must be a boolean')
  }

  const db = getFirestore()
  const showcaseRef = db.collection('litterShowcases').doc(litterId)

  const result = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(db.collection('users').doc(uid))
    const profile = userSnap.exists ? userSnap.data() : {}
    const accessError = checkBreederPlusAccess(profile)
    if (accessError) return accessError

    const { error: litterError } = await loadOwnedLitter(tx, db, litterId, uid)
    if (litterError) return litterError

    const { error: showcaseError } = await loadOwnedShowcase(tx, db, litterId, uid)
    if (showcaseError) return showcaseError

    // Codex fix-round finding 1: updatedAt is a trusted Firestore server
    // timestamp — see readShowcaseForResponse (showcase-access.js).
    tx.update(showcaseRef, { enabled, updatedAt: FieldValue.serverTimestamp() })
    return { ok: true }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  const showcase = await readShowcaseForResponse(db, litterId)
  return res.status(200).json({ showcase })
}

export default withApiErrorHandling('set-showcase-enabled', handler)
