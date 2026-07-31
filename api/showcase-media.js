// api/showcase-media.js — server-mediated, per-request-revalidated
// public media delivery (Codex re-review: "server-mediated public media
// delivery" — the one remaining blocker from the prior fix-round).
//
// WHY THIS EXISTS: api/showcase-public.js used to embed a 15-minute
// Google Cloud Storage signed URL directly in its JSON response. Once
// issued, that URL kept working for its full 15 minutes REGARDLESS of
// anything the breeder did afterward — disabling the Showcase, rotating
// or letting the share expire, hiding the puppy, unpublishing that exact
// photo, or losing Plus eligibility could not reach a URL that had
// ALREADY been handed to a browser. api/showcase-public.js no longer
// returns a Storage URL at all — every photo/video it lists is a link
// to THIS endpoint instead (see that file's own publicPuppyProjection).
//
// Every single request here re-runs the ENTIRE authorization chain from
// scratch — share token → live/enabled/not-expired → tenant currently
// Plus-eligible → Litter belongs to the same tenant → puppy resolves
// from the opaque ref AND is currently visible AND belongs to the same
// tenant/litter → the requested media id is in that puppy's CURRENT
// publishedPhotoIds/publishedVideoIds → the Storage object still exists.
// There is no cached "was this valid a moment ago" shortcut anywhere in
// this path — it is the exact same set of reads api/showcase-public.js
// and api/create-showcase-enquiry.js each do independently, not a value
// carried over from either of them.
//
// GUARANTEE (tested end-to-end in scripts/test-showcase-media-delivery.mjs):
// the NEXT request to THIS endpoint, made at any point after disable,
// rotate, expiry, unpublish, hide, or downgrade, is denied immediately —
// nothing here is ever cached across requests. What this endpoint cannot
// retroactively undo is a REDIRECT TARGET already resolved and in flight
// to a browser at the exact moment of revocation: that one short-lived
// (SHORT_LIVED_REDIRECT_TTL_MS — 60 seconds, not 15 minutes) signed URL
// keeps working for the remainder of its own brief TTL, exactly like any
// bearer credential already handed out cannot be un-handed. This
// file does not claim — and is not tested to claim — that an
// ALREADY-ISSUED redirect target is instantaneously killed; it claims,
// and IS tested to prove, that no NEW one can ever be minted once any
// part of the chain above has been revoked.
//
// GET /api/showcase-media?token=...&puppyRef=...&mediaId=...&kind=photo|video
// Returns: 302 redirect to a 60-second signed URL | 404 | 429 | 400

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { getClientIp, hashClientKey } from './_lib/rate-limit.js'
import { checkDurableRateLimit } from './_lib/durable-rate-limit.js'
import { hashShareToken, isShareLive, isTenantPlusEligible } from './_lib/showcase-share.js'
import { resolveVisiblePuppyByRef, signMediaItems, SHORT_LIVED_REDIRECT_TTL_MS } from './_lib/showcase-media-access.js'

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

// Deliberately more generous than api/showcase-public.js's own default
// (30/60s) — ONE page load of a showcase with several photos/videos
// hits THIS endpoint once per media item, not once total, so a limit
// tuned for "one page view" would exhaust itself on a single legitimate
// visitor with a 4-5 photo puppy.
const MEDIA_RATE_LIMIT_WINDOW_MS = Number(process.env.SHOWCASE_MEDIA_RATE_LIMIT_WINDOW_MS) || 60_000
const MEDIA_RATE_LIMIT_MAX_REQUESTS = Number(process.env.SHOWCASE_MEDIA_RATE_LIMIT_MAX_REQUESTS) || 90

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('showcase-media', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  // Rate limit first, before any other validation or lookup — same
  // posture as every other public endpoint in this codebase. Namespaced
  // ('showcase-media') so this endpoint's own (higher-volume) traffic
  // never shares a budget with api/showcase-public.js or
  // api/create-showcase-enquiry.js. Durable/atomic (Firestore-
  // transaction-backed) — see api/_lib/durable-rate-limit.js.
  const clientKey = hashClientKey(getClientIp(req))
  const rateLimitResult = await checkDurableRateLimit(
    db,
    'showcase-media',
    clientKey,
    MEDIA_RATE_LIMIT_WINDOW_MS,
    MEDIA_RATE_LIMIT_MAX_REQUESTS
  )
  if (!rateLimitResult.allowed) {
    res.setHeader('Retry-After', String(rateLimitResult.retryAfterSeconds))
    return res.status(429).json({ error: 'Too many requests' })
  }

  const { token, puppyRef, mediaId, kind } = req.query
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token required' })
  }
  if (!puppyRef || typeof puppyRef !== 'string') {
    return res.status(400).json({ error: 'puppyRef required' })
  }
  if (!mediaId || typeof mediaId !== 'string') {
    return res.status(400).json({ error: 'mediaId required' })
  }
  if (kind !== 'photo' && kind !== 'video') {
    return res.status(400).json({ error: "kind must be 'photo' or 'video'" })
  }

  try {
    // ── Re-derive EVERYTHING from scratch — see this file's own header
    // comment. Nothing below trusts a prior request's outcome. ──
    const tokenHash = hashShareToken(token)
    const showcaseSnap = await db.collection('litterShowcases')
      .where('shareTokenHash', '==', tokenHash)
      .limit(1)
      .get()
    if (showcaseSnap.empty) {
      return res.status(404).json({ error: 'Not found' })
    }
    const showcaseDoc = showcaseSnap.docs[0]
    const showcase = showcaseDoc.data()

    // Disable / pause-share / expiry — all three collapse into this one
    // check, re-evaluated fresh on every request.
    if (!isShareLive(showcase)) {
      return res.status(404).json({ error: 'Not found' })
    }

    if (!showcase.tenantId || typeof showcase.tenantId !== 'string') {
      return res.status(404).json({ error: 'Not found' })
    }

    // Downgrade — a fresh users/{tenantId} read, never a cached profile.
    const profileSnap = await db.collection('users').doc(showcase.tenantId).get()
    if (!isTenantPlusEligible(profileSnap.exists ? profileSnap.data() : null)) {
      return res.status(404).json({ error: 'Not found' })
    }

    const litterId = showcaseDoc.id
    const litterSnap = await db.collection('litters').doc(litterId).get()
    if (!litterSnap.exists || litterSnap.data().tenantId !== showcase.tenantId) {
      return res.status(404).json({ error: 'Not found' })
    }

    // Hide (visible:false) + tenant/litter-chain drift — both collapse
    // into resolveVisiblePuppyByRef() returning null (see that
    // function's own comment, shared with api/create-showcase-enquiry.js).
    const resolved = await resolveVisiblePuppyByRef(db, showcase, litterId, puppyRef)
    if (!resolved) {
      return res.status(404).json({ error: 'Not found' })
    }
    const { dog, entry } = resolved

    // Unpublish — the requested media id must be in the puppy's CURRENT
    // publication list for the requested kind, re-read fresh every time.
    const publishedIds = kind === 'photo'
      ? (Array.isArray(entry.publishedPhotoIds) ? entry.publishedPhotoIds : [])
      : (Array.isArray(entry.publishedVideoIds) ? entry.publishedVideoIds : [])
    if (!publishedIds.includes(mediaId)) {
      return res.status(404).json({ error: 'Not found' })
    }

    const gallery = kind === 'photo' ? (dog.photos || []) : (dog.videos || [])
    const mediaItem = gallery.find(item => item?.id === mediaId)
    if (!mediaItem) {
      return res.status(404).json({ error: 'Not found' })
    }

    const bucket = getStorage().bucket(bucketName)
    const [signed] = await signMediaItems(bucket, [mediaItem], SHORT_LIVED_REDIRECT_TTL_MS)
    if (!signed) {
      // Storage object no longer exists (deleted, or a data-integrity
      // edge case) — same generic 404 as every other denial.
      return res.status(404).json({ error: 'Not found' })
    }

    // A short-lived redirect (not a stream) — GCS signed URLs support
    // HTTP range requests natively, which real video playback/seeking
    // needs; proxying bytes through this serverless function would mean
    // re-implementing Range-header passthrough for files up to 30-50MB
    // (see api/_lib/image-pipeline.js's own MAX_IMAGE_INPUT_BYTES/
    // MAX_VIDEO_INPUT_BYTES) with real risk of exceeding a serverless
    // function's execution-time budget on a slow connection. The
    // SHORT_LIVED_REDIRECT_TTL_MS window (60s, freshly minted on every
    // request, never the 15-minute breeder-authenticated TTL) is what
    // keeps this safe despite handing out a real Storage URL for that
    // brief moment — see this file's own header "GUARANTEE" paragraph.
    res.setHeader('Cache-Control', 'no-store')
    return res.redirect(302, signed.url)
  } catch (err) {
    console.error('showcase-media lookup error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
