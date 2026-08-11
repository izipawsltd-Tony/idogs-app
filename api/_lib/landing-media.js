// api/_lib/landing-media.js — shared constants/helpers for the
// self-managed Landing Page Media feature (Super Admin -> Landing Page
// Media). Mirrors the architecture api/_lib/direct-upload.js already
// established for Litter Showcase media: bytes go straight from the
// admin's browser to Storage via a short-lived signed PUT URL, never
// through a Vercel function body -- deliberately reused here rather than
// re-derived, per this codebase's own established convention (see that
// module's header comment for the full "why direct upload" rationale).
//
// DELIBERATELY SEPARATE from direct-upload.js's own constants/grants --
// landing media has a completely different shape (four FIXED,
// deterministic slots, not a per-dog/per-user gallery with its own quota
// system) and a completely different accepted-file-type list (JPG/PNG/
// WebP images up to 5MB; MP4/WebM video up to 20MB -- no HEIC, no MOV,
// unlike the Showcase path's own allowlist), so sharing the same
// constants would either wrongly widen Showcase's allowlist or wrongly
// narrow landing media's.

export const SLOT_IDS = Object.freeze(['hero', 'dog-profile', 'puppy-showcase', 'digital-passport'])

export function isValidSlotId(slotId) {
  return typeof slotId === 'string' && SLOT_IDS.includes(slotId)
}

export const LANDING_MEDIA_PUBLISHED_COLLECTION = 'landingMediaPublished'
export const LANDING_MEDIA_DRAFTS_COLLECTION = 'landingMediaDrafts'
export const LANDING_MEDIA_GRANTS_COLLECTION = 'landingMediaUploadGrants'

export const LANDING_UPLOAD_URL_TTL_MS = 10 * 60 * 1000 // 10 minutes -- matches direct-upload.js's own UPLOAD_URL_TTL_MS
export const LANDING_DRAFT_PREVIEW_URL_TTL_MS = 15 * 60 * 1000 // matches showcase-media-access.js's SIGNED_MEDIA_URL_TTL_MS (authenticated-admin preview, not the short public-redirect TTL)

export const MAX_LANDING_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_LANDING_VIDEO_BYTES = 20 * 1024 * 1024

// Task spec, explicit and narrower than the generic pipeline: images are
// JPG/JPEG, PNG, WebP only (no HEIC/HEIF -- these are admin-supplied
// marketing assets, not phone-camera photos, so there is no reason to
// accept or convert HEIC here); video is MP4, WebM only (no MOV/
// QuickTime, unlike the Showcase upload path).
const IMAGE_CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const VIDEO_CONTENT_TYPES = new Map([
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
])

// The ONLY thing that decides whether a request-upload call is accepted
// and what Storage extension its path gets -- never a client-supplied
// filename/extension. Returns null for any unrecognized {kind,
// contentType} pair, including a cross-kind mismatch (e.g. kind=image
// with contentType=video/mp4).
export function extensionForLandingUpload(kind, contentType) {
  const map = kind === 'image' ? IMAGE_CONTENT_TYPES : kind === 'video' ? VIDEO_CONTENT_TYPES : null
  if (!map) return null
  return map.get(contentType) || null
}

export function maxBytesForLandingKind(kind) {
  return kind === 'video' ? MAX_LANDING_VIDEO_BYTES : MAX_LANDING_IMAGE_BYTES
}

// GCS precondition header enforcing "create only, never overwrite" --
// identical mechanism to direct-upload.js's own NO_OVERWRITE_HEADER;
// every landing-media Storage path is a fresh UUID, so this is defense
// in depth, not the only thing preventing collision.
export const NO_OVERWRITE_HEADER = { 'x-goog-if-generation-match': '0' }

// Stable, public, permanently-cacheable URL for an object that has been
// made public via file.makePublic() -- the same URL shape api/upload.js
// already uses for dog profile photos (the one other genuinely-public,
// non-revocable media path in this codebase). Deliberately NOT a signed
// URL: published landing media is meant to be public, long-lived, and
// CDN/browser-cacheable -- a signed URL would expire and force the public
// marketing page to re-fetch a fresh one on a timer for no security
// benefit (there is nothing to revoke once something is intentionally
// published; Remove/replace instead swaps which object this URL points
// at, via a fresh path each time -- see api/manage-landing-media.js).
export function publicStorageUrl(bucketName, path) {
  return `https://storage.googleapis.com/${bucketName}/${path}`
}

// Sanitizes a client-supplied display filename -- used ONLY for the admin
// UI's own "Filename / type / size / updated date" display, NEVER to
// decide extension/content-type/Storage path (those always come from
// server-side sniffing/allowlists -- see extensionForLandingUpload above
// and confirm-landing-media-upload.js's real magic-byte sniff). Strips
// path separators and non-printable/control characters, and bounds
// length, so a pathological or path-traversal-shaped value can never be
// reflected back into the admin UI unmodified. Iterates by code point
// (rather than a regex with hex character-class escapes) so the check is
// unambiguous to read and cannot be mis-transcribed.
export function sanitizeDisplayFilename(raw) {
  if (typeof raw !== 'string') return ''
  let out = ''
  for (const ch of raw) {
    if (ch === '\\' || ch === '/') continue
    const code = ch.codePointAt(0) || 0
    if (code < 32 || code === 127) continue
    out += ch
  }
  return out.trim().slice(0, 200)
}
