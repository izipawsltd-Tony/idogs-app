// api/showcase-public.js — public, unauthenticated Litter Showcase read
// (Slice 2). Mirrors api/passport.js's established shape for this
// codebase's "no-login, token-based, allowlisted-projection" pattern:
// Admin SDK (bypasses firestore.rules — the ONLY way an anonymous
// caller can reach litterShowcases at all, which firestore.rules
// explicitly restricts to `isSignedIn() && tenantId == request.auth.uid`
// — see that collection's own rules comment, which already anticipated
// this exact endpoint), rate-limited before any lookup, and an explicit
// server-side field allowlist — never a raw document, for the Showcase,
// the Litter, or any puppy Dog.
//
// LOOKUP IS BY TOKEN ONLY. litterId (a Firestore document id) is never
// accepted as a request parameter and never authorizes anything on its
// own — only a token whose sha256 hash matches a Showcase's
// shareTokenHash does. This is deliberate: Firestore ids are sequential-
// ish/short/enumerable in a way a 256-bit random token is not.
//
// Codex fix-round ("Tenant-chain validation"): the share token only ever
// proves "this Showcase document is the one being requested" — it does
// NOT, by itself, prove that the Litter, Dam, or any puppy Dog document
// this Showcase POINTS AT actually still belongs to the same tenant (a
// stale/forged litterId, a puppy reassigned by a since-completed
// transfer, or any other data-integrity drift). Every hop below
// re-checks `.tenantId === showcase.tenantId` explicitly; a puppy's
// OWN `litterId` field is also re-checked against the Showcase's own
// litter, so a puppy can never be shown under the wrong litter's page
// even if it happens to share a tenant. Any mismatch, missing document,
// or malformed relationship fails CLOSED — the whole request 404s
// (litter/dam problems) or that one puppy is silently dropped (a single
// puppy mismatch is not grounds to break the whole showcase for the
// OTHER, valid puppies).
//
// Codex fix-round ("Public identifiers"): the raw Firestore dogId is
// never returned. Each puppy's public identity is an opaque
// deterministic reference (see opaquePuppyRef() in
// api/_lib/showcase-media-access.js) that carries no authority of its
// own — see create-showcase-enquiry.js for how it's resolved back.
//
// Codex fix-round ("Explicit media publication" + "Revocable media
// delivery"): only media ids present in that puppy's own
// publishedPhotoIds/publishedVideoIds (set via
// api/update-showcase-puppy.js) are ever returned, and only as a
// freshly-minted, short-lived signed URL (signMediaItems()) — never a
// raw Storage path, never dog.profilePhoto (which was never an
// explicit-publication field to begin with).
//
// GET /api/showcase-public?token=XXXX
// Returns: { litter, puppies: [...] } | 404 | 429
//
// A wrong token, a disabled/never-rotated share, and an expired share
// all return the SAME generic 404 — never a different message or status
// that would let a caller distinguish "this link never existed" from
// "this link used to work" from "this link is paused". The same posture
// now also covers a tenant-chain mismatch on the Litter or Dam — it is
// indistinguishable, from the outside, from "not found".

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { requireStorageBucket, logConfigError } from './_lib/require-config.js'
import { getClientIp, hashClientKey } from './_lib/rate-limit.js'
import { checkDurableRateLimit } from './_lib/durable-rate-limit.js'
import { hashShareToken, isShareLive, isTenantPlusEligible } from './_lib/showcase-share.js'
import { opaquePuppyRef, signMediaItems } from './_lib/showcase-media-access.js'

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

// Public projection of a single showcased puppy — deliberately excludes
// microchip, Dogs Australia/ANKC registration, tenantId, currentOwnerId,
// createdByUserId, originBreederId, notes, breeder ID type/value, every
// buyer/reservation/deposit field (reservedForName/Email/Phone,
// depositStatus/Amount/ReceivedAt, buyerEmail/buyerName/transferredAt/
// previousOwnerId), transfer/claim history, document storage paths, and
// `status` (restricted/archived — an internal plan/billing concept the
// public has no reason to see; a restricted puppy is still fully
// showcaseable, since `visible` here comes from the Showcase's own
// puppies map, an entirely separate concept from dog.status). Only the
// Showcase's OWN per-puppy `availability` is returned — never the dog's
// internal `availabilityStatus`/Sale & Availability fields, which are a
// different, breeder-workspace-only concept (see DogDetailPage.tsx's
// SaleAvailabilityPanel). `id` is an opaque reference, never the raw
// Firestore dogId; `photos`/`videos` are signed URLs limited to exactly
// what this puppy's Showcase entry has explicitly published — never
// dog.profilePhoto, never the full private gallery.
async function publicPuppyProjection(bucket, litterId, dogId, dog, entry) {
  const publishedPhotos = Array.isArray(entry.publishedPhotoIds) ? entry.publishedPhotoIds : []
  const publishedVideos = Array.isArray(entry.publishedVideoIds) ? entry.publishedVideoIds : []
  const photoById = new Map((dog.photos || []).map(item => [item.id, item]))
  const videoById = new Map((dog.videos || []).map(item => [item.id, item]))

  const selectedPhotos = publishedPhotos.map(id => photoById.get(id)).filter(Boolean)
  const selectedVideos = publishedVideos.map(id => videoById.get(id)).filter(Boolean)

  const [photos, videos] = await Promise.all([
    signMediaItems(bucket, selectedPhotos),
    signMediaItems(bucket, selectedVideos),
  ])

  return {
    id: opaquePuppyRef(litterId, dogId),
    name: dog.name,
    sex: dog.sex,
    breed: dog.breed,
    colour: dog.colour || null,
    dateOfBirth: dog.dateOfBirth,
    availability: entry.availability,
    photos,
    videos,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const bucketName = requireStorageBucket()
  if (!bucketName) {
    logConfigError('showcase-public', 'STORAGE_BUCKET_NOT_CONFIGURED')
    return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured' })
  }

  // Rate limit first, before any other validation or lookup — same
  // posture as api/passport.js: a 429 must never differ in timing/shape
  // based on whether the requested token would have matched anything.
  // Namespaced ('showcase-public') so this endpoint's traffic never
  // shares a budget with api/passport.js's own callers or with
  // api/create-showcase-enquiry.js's own (stricter) budget. Durable/
  // atomic (Firestore-transaction-backed) — see
  // api/_lib/durable-rate-limit.js for why a public, unauthenticated,
  // potentially-high-traffic read endpoint needs a shared-across-
  // instances limiter, not the in-memory one.
  const clientKey = hashClientKey(getClientIp(req))
  const rateLimitResult = await checkDurableRateLimit(db, 'showcase-public', clientKey)
  if (!rateLimitResult.allowed) {
    res.setHeader('Retry-After', String(rateLimitResult.retryAfterSeconds))
    return res.status(429).json({ error: 'Too many requests' })
  }

  const { token } = req.query
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token required' })
  }

  try {
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

    if (!isShareLive(showcase)) {
      return res.status(404).json({ error: 'Not found' })
    }

    if (!showcase.tenantId || typeof showcase.tenantId !== 'string') {
      // Malformed Showcase document — fail closed rather than treat a
      // missing tenantId as "matches everything".
      return res.status(404).json({ error: 'Not found' })
    }

    // Integration-hardening fix (Slice 2, commit 5/5): re-checks the
    // OWNING TENANT's current plan, not just the Showcase document's own
    // flags — see isTenantPlusEligible()'s own comment for why. A fresh
    // read, never a cached/stale profile.
    const profileSnap = await db.collection('users').doc(showcase.tenantId).get()
    if (!isTenantPlusEligible(profileSnap.exists ? profileSnap.data() : null)) {
      return res.status(404).json({ error: 'Not found' })
    }

    const litterId = showcaseDoc.id
    const litterSnap = await db.collection('litters').doc(litterId).get()
    if (!litterSnap.exists) {
      // Data-integrity edge case (a Showcase whose Litter was somehow
      // removed) — same generic 404, never a different signal.
      return res.status(404).json({ error: 'Not found' })
    }
    const litterData = litterSnap.data()

    // Tenant-chain validation: the Litter must belong to the SAME tenant
    // as the Showcase. A mismatch here is a data-integrity problem (or a
    // forged/stale relationship) severe enough to fail the whole request
    // closed, not just drop a puppy.
    if (litterData.tenantId !== showcase.tenantId) {
      return res.status(404).json({ error: 'Not found' })
    }

    let damName = null
    if (litterData.damId) {
      const damSnap = await db.collection('dogs').doc(litterData.damId).get()
      if (!damSnap.exists) {
        return res.status(404).json({ error: 'Not found' })
      }
      const damData = damSnap.data()
      if (damData.tenantId !== showcase.tenantId) {
        return res.status(404).json({ error: 'Not found' })
      }
      damName = damData.name || null
    }

    const visiblePuppyIds = Object.entries(showcase.puppies || {})
      .filter(([, entry]) => entry?.visible === true)
      .map(([puppyId]) => puppyId)

    const puppyDocs = visiblePuppyIds.length > 0
      ? await Promise.all(visiblePuppyIds.map(id => db.collection('dogs').doc(id).get()))
      : []

    const bucket = getStorage().bucket(bucketName)

    // Tenant-chain + litter-chain validation per puppy: a mismatch on
    // ANY single puppy just drops that one puppy — the rest of a
    // legitimately-shared showcase must not break because of one bad
    // relationship elsewhere.
    const validPuppyDocs = puppyDocs.filter(snap => {
      if (!snap.exists) return false
      const dog = snap.data()
      return dog.tenantId === showcase.tenantId && dog.litterId === litterId
    })

    const puppies = await Promise.all(
      validPuppyDocs.map(snap => publicPuppyProjection(bucket, litterId, snap.id, snap.data(), showcase.puppies[snap.id]))
    )

    const litter = {
      name: litterData.name,
      damName,
      sireName: litterData.sireName || null,
      actualBirthDate: litterData.actualBirthDate || null,
    }

    return res.status(200).json({ litter, puppies })
  } catch (err) {
    console.error('showcase-public lookup error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
