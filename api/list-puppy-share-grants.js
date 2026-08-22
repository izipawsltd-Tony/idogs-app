// api/list-puppy-share-grants.js — breeder-authed read of the caller's
// own Private Puppy Update Link grants, either all of them or filtered
// to grants covering one specific puppy. Never returns tokenHash. Never
// accepts an ownerId from the caller — always the verified token's own
// uid.
//
// GET /api/list-puppy-share-grants
// GET /api/list-puppy-share-grants?puppyId=<dogId>
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { grants: [...] } | { error }
//
// Exactly one where() clause per query branch, no orderBy() — status/
// date filtering (if a caller ever needs it) happens in application code
// after the fetch, never as a second Firestore condition, so no
// composite index is ever required for this endpoint.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError, withApiErrorHandling } from './_lib/http-helpers.js'
import { effectiveOwnerId, serializeGrant } from './_lib/puppy-share-grants.js'

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
  if (req.method !== 'GET') {
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

  const db = getFirestore()
  const puppyId = typeof req.query?.puppyId === 'string' ? req.query.puppyId : null

  let snap
  if (puppyId) {
    // Ownership is checked BEFORE the grants query — a non-owner cannot
    // learn whether a grant exists for a puppy they don't own, even
    // indirectly via an empty-array-vs-403 response difference.
    const dogSnap = await db.collection('dogs').doc(puppyId).get()
    if (!dogSnap.exists) {
      throw new ApiError(404, 'Puppy not found')
    }
    if (effectiveOwnerId({ id: dogSnap.id, ...dogSnap.data() }) !== uid) {
      throw new ApiError(403, 'Not authorized')
    }
    snap = await db.collection('puppyShareGrants')
      .where('puppyIds', 'array-contains', puppyId)
      .limit(200)
      .get()
  } else {
    snap = await db.collection('puppyShareGrants')
      .where('ownerId', '==', uid)
      .limit(200)
      .get()
  }

  const grants = snap.docs
    .map(doc => ({ id: doc.id, data: doc.data() }))
    // Defence in depth: the array-contains branch above is already
    // scoped to a puppy this caller just proved they own, but re-assert
    // ownerId here too rather than trusting the query alone.
    .filter(({ data }) => data.ownerId === uid)
    .map(({ id, data }) => serializeGrant(id, data))

  return res.status(200).json({ grants })
}

export default withApiErrorHandling('list-puppy-share-grants', handler)
