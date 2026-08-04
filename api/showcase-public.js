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
// api/update-showcase-puppy.js) are ever listed — never dog.profilePhoto
// (which was never an explicit-publication field to begin with).
//
// Codex re-review ("server-mediated public media delivery"): this
// endpoint no longer mints a Storage signed URL at all — each listed
// item's `url` is a link to api/showcase-media.js, which re-validates
// the ENTIRE authorization chain fresh on every single request before
// ever minting a (60-second, not 15-minute) signed URL. This is what
// makes disabling/rotating/expiring the share, unpublishing that exact
// item, hiding the puppy, or the tenant losing Plus eligibility all
// immediately stop the NEXT request for that media, regardless of how
// recently this JSON response was fetched — see api/showcase-media.js's
// own header comment for the precise guarantee.
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
import { getClientIp, hashClientKey } from './_lib/rate-limit.js'
import { checkDurableRateLimit } from './_lib/durable-rate-limit.js'
import { hashShareToken, isShareLive, isTenantPlusEligible } from './_lib/showcase-share.js'
import { opaquePuppyRef } from './_lib/showcase-media-access.js'
import { isValidShowcasePuppyDoc } from './_lib/showcase-schema.js'

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
// Firestore dogId; `photos`/`videos` are links to api/showcase-media.js
// limited to exactly what this puppy's Showcase entry has explicitly
// published — never dog.profilePhoto, never the full private gallery.
// Builds a link to api/showcase-media.js — never a raw Storage path or
// signed URL. `token` is the SAME raw token the caller already used to
// reach this page (already effectively public to whoever holds this
// exact share link — same trust boundary as the /s/:token route itself);
// `puppyRef` is the opaque reference already computed for this puppy.
function mediaEndpointUrl(token, puppyRef, mediaId, kind) {
  const params = new URLSearchParams({ token, puppyRef, mediaId, kind })
  return `/api/showcase-media?${params.toString()}`
}

function publicPuppyProjection(token, litterId, dogId, dog, entry) {
  const puppyRef = opaquePuppyRef(litterId, dogId)
  const publishedPhotos = Array.isArray(entry.publishedPhotoIds) ? entry.publishedPhotoIds : []
  const publishedVideos = Array.isArray(entry.publishedVideoIds) ? entry.publishedVideoIds : []
  const photoIds = new Set((dog.photos || []).map(item => item.id))
  const videoIds = new Set((dog.videos || []).map(item => item.id))

  // Only lists ids that genuinely exist in this puppy's CURRENT
  // Firestore gallery (a stale publishedPhotoIds entry pointing at an
  // id removed via api/update-showcase-media.js is silently dropped
  // here, same as before) — whether the underlying Storage OBJECT still
  // exists is no longer checked here at all; that check now lives
  // exclusively in api/showcase-media.js, re-run fresh on every actual
  // fetch rather than once at listing time (see this file's own header
  // comment on why the check moved).
  const photos = publishedPhotos
    .filter(id => photoIds.has(id))
    .map(id => ({ id, url: mediaEndpointUrl(token, puppyRef, id, 'photo') }))
  const videos = publishedVideos
    .filter(id => videoIds.has(id))
    .map(id => ({ id, url: mediaEndpointUrl(token, puppyRef, id, 'video') }))

  const publicAvailability = entry.availability === 'available' ? 'available'
    : entry.availability === 'sold' || entry.availability === 'unavailable' ? 'sold'
      : entry.availability === 'reserved' || entry.availability === 'on_hold' ? 'reserved' : null
  if (!publicAvailability) return null
  const safeText = (value, max) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim().slice(0, max) || null : null
  return {
    id: puppyRef,
    name: dog.name,
    sex: dog.sex,
    breed: dog.breed,
    colour: safeText(entry.colour, 80) || safeText(dog.colour, 80),
    dateOfBirth: dog.dateOfBirth,
    availability: publicAvailability,
    personality: safeText(entry.personality, 500),
    readyToGoHomeDate: /^\d{4}-\d{2}-\d{2}$/.test(entry.readyToGoHomeDate || '') ? entry.readyToGoHomeDate : null,
    ...(entry.showPrice === true && Number.isSafeInteger(entry.priceCents) && entry.priceCents >= 0 ? { priceCents: entry.priceCents } : {}),
    ...(entry.showDeposit === true && Number.isSafeInteger(entry.depositCents) && entry.depositCents >= 0 ? { depositCents: entry.depositCents } : {}),
    photos,
    videos,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
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

    // Tenant-chain + litter-chain validation per puppy — see
    // isValidShowcasePuppyDoc()'s own header comment above for why a
    // dog missing litterId entirely still needs a fallback membership
    // check. A mismatch on ANY single puppy just drops that one puppy —
    // the rest of a legitimately-shared showcase must not break because
    // of one bad relationship elsewhere.
    const litterPuppyIds = new Set(litterData.puppyIds || [])
    const validPuppyDocs = puppyDocs.filter(snap =>
      snap.exists && isValidShowcasePuppyDoc(snap.id, snap.data(), showcase.tenantId, litterId, litterPuppyIds))

    const puppies = validPuppyDocs.map(snap => publicPuppyProjection(token, litterId, snap.id, snap.data(), showcase.puppies[snap.id])).filter(Boolean)

    const litter = {
      name: litterData.name,
      damName,
      sireName: litterData.sireName || null,
      actualBirthDate: litterData.actualBirthDate || null,
      readyToGoHomeDate: litterData.readyToGoHomeDate || null,
    }

    return res.status(200).json({ litter, puppies })
  } catch (err) {
    console.error('showcase-public lookup error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
