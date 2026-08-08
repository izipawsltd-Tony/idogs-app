// api/_lib/direct-upload.js — shared constants/helpers for the direct
// signed-upload flow (request-showcase-media-upload.js +
// confirm-showcase-media-upload.js). Implementation Phase 1 of the
// "Unified Media & Performance" audit's recommended architecture: bytes
// go straight from the browser to Storage via a short-lived, single-
// object signed PUT URL, never through a Vercel function body — the
// base64-JSON-proxy path (api/upload-showcase-media.js) hits Vercel's
// ~4.5MB request-body ceiling for any real, uncompressed photo/video,
// which is exactly what made the approved 3-8MB/20s video target
// unreachable under the old transport.
//
// SECURITY MODEL: storage.rules stays deny-all — a signed URL is a raw
// GCS mechanism that bypasses Firebase Security Rules entirely (same as
// the existing signed-URL READ pattern in showcase-media-access.js), so
// this does NOT make Storage "generally writable". Only the single,
// fresh, UUID-named object path named in one grant is writable, only
// for the 10-minute window that grant is valid, only after the same
// canAddDogRecord() ownership check every other upload endpoint in this
// codebase already uses.
//
// media.public is deliberately NOT introduced anywhere by this module —
// per explicit product decision, publication stays a separate,
// contextual reference (ShowcasePuppyEntry.publishedPhotoIds/
// publishedVideoIds), never a flag on the shared media item itself.

export const UPLOAD_URL_TTL_MS = 10 * 60 * 1000 // 10 minutes — approved decision

export const MEDIA_UPLOAD_GRANTS_COLLECTION = 'mediaUploadGrants'

// Deliberately narrow: a photo uploaded through this direct-upload path
// is ALWAYS the client-compressed JPEG lib/imageCompression.ts's
// prepareImageForUpload() produces (HEIC is decoded client-side before
// this point ever runs) — there is no reason to accept anything else
// here. Video is never compressed client-side (see
// imageCompression.ts's own header comment), so its allowlist mirrors
// exactly what api/_lib/image-pipeline.js's sniffVideoMimeType() already
// recognizes as a real, supported video container.
const PHOTO_CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
])
const VIDEO_CONTENT_TYPES = new Map([
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov'],
  ['video/webm', 'webm'],
])

// Returns the Storage file extension for an allowlisted
// {kind, contentType} pair, or null if the pair isn't allowed — the
// ONLY thing that decides whether a request-upload call is accepted.
// Never derived from a client-supplied filename/extension.
export function extensionForUpload(kind, contentType) {
  const map = kind === 'photo' ? PHOTO_CONTENT_TYPES : kind === 'video' ? VIDEO_CONTENT_TYPES : null
  if (!map) return null
  return map.get(contentType) || null
}

// GCS precondition header enforcing "create only, never overwrite" —
// signed together with the URL itself, so the client's actual PUT
// request must send this exact header for the signature to validate;
// GCS rejects the write with 412 Precondition Failed if an object
// already exists at that path. Real storage-layer enforcement, not just
// reliance on the path's UUID being fresh (though it is also that).
export const NO_OVERWRITE_HEADER = { 'x-goog-if-generation-match': '0' }

// Video-size ceiling for THIS direct-upload path specifically —
// deliberately a SEPARATE constant from api/_lib/image-pipeline.js's
// MAX_VIDEO_INPUT_BYTES (50MB), which remains the legacy base64-proxy
// path's own ceiling and is NOT changed by this. request-showcase-
// media-upload.js enforces this against the client-CLAIMED size before
// ever issuing a signed URL; confirm-showcase-media-upload.js
// independently re-enforces it against the REAL uploaded object's
// ACTUAL size (via Storage metadata, never the client's claim alone)
// before accepting it. Matches lib/imageCompression.ts's
// MAX_VIDEO_UPLOAD_BYTES on the client — kept as two separate constants
// (client vs server modules can't share a literal import) rather than
// one derived value, so a mismatch between them is a visible, obvious
// diff in review rather than a silent import-graph coupling.
export const MAX_DIRECT_VIDEO_UPLOAD_BYTES = 20 * 1024 * 1024
