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
// GET /api/showcase-public?token=XXXX
// Returns: { litter, puppies: [...] } | 404 | 429
//
// A wrong token, a disabled/never-rotated share, and an expired share
// all return the SAME generic 404 — never a different message or status
// that would let a caller distinguish "this link never existed" from
// "this link used to work" from "this link is paused".

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { checkRateLimit, getClientIp, hashClientKey } from './_lib/rate-limit.js'
import { hashShareToken, isShareLive, isTenantPlusEligible } from './_lib/showcase-share.js'

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
// SaleAvailabilityPanel).
function publicPuppyProjection(dogId, dog, entry) {
  return {
    id: dogId,
    name: dog.name,
    sex: dog.sex,
    breed: dog.breed,
    colour: dog.colour || null,
    dateOfBirth: dog.dateOfBirth,
    availability: entry.availability,
    profilePhoto: dog.profilePhoto || null,
    photos: Array.isArray(dog.photos) ? dog.photos : [],
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit first, before any other validation or lookup — same
  // posture as api/passport.js: a 429 must never differ in timing/shape
  // based on whether the requested token would have matched anything.
  // Namespaced ('showcase:' prefix) so this endpoint's traffic never
  // shares a budget with api/passport.js's own callers, even though
  // both happen to import the same rate-limit module/state.
  const clientKey = hashClientKey(`showcase:${getClientIp(req)}`)
  const rateLimitResult = checkRateLimit(clientKey)
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

    const damName = litterData.damId
      ? (await db.collection('dogs').doc(litterData.damId).get()).data()?.name || null
      : null

    const visiblePuppyIds = Object.entries(showcase.puppies || {})
      .filter(([, entry]) => entry?.visible === true)
      .map(([puppyId]) => puppyId)

    const puppyDocs = visiblePuppyIds.length > 0
      ? await Promise.all(visiblePuppyIds.map(id => db.collection('dogs').doc(id).get()))
      : []

    const puppies = puppyDocs
      .filter(snap => snap.exists)
      .map(snap => publicPuppyProjection(snap.id, snap.data(), showcase.puppies[snap.id]))

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
