// api/create-showcase.js — trusted server-side creation of a Litter
// Showcase (iDogs Litter Showcase MVP, Slice 1).
//
// WHY THIS EXISTS: mirrors this codebase's established pattern for
// litters/heat-cycles/puppies — a write firestore.rules cannot safely
// validate on its own (here: "does litterId actually belong to this
// caller", "does a Showcase for this litter already exist", "one
// Showcase per litter") moves to a trusted Admin SDK endpoint.
// firestore.rules denies all direct client writes to litterShowcases/{id}
// outright (see that collection's rules comment) — this endpoint, plus
// set-showcase-enabled.js / update-showcase-puppy.js /
// bulk-update-showcase-puppies.js, are the only paths.
//
// Document id == litterId, which is what makes "one Showcase per
// litter" (Slice 1 requirement 1) structural rather than a query-based
// check: a second create attempt for the same litter simply finds the
// doc already exists and fails closed.
//
// A freshly created Showcase always starts disabled with an empty
// puppies map — Slice 1 requirement 2 ("a new... Showcase shows zero
// puppies by default") holds trivially, since nothing has visible:true.
//
// POST /api/create-showcase
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { litterId }
// Returns: { showcase } | { error, reason? }

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import { checkBreederPlusAccess, loadOwnedLitter } from './_lib/showcase-access.js'

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

  const db = getFirestore()
  const showcaseRef = db.collection('litterShowcases').doc(litterId)

  const result = await db.runTransaction(async (tx) => {
    // Reads must precede writes in a transaction.
    const userSnap = await tx.get(db.collection('users').doc(uid))
    const profile = userSnap.exists ? userSnap.data() : {}
    const accessError = checkBreederPlusAccess(profile)
    if (accessError) return accessError

    const { litter, error: litterError } = await loadOwnedLitter(tx, db, litterId, uid)
    if (litterError) return litterError
    void litter

    const existingSnap = await tx.get(showcaseRef)
    if (existingSnap.exists) {
      return { ok: false, status: 409, body: { error: 'A Showcase already exists for this litter', reason: 'SHOWCASE_ALREADY_EXISTS' } }
    }

    const nowIso = new Date().toISOString()
    const data = {
      litterId,
      tenantId: uid,
      enabled: false,
      puppies: {},
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    tx.set(showcaseRef, data)
    return { ok: true, showcase: data }
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }
  return res.status(200).json({ showcase: result.showcase })
}

export default withApiErrorHandling('create-showcase', handler)
