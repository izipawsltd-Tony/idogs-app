// api/manage-puppy-share-grant.js — breeder-authed lifecycle management
// for one Private Puppy Update Link grant: pause, resume, revoke, reset,
// copy/share, or metadata update.
//
// Every action re-derives authorization from the grant document itself
// (grant.ownerId === uid) — never from the request body, which carries
// no ownerId field at all. Every write targets exactly ONE grant
// document, inside a single Firestore transaction — never any other
// grant, dog, litterShowcases, or dogPrivateAccess document.
//
// POST /api/manage-puppy-share-grant
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { grantId: string, action: 'pause'|'resume'|'revoke'|'reset'|'copy'|'updateMetadata' }
// Returns: { grant, shareToken? } | { error, reason? }
// shareToken is present for reset (new random token) and copy (stable
// derived alias). Neither raw token is ever persisted.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { ApiError, parseJsonBody, withApiErrorHandling } from './_lib/http-helpers.js'
import {
  generateShareToken, hashShareToken, isValidExpiryIso, cleanCustomerLabel,
  serializeGrant, deriveCopyShareToken,
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

const ACTIONS = ['pause', 'resume', 'revoke', 'reset', 'copy', 'updateMetadata']

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
  const { grantId, action } = body
  if (!grantId || typeof grantId !== 'string') {
    throw new ApiError(400, 'grantId is required')
  }
  if (!ACTIONS.includes(action)) {
    throw new ApiError(400, 'Invalid action')
  }

  const db = getFirestore()
  const grantRef = db.collection('puppyShareGrants').doc(grantId)

  // Reset is the only action that creates a new random token and replaces
  // tokenHash. Copy never mutates tokenHash; it derives a stable alias
  // from the current tokenHash + grant id, so the original customer link
  // remains valid and the same copy/share URL can be reproduced later.
  const rawResetToken = action === 'reset' ? generateShareToken() : null
  const resetTokenHash = rawResetToken ? hashShareToken(rawResetToken) : null

  // updateMetadata: parsed and validated BEFORE the transaction opens —
  // same "fail fast on bad input before any Firestore work" posture as
  // api/create-puppy-share-grant.js's own puppyIds/expiresAt validation.
  let metadataUpdate = null
  if (action === 'updateMetadata') {
    const hasCustomerLabel = body.customerLabel !== undefined
    const hasExpiresAt = body.expiresAt !== undefined
    if (!hasCustomerLabel && !hasExpiresAt) {
      throw new ApiError(400, 'updateMetadata requires customerLabel or expiresAt')
    }

    metadataUpdate = {}

    if (hasCustomerLabel) {
      metadataUpdate.customerLabel = cleanCustomerLabel(body.customerLabel)
    }

    if (hasExpiresAt) {
      if (body.expiresAt === null) {
        metadataUpdate.expiresAt = null
      } else {
        if (!isValidExpiryIso(body.expiresAt)) {
          throw new ApiError(400, 'expiresAt must be a valid date no more than 2 years in the future')
        }
        const parsedExpiresAt = new Date(body.expiresAt)
        if (parsedExpiresAt.getTime() <= Date.now()) {
          throw new ApiError(400, 'expiresAt must be in the future')
        }
        metadataUpdate.expiresAt = parsedExpiresAt.toISOString()
      }
    }
  }

  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(grantRef)
    if (!snap.exists) {
      return { status: 404, error: 'Grant not found' }
    }
    const grant = snap.data()
    if (grant.ownerId !== uid) {
      return { status: 403, error: 'Not authorized' }
    }

    if (action === 'revoke') {
      if (grant.status !== 'revoked') {
        tx.update(grantRef, { status: 'revoked', updatedAt: FieldValue.serverTimestamp() })
      }
      return { status: 200 }
    }

    // Revoked is terminal for every other action — a dead grant cannot
    // be copied, paused, resumed, reset, or edited.
    if (grant.status === 'revoked') {
      return { status: 409, error: 'This grant has been revoked and cannot be modified', reason: 'GRANT_REVOKED' }
    }

    if (action === 'copy') {
      const shareToken = deriveCopyShareToken(grantId, grant.tokenHash)
      if (!shareToken) {
        return { status: 500, error: 'Unable to create share link' }
      }
      return { status: 200, shareToken }
    }

    if (action === 'pause') {
      tx.update(grantRef, { status: 'paused', updatedAt: FieldValue.serverTimestamp() })
      return { status: 200 }
    }

    if (action === 'resume') {
      tx.update(grantRef, { status: 'active', updatedAt: FieldValue.serverTimestamp() })
      return { status: 200 }
    }

    if (action === 'reset') {
      tx.update(grantRef, {
        tokenHash: resetTokenHash,
        lastResetAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { status: 200 }
    }

    // action === 'updateMetadata'
    tx.update(grantRef, { ...metadataUpdate, updatedAt: FieldValue.serverTimestamp() })
    return { status: 200 }
  })

  if (result.error) {
    throw new ApiError(result.status, result.error, result.reason ? { reason: result.reason } : {})
  }

  const grantSnap = await grantRef.get()
  const response = { grant: serializeGrant(grantRef.id, grantSnap.data()) }
  if (action === 'copy' && result.shareToken) {
    response.shareToken = result.shareToken
  } else if (rawResetToken) {
    response.shareToken = rawResetToken
  }
  return res.status(200).json(response)
}

export default withApiErrorHandling('manage-puppy-share-grant', handler)
