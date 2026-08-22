// api/create-puppy-share-grant.js — breeder-authed creation of a new
// Private Puppy Update Link grant covering 1-2 puppies (Private Puppy
// Update Links, Phase 1 backend).
//
// No login is required for a buyer to VIEW a grant (see
// api/puppy-share-view.js) — but only an authenticated breeder who
// currently owns EVERY selected puppy may create one. ownerId is always
// the verified token's own uid; the request body carries no ownerId
// field at all.
//
// Deliberately independent of dogPrivateAccess (the existing, unmodified,
// post-deposit/email+login buyer-access feature) and of litterShowcases
// (the existing, unmodified, public Litter Showcase share link) — this
// endpoint writes to neither collection and imports only their already-
// exported pure helpers via api/_lib/puppy-share-grants.js.
//
// POST /api/create-puppy-share-grant
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { puppyIds: string[] (1-2, unique), customerLabel?: string, expiresAt?: string|null }
// Returns: { grant, shareToken } | { error }
// shareToken is the RAW token, returned exactly once — only its sha256
// hash is ever persisted.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import {
  generateShareToken, hashShareToken, isValidExpiryIso,
  effectiveOwnerId, cleanCustomerLabel, validatePuppyIds, serializeGrant,
} from './_lib/puppy-share-grants.js'

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

  const puppyIds = validatePuppyIds(body.puppyIds)
  if (!puppyIds) {
    throw new ApiError(400, 'puppyIds must be an array of 1-2 unique puppy ids')
  }

  const customerLabel = cleanCustomerLabel(body.customerLabel)

  // Optional: null/absent means "no expiry" (the default). A
  // present-but-invalid value is rejected outright rather than silently
  // clamped or ignored — same posture as api/rotate-showcase-share.js's
  // own shareExpiresAt handling.
  let expiresAt = null
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (!isValidExpiryIso(body.expiresAt)) {
      throw new ApiError(400, 'expiresAt must be a valid date no more than 2 years in the future')
    }
    expiresAt = new Date(body.expiresAt).toISOString()
  }

  const db = getFirestore()
  const grantRef = db.collection('puppyShareGrants').doc()
  const rawToken = generateShareToken()
  const tokenHash = hashShareToken(rawToken)

  const dogRefs = puppyIds.map(id => db.collection('dogs').doc(id))

  // Firestore transaction, mirroring api/rotate-showcase-share.js's own
  // shape: all reads before any write, an internal {status,error} result
  // object instead of throwing from inside the transaction callback, and
  // exactly one document written on success.
  const result = await db.runTransaction(async tx => {
    const dogSnaps = await tx.getAll(...dogRefs)

    for (const snap of dogSnaps) {
      if (!snap.exists) {
        return { status: 404, error: 'One or more selected puppies were not found' }
      }
    }

    const dogs = dogSnaps.map(snap => ({ id: snap.id, ...snap.data() }))
    const ownsEveryPuppy = dogs.every(dog => effectiveOwnerId(dog) === uid)
    if (!ownsEveryPuppy) {
      // Single generic message — never reveals WHICH puppy failed the
      // ownership check.
      return { status: 403, error: 'Not authorized for one or more selected puppies' }
    }

    tx.set(grantRef, {
      ownerId: uid,
      puppyIds,
      customerLabel,
      tokenHash,
      status: 'active',
      expiresAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastResetAt: null,
    })
    return { status: 200 }
  })

  if (result.error) {
    throw new ApiError(result.status, result.error)
  }

  const grantSnap = await grantRef.get()
  return res.status(200).json({
    grant: serializeGrant(grantRef.id, grantSnap.data()),
    shareToken: rawToken,
  })
}

export default withApiErrorHandling('create-puppy-share-grant', handler)
