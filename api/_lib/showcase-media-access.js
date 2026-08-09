// api/_lib/showcase-media-access.js — shared helpers for Litter
// Showcase media (Codex fix-round: "Revocable media delivery",
// "Explicit media publication", "Public identifiers").
//
// REVOCABLE DELIVERY: every showcase media file is uploaded PRIVATE (no
// file.makePublic() anywhere — see api/upload-showcase-media.js). The
// ONLY way to view one is a short-lived signed URL, generated fresh on
// every request by signMediaItems() below, never persisted. This is
// what makes disabling/rotating/expiring a Showcase (or pausing
// sharing) actually take effect on already-shared media, not just on
// future page loads — a previously-issued signed URL still expires on
// its own short TTL regardless, and no NEW one can ever be minted
// without re-passing the full share-token/liveness/plan/publication
// chain (see api/showcase-public.js).

import { randomUUID, createHash } from 'crypto'
import { isValidShowcasePuppyDoc } from './showcase-schema.js'

// Used for the breeder's OWN authenticated views (api/get-showcase-
// media-urls.js, and the immediate response right after
// api/upload-showcase-media.js / api/update-showcase-media.js) — a
// signed-in breeder editing their own gallery is a completely different
// trust boundary from an anonymous public viewer (see
// SHORT_LIVED_REDIRECT_TTL_MS below for that one). Short enough that a
// leaked/logged/cached URL stops working quickly; long enough that a
// single authenticated page load (which may render several images)
// doesn't race its own fetches against expiry.
export const SIGNED_MEDIA_URL_TTL_MS = 15 * 60 * 1000

// Codex re-review ("server-mediated public media delivery"): the PUBLIC
// Showcase page never receives a Storage signed URL directly — it only
// ever receives a link to api/showcase-media.js, which re-validates the
// ENTIRE authorization chain (share token, live/enabled/expiry, Plus
// eligibility, tenant/litter/puppy relationship, visibility, explicit
// publication) on EVERY request before minting one of these. Deliberately
// far shorter than SIGNED_MEDIA_URL_TTL_MS above — this is the residual
// window an already-issued redirect target keeps working for even if the
// breeder revokes access the instant after it was issued; keeping it
// short (rather than 15 minutes) is what makes that window negligible
// rather than the whole remaining fix-round moot. See api/showcase-
// media.js's own header comment for the precise guarantee this does (and
// does not) make.
export const SHORT_LIVED_REDIRECT_TTL_MS = 60 * 1000

export function newMediaId() {
  return randomUUID()
}

// Deliberately generous but bounded — Slice 2 requirement ("Multiple
// litter/puppy images") without letting a single puppy's document grow
// unbounded (Firestore documents have a real 1MB size ceiling, and a
// gallery this large would be a poor showcase experience regardless).
// Shared here (rather than duplicated) so api/upload-showcase-media.js
// and api/confirm-showcase-media-upload.js enforce the exact same cap.
export const MAX_MEDIA_ITEMS_PER_KIND = 30

// Generates fresh signed URLs for a list of { id, path } MediaItems.
// Never persisted — recomputed on every call. `ttlMs` defaults to the
// breeder-authenticated TTL above; api/showcase-media.js passes
// SHORT_LIVED_REDIRECT_TTL_MS explicitly for the public-facing case. An
// item whose Storage object no longer exists (deleted, or a data-
// integrity edge case) is silently dropped rather than failing the whole
// response — a missing file exposes nothing either way.
export async function signMediaItems(bucket, items, ttlMs = SIGNED_MEDIA_URL_TTL_MS) {
  if (!Array.isArray(items) || items.length === 0) return []
  const results = await Promise.all(items.map(async item => {
    if (!item || typeof item.path !== 'string' || typeof item.id !== 'string') return null
    try {
      const file = bucket.file(item.path)
      const [exists] = await file.exists()
      if (!exists) return null
      const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + ttlMs })
      return { id: item.id, url }
    } catch {
      return null
    }
  }))
  return results.filter(Boolean)
}

// PUBLIC IDENTIFIERS: an opaque, non-reversible, non-authorizing
// reference for a puppy in a PUBLIC response — never the raw Firestore
// dogId. Deterministic (same litterId+dogId always yields the same
// ref, since it's a plain hash of both) so api/create-showcase-
// enquiry.js can resolve a submitted ref back to a real dogId by
// recomputing this SAME hash for each candidate puppy already known to
// be part of the token-resolved Showcase and checking for a match — no
// separate persisted id-mapping table needed. The ref carries NO
// authority of its own: submitting a fabricated or replayed ref that
// happens to match some OTHER showcase's puppy still requires that
// OTHER showcase's own valid token to even reach the candidate list it
// would be checked against (see create-showcase-enquiry.js) — this
// function only ever produces an opaque label, callers are what decide
// whether it means anything in a given request's context.
export function opaquePuppyRef(litterId, dogId) {
  return createHash('sha256').update(`${litterId}:${dogId}`, 'utf8').digest('hex').slice(0, 24)
}

// Shared by api/create-showcase-enquiry.js and api/showcase-media.js —
// both need to turn a client-supplied opaque puppyRef back into a real,
// tenant/litter-verified dogId, using the EXACT same rule: only a
// CURRENTLY VISIBLE member of the token-resolved Showcase can ever
// resolve to anything (see opaquePuppyRef()'s own comment for why this
// needs no separate persisted id-mapping table). Returns
// { dogId, dog, entry } on success, or null on ANY failure (unknown ref,
// missing dog, tenant/litter mismatch) — callers should treat null as
// the same generic 404 every other denial in this trust boundary uses.
//
// `litterPuppyIds` (a Set of the litter document's own puppyIds — the
// caller already has this litter document in hand for its own tenant-
// chain check, so this never costs an extra Firestore read) is required
// so a LEGACY puppy whose dog document has no litterId at all (see
// isValidShowcasePuppyDoc()'s own header comment in showcase-schema.js)
// resolves the exact same way here as it already does in
// api/showcase-public.js's own listing — a dog missing litterId used to
// silently fail EVERY media fetch and puppy-specific enquiry even after
// it correctly started appearing on the public page, because this
// function still ran its own, separately-maintained (and, it turned
// out, stale) strict-equality check instead of the shared helper.
export async function resolveVisiblePuppyByRef(db, showcase, litterId, puppyRef, litterPuppyIds) {
  if (!puppyRef || typeof puppyRef !== 'string') return null
  const visibleEntries = Object.entries(showcase.puppies || {}).filter(([, entry]) => entry?.visible === true)
  const match = visibleEntries.find(([dogId]) => opaquePuppyRef(litterId, dogId) === puppyRef)
  if (!match) return null
  const [dogId, entry] = match

  const dogSnap = await db.collection('dogs').doc(dogId).get()
  if (!dogSnap.exists) return null
  const dog = dogSnap.data()
  if (!isValidShowcasePuppyDoc(dogId, dog, showcase.tenantId, litterId, litterPuppyIds)) return null

  return { dogId, dog, entry }
}
