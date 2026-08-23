// api/puppy-share-view.js — public, unauthenticated read for a Private
// Puppy Update Link (Phase 1: photos + videos only, no documents).
//
// Same trust posture as api/showcase-public.js: no login, token-only,
// rate-limited before any Firestore read, and an explicit server-side
// field allowlist — never a raw Dog document.
//
// Two token forms are supported:
// 1) the original random token, looked up by sha256(token) == tokenHash;
// 2) a breeder-authenticated recoverable alias, which carries only an
//    opaque grant id plus an HMAC derived from the server-only tokenHash.
//    The alias lets the breeder Copy/Share the link again after reload or
//    on another device without storing any raw token and without breaking
//    the original customer link.
//
// Every failure mode — malformed token, no match, bad alias signature,
// paused, revoked, expired, or every referenced puppy no longer belonging
// to the grant's owner — returns the SAME generic unavailable/404.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { getClientIp, hashClientKey } from './_lib/rate-limit.js'
import { checkDurableRateLimit } from './_lib/durable-rate-limit.js'
import { requireStorageBucket } from './_lib/require-config.js'
import { signMediaItems } from './_lib/showcase-media-access.js'
import {
  hashShareToken, effectiveOwnerId, isPlausibleShareToken,
  parseCopyShareToken, verifyCopyShareToken,
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

const db = getFirestore()
const PRIVATE_URL_TTL_MS = 5 * 60 * 1000
const VIEW_RATE_LIMIT_WINDOW_MS = Number(process.env.PUPPY_SHARE_VIEW_RATE_LIMIT_WINDOW_MS) || 10 * 60_000
const VIEW_RATE_LIMIT_MAX_REQUESTS = Number(process.env.PUPPY_SHARE_VIEW_RATE_LIMIT_MAX_REQUESTS) || 30

function unavailable(res) {
  return res.status(404).json({ error: 'unavailable' })
}

async function loadGrantByToken(token) {
  const copyToken = parseCopyShareToken(token)
  if (copyToken) {
    const grantDoc = await db.collection('puppyShareGrants').doc(copyToken.grantId).get()
    if (!grantDoc.exists) return null
    const grant = grantDoc.data()
    if (verifyCopyShareToken(token, grant.tokenHash) !== grantDoc.id) return null
    return { id: grantDoc.id, data: grant }
  }

  const tokenHash = hashShareToken(token)
  const grantSnap = await db.collection('puppyShareGrants')
    .where('tokenHash', '==', tokenHash)
    .limit(2)
    .get()
  if (grantSnap.size !== 1) return null
  return { id: grantSnap.docs[0].id, data: grantSnap.docs[0].data() }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const clientKey = hashClientKey(getClientIp(req))
  const rateLimitResult = await checkDurableRateLimit(
    db,
    'puppy-share-view',
    clientKey,
    VIEW_RATE_LIMIT_WINDOW_MS,
    VIEW_RATE_LIMIT_MAX_REQUESTS
  )
  if (!rateLimitResult.allowed) {
    res.setHeader('Retry-After', String(rateLimitResult.retryAfterSeconds))
    return res.status(429).json({ error: 'Too many requests' })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const token = body.token
  if (!isPlausibleShareToken(token)) {
    return unavailable(res)
  }

  try {
    const loadedGrant = await loadGrantByToken(token)
    if (!loadedGrant) {
      return unavailable(res)
    }
    const grant = loadedGrant.data

    if (grant.status !== 'active') {
      return unavailable(res)
    }

    if (grant.expiresAt) {
      const expiry = new Date(grant.expiresAt)
      if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        return unavailable(res)
      }
    }

    const puppyIds = Array.isArray(grant.puppyIds) ? grant.puppyIds : []
    if (puppyIds.length === 0) {
      return unavailable(res)
    }
    const dogSnaps = await db.getAll(...puppyIds.map(id => db.collection('dogs').doc(id)))

    const validDogs = dogSnaps
      .filter(snap => snap.exists)
      .map(snap => ({ id: snap.id, ...snap.data() }))
      .filter(dog => effectiveOwnerId(dog) === grant.ownerId)

    if (validDogs.length === 0) {
      return unavailable(res)
    }

    const bucketName = requireStorageBucket()
    if (!bucketName) {
      throw new Error('Storage bucket not configured')
    }
    const bucket = getStorage().bucket(bucketName)

    const puppies = await Promise.all(validDogs.map(async dog => {
      const [photos, videos] = await Promise.all([
        signMediaItems(bucket, dog.photos || [], PRIVATE_URL_TTL_MS),
        signMediaItems(bucket, dog.videos || [], PRIVATE_URL_TTL_MS),
      ])
      return {
        id: dog.id,
        name: dog.name,
        breed: dog.breed,
        sex: dog.sex,
        colour: dog.colour || null,
        dateOfBirth: dog.dateOfBirth || null,
        photos,
        videos,
      }
    }))

    return res.status(200).json({ puppies })
  } catch (err) {
    console.error('puppy-share-view error:', { code: 'PUPPY_SHARE_VIEW_FAILED' })
    return res.status(500).json({ error: 'Internal error' })
  }
}
