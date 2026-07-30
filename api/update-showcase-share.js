// api/update-showcase-share.js — trusted server-side toggle for an
// EXISTING Litter Showcase share link (Slice 2): pause/resume public
// access, or change its expiry, WITHOUT rotating the token itself — the
// same shared URL keeps working once re-enabled. Use
// api/rotate-showcase-share.js instead to definitively invalidate the
// current link and mint a new one.
//
// Requires a token to already exist (i.e. rotate must have been called
// at least once) — there's nothing to enable/disable/expire otherwise.
//
// POST /api/update-showcase-share
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, shareEnabled?: boolean, shareExpiresAt?: string | null }
//   At least one of shareEnabled/shareExpiresAt must be present.
// Returns: { showcase } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { checkBreederPlusAccess, loadOwnedLitter, loadOwnedShowcase, readShowcaseForResponse } from './_lib/showcase-access.js'
import { isValidExpiryIso } from './_lib/showcase-share.js'

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
  const { litterId } = body
  if (!litterId || typeof litterId !== 'string') {
    throw new ApiError(400, 'litterId is required')
  }

  const hasEnabledPatch = typeof body.shareEnabled === 'boolean'
  const hasExpiryPatch = body.shareExpiresAt !== undefined
  if (!hasEnabledPatch && !hasExpiryPatch) {
    throw new ApiError(400, 'shareEnabled or shareExpiresAt is required')
  }

  let shareExpiresAt
  if (hasExpiryPatch) {
    if (body.shareExpiresAt === null) {
      shareExpiresAt = null
    } else if (isValidExpiryIso(body.shareExpiresAt)) {
      shareExpiresAt = new Date(body.shareExpiresAt).toISOString()
    } else {
      throw new ApiError(400, 'shareExpiresAt must be a valid date no more than 2 years in the future, or null')
    }
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

    const { showcase, error: showcaseError } = await loadOwnedShowcase(tx, db, litterId, uid)
    if (showcaseError) return showcaseError

    if (!showcase.shareTokenHash) {
      return { ok: false, status: 409, body: { error: 'No share link exists yet — rotate one first', reason: 'SHARE_NOT_ROTATED_YET' } }
    }

    const patch = { updatedAt: FieldValue.serverTimestamp() }
    if (hasEnabledPatch) patch.shareEnabled = body.shareEnabled
    if (hasExpiryPatch) patch.shareExpiresAt = shareExpiresAt
    tx.update(showcaseRef, patch)
    return { ok: true }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  const showcase = await readShowcaseForResponse(db, litterId)
  return res.status(200).json({ showcase })
}

export default withApiErrorHandling('update-showcase-share', handler)
