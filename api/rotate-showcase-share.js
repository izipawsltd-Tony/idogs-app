// api/rotate-showcase-share.js — trusted server-side generation of a
// NEW public share link for a Litter Showcase (Slice 2).
//
// "Rotate" always mints a brand-new random token and immediately
// invalidates whatever link existed before (the old token's hash is
// overwritten, so a lookup by the old raw token no longer matches
// anything) — this is the ONLY way a breeder gets a working link at
// all, and the ONLY way to definitively revoke a previously-shared URL
// (as opposed to api/update-showcase-share.js's `shareEnabled: false`,
// which pauses the CURRENT link without invalidating it). Sets
// shareEnabled: true as part of the same write, so a single "Get share
// link" action in the UI is enough — no separate enable step needed.
//
// The raw token is returned in this response ONLY — it is never
// persisted (see api/_lib/showcase-share.js), so if the caller loses it
// without saving the link, the only recovery is to rotate again.
//
// POST /api/rotate-showcase-share
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId, shareExpiresAt?: string | null }
// Returns: { showcase, shareToken } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { checkBreederPlusAccess, loadOwnedLitter, loadOwnedShowcase, readShowcaseForResponse } from './_lib/showcase-access.js'
import { generateShareToken, hashShareToken, isValidExpiryIso } from './_lib/showcase-share.js'

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
  // Optional: null/absent means "no expiry". A present-but-invalid value
  // (unparseable, or unreasonably far in the future) is rejected outright
  // rather than silently clamped or ignored — the caller asked for a
  // specific expiry and deserves to know it wasn't accepted.
  let shareExpiresAt = null
  if (body.shareExpiresAt !== undefined && body.shareExpiresAt !== null) {
    if (!isValidExpiryIso(body.shareExpiresAt)) {
      throw new ApiError(400, 'shareExpiresAt must be a valid date no more than 2 years in the future')
    }
    shareExpiresAt = new Date(body.shareExpiresAt).toISOString()
  }

  const db = getFirestore()
  const showcaseRef = db.collection('litterShowcases').doc(litterId)
  const rawToken = generateShareToken()
  const tokenHash = hashShareToken(rawToken)

  const result = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(db.collection('users').doc(uid))
    const profile = userSnap.exists ? userSnap.data() : {}
    const accessError = checkBreederPlusAccess(profile)
    if (accessError) return accessError

    const { error: litterError } = await loadOwnedLitter(tx, db, litterId, uid)
    if (litterError) return litterError

    const { error: showcaseError } = await loadOwnedShowcase(tx, db, litterId, uid)
    if (showcaseError) return showcaseError

    tx.update(showcaseRef, {
      shareTokenHash: tokenHash,
      shareEnabled: true,
      shareRotatedAt: FieldValue.serverTimestamp(),
      shareExpiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { ok: true }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  const showcase = await readShowcaseForResponse(db, litterId)
  return res.status(200).json({ showcase, shareToken: rawToken })
}

export default withApiErrorHandling('rotate-showcase-share', handler)
