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

// Short enough that a leaked/logged/cached URL stops working quickly;
// long enough that a single public page load (which may render several
// images) doesn't race its own fetches against expiry.
export const SIGNED_MEDIA_URL_TTL_MS = 15 * 60 * 1000

export function newMediaId() {
  return randomUUID()
}

// Generates fresh signed URLs for a list of { id, path } MediaItems.
// Never persisted — recomputed on every call, both for the breeder's
// own authenticated view (api/get-showcase-media-urls.js) and the
// public Showcase page (api/showcase-public.js). An item whose Storage
// object no longer exists (deleted, or a data-integrity edge case) is
// silently dropped rather than failing the whole response — a missing
// file exposes nothing either way.
export async function signMediaItems(bucket, items) {
  if (!Array.isArray(items) || items.length === 0) return []
  const results = await Promise.all(items.map(async item => {
    if (!item || typeof item.path !== 'string' || typeof item.id !== 'string') return null
    try {
      const file = bucket.file(item.path)
      const [exists] = await file.exists()
      if (!exists) return null
      const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + SIGNED_MEDIA_URL_TTL_MS })
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
