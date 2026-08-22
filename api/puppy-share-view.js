// api/puppy-share-view.js — public, unauthenticated read for a Private
// Puppy Update Link (Phase 1: photos + videos only, no documents).
//
// Same trust posture as api/showcase-public.js: no login, token-only,
// rate-limited before any Firestore read, and an explicit server-side
// field allowlist — never a raw Dog document. Lookup is by TOKEN ONLY;
// no dogId/grantId/ownerId/email is ever accepted as a request parameter
// and none authorizes anything on its own. The token is read from the
// POST body only — never a query string or path segment — so it never
// lands in server access logs or browser history the way a GET ?token=
// would.
//
// Every failure mode — malformed token, no match, paused, revoked,
// expired, or every referenced puppy no longer belonging to the grant's
// owner — returns the SAME generic { error: 'unavailable' } / 404. This
// is deliberate: a caller must never be able to distinguish "this link
// never existed" from "it used to work" from "it's paused" from "the
// puppy already sold" — same posture this codebase already applies to
// every other public, token-gated endpoint (see api/showcase-public.js's
// own header comment).
//
// Runtime ownership re-verification (step 8 below) is MANDATORY and is
// re-run on every single request from the live dogs/{id} documents —
// never from any value cached on the grant at creation time. A puppy
// that has since been transferred/claimed to a different owner is
// silently omitted from the response, never surfaced as a distinguishing
// error — the SAME "one bad puppy doesn't break the others" posture
// api/showcase-public.js already documents for its own puppy list.
//
// POST /api/puppy-share-view
// Body: { token: string }
// Returns: { puppies: [...] } | { error: 'unavailable' } (404) | { error } (429/405/500)

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { getClientIp, hashClientKey } from './_lib/rate-limit.js'
import { checkDurableRateLimit } from './_lib/durable-rate-limit.js'
import { requireStorageBucket } from './_lib/require-config.js'
import { signMediaItems } from './_lib/showcase-media-access.js'
import { hashShareToken, effectiveOwnerId, isPlausibleShareToken } from './_lib/puppy-share-grants.js'

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

// Same 5-minute posture as api/private-dog-view.js's own PRIVATE_URL_TTL_MS
// — short-lived enough that a leaked/cached link URL doesn't stay useful,
// long enough for one page load's worth of media to actually render.
const PRIVATE_URL_TTL_MS = 5 * 60 * 1000

// Own, separately-namespaced rate limit budget — cannot be starved by,
// or starve, api/create-showcase-enquiry.js's or any other public
// endpoint's own budget.
const VIEW_RATE_LIMIT_WINDOW_MS = Number(process.env.PUPPY_SHARE_VIEW_RATE_LIMIT_WINDOW_MS) || 10 * 60_000
const VIEW_RATE_LIMIT_MAX_REQUESTS = Number(process.env.PUPPY_SHARE_VIEW_RATE_LIMIT_MAX_REQUESTS) || 30

function unavailable(res) {
  return res.status(404).json({ error: 'unavailable' })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit first, before any other work.
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

  // 1. Format-check BEFORE any logging or lookup. Never log `token`
  // itself anywhere in this file, in success or failure — only fixed
  // labels/codes, same posture as api/_lib/http-helpers.js's
  // logSanitizedError().
  if (!isPlausibleShareToken(token)) {
    return unavailable(res)
  }

  try {
    // 2. Hash.
    const tokenHash = hashShareToken(token)

    // 3-4. Look up by hash. limit(2), not limit(1): fail closed on BOTH
    // zero AND multiple matches — a duplicate tokenHash would be a
    // data-integrity anomaly (cryptographically implausible given a
    // 256-bit CSPRNG token) and must never be resolved by arbitrarily
    // picking snap.docs[0].
    const grantSnap = await db.collection('puppyShareGrants')
      .where('tokenHash', '==', tokenHash)
      .limit(2)
      .get()
    if (grantSnap.size !== 1) {
      return unavailable(res)
    }
    const grant = grantSnap.docs[0].data()

    // 5. Status must be active — paused and revoked are indistinguishable.
    if (grant.status !== 'active') {
      return unavailable(res)
    }

    // 6. Expiry, only when set.
    if (grant.expiresAt) {
      const expiry = new Date(grant.expiresAt)
      if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        return unavailable(res)
      }
    }

    // 7. Load every referenced puppy in one batch — no query, no index.
    const puppyIds = Array.isArray(grant.puppyIds) ? grant.puppyIds : []
    if (puppyIds.length === 0) {
      return unavailable(res)
    }
    const dogSnaps = await db.getAll(...puppyIds.map(id => db.collection('dogs').doc(id)))

    // 8-9. LIVE ownership re-check per puppy, every request. Missing or
    // ownership-mismatched puppies are silently dropped, never a
    // distinguishing error for that one puppy.
    const validDogs = dogSnaps
      .filter(snap => snap.exists)
      .map(snap => ({ id: snap.id, ...snap.data() }))
      .filter(dog => effectiveOwnerId(dog) === grant.ownerId)

    // 10. Nothing left -> generic unavailable, same shape as every other
    // failure mode above.
    if (validDogs.length === 0) {
      return unavailable(res)
    }

    // 11. Allowlisted projection only — mirrors api/private-dog-view.js's
    // own field list. Media via the SAME signMediaItems() helper and the
    // SAME short-lived TTL posture that feature already established —
    // reused unmodified, not reimplemented.
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

    // 12. Response never includes: tokenHash, grant.ownerId, grant id,
    // customerLabel, litterId, sibling puppies outside this grant's
    // puppyIds, raw Storage paths, documents, or any note/internal
    // field.
    return res.status(200).json({ puppies })
  } catch (err) {
    console.error('puppy-share-view error:', { code: 'PUPPY_SHARE_VIEW_FAILED' })
    return res.status(500).json({ error: 'Internal error' })
  }
}
