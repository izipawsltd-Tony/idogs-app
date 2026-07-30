// api/_lib/image-pipeline.js — the ONE reusable image processing
// pipeline for every upload path that accepts a photo (dog avatar/
// profile via api/upload.js, litter/puppy Showcase media via
// api/upload-showcase-media.js) — Slice 2 requirement: "Create one
// reusable pipeline for Avatar, Dog Profile, litter and puppy."
//
// WHY THIS EXISTS: api/upload.js already had a HEIC conversion branch
// (`if (finalMediaType === 'image/heic'...) buffer = await
// sharp(buffer).jpeg(...)`), but two things were wrong with it:
//
// 1. `finalMediaType` was taken directly from the client-supplied
//    request body with NO verification against the actual file bytes —
//    a caller could send arbitrary content labeled as anything.
//
// 2. sharp's OFFICIAL prebuilt binaries do not bundle libheif (HEIC/
//    HEIF decode) — this is a well-known, long-standing limitation
//    (Apple/Nokia patent licensing), confirmed directly in this
//    environment: `sharp({...}).heif({compression:'hevc'}).toBuffer()`
//    fails with "heifsave: Unsupported compression". So the existing
//    HEIC branch was very likely ALREADY silently broken for real
//    iPhone-photo uploads before this pipeline existed — every HEIC
//    upload attempt would have thrown, been caught by upload.js's
//    generic catch-all, and returned "Upload failed" with no real
//    conversion ever happening. This module fixes that as much as it
//    adds new capability.
//
// This module fixes both: real magic-byte sniffing (never trusts a
// Content-Type/mediaType string), and an actual working HEIC/HEIF
// decoder (`heic-convert`, a pure-JS/WASM library with no native-binary
// licensing gap) feeding into sharp only for the resize/orientation/
// re-encode step, never for the initial decode.

import sharp from 'sharp'
import heicConvert from 'heic-convert'

export class ImagePipelineError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// Generous enough for a real phone photo (even an uncompressed HEIC can
// run 20-40MB for a modern high-megapixel sensor), small enough that a
// pathological upload can't exhaust a serverless function's memory
// trying to decode it. Checked BEFORE any decode attempt.
export const MAX_IMAGE_INPUT_BYTES = 30 * 1024 * 1024

// The HEIC/HEIF output is always bounded to this box (aspect-preserving,
// never upscaled) — Slice 2 requirement: "resize/compress ... convert to
// JPEG". Chosen to comfortably cover any realistic display size (dog
// avatar, Showcase gallery, public page) while keeping file size
// reasonable for a serverless function's response time and the eventual
// public page's load time.
const HEIC_OUTPUT_MAX_DIMENSION = 1600
const HEIC_OUTPUT_JPEG_QUALITY = 82

// Real content sniffing via magic bytes — the ONLY thing this module
// trusts to decide what a file actually is. A caller-supplied
// mediaType/Content-Type string is never consulted for this decision
// anywhere in this pipeline; validate-then-use, never trust-then-use.
//
// HEIC/HEIF detection: both are ISO Base Media File Format containers —
// bytes 4-7 are the literal ASCII `ftyp`, followed by a 4-character
// "brand" at bytes 8-11 that says what KIND of ISOBMFF file this is.
// MP4 video uses the exact same `ftyp` box structure with a DIFFERENT
// brand — the brand is what actually distinguishes a HEIC photo from an
// MP4 video, not the box structure itself. This allowlist covers every
// brand code Apple's Camera/Photos app is documented to actually write
// for a HEIC photo (single image) or HEIF image sequence (Live Photo
// still frame) — a deliberately explicit allowlist, not "starts with
// ftyp", so an MP4 can never be misidentified as a photo.
const HEIC_FTYP_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])

export function sniffImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'

  if (buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return 'image/png'
  }

  if (buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }

  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).trim()
    if (HEIC_FTYP_BRANDS.has(brand)) return 'image/heic'
  }

  return null
}

// Same ftyp/brand mechanics as sniffImageMimeType, but for the brands
// Apple's Camera app and standard encoders actually write for VIDEO —
// used by api/upload-showcase-media.js, never by the photo path above
// (a file sniffing as one must never also be accepted as the other).
const MP4_FTYP_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'dash'])
const MOV_FTYP_BRANDS = new Set(['qt  '])

export function sniffVideoMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null

  if (buffer.length >= 4 &&
    buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'video/webm'
  }

  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12)
    if (MOV_FTYP_BRANDS.has(brand)) return 'video/quicktime'
    if (MP4_FTYP_BRANDS.has(brand)) return 'video/mp4'
  }

  return null
}

// "Short" video is enforced as a SIZE limit, not a true decoded-duration
// check — SCOPE DECISION, not an oversight: getting an exact duration
// server-side needs a real media-probing tool (ffprobe or equivalent),
// which is not installed in this Vercel serverless Node runtime and
// would be a substantial new operational dependency (binary packaging,
// cold-start/deploy-size cost) to add just for this. Flagged explicitly
// in this project's delivery report as a follow-up requiring a product/
// infra decision, not implemented here. Size is a reasonable practical
// proxy for "short" at a given bitrate, and — critically — is a real,
// enforceable, un-bypassable server-side limit today, unlike trusting a
// client-reported duration value (which this pipeline deliberately does
// NOT do, for the same "never trust caller-supplied metadata" reason
// mediaType is never trusted for images).
export const MAX_VIDEO_INPUT_BYTES = 50 * 1024 * 1024

// No transcoding is performed (same "no ffmpeg available" constraint as
// the duration limitation above) — a video that passes sniffing + the
// size limit is stored exactly as uploaded. Returns the same
// {buffer, mimeType, extension} shape processImageForStorage() does, so
// callers can treat photo and video uploads uniformly.
export function processVideoForStorage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImagePipelineError('EMPTY_FILE', 'File is empty')
  }
  if (buffer.length > MAX_VIDEO_INPUT_BYTES) {
    throw new ImagePipelineError('FILE_TOO_LARGE', `Video exceeds the ${Math.floor(MAX_VIDEO_INPUT_BYTES / (1024 * 1024))}MB limit`)
  }
  const sniffed = sniffVideoMimeType(buffer)
  if (!sniffed) {
    throw new ImagePipelineError('UNSUPPORTED_VIDEO_TYPE', 'File is not a recognized video type (MP4, MOV, or WebM)')
  }
  const extension = sniffed === 'video/quicktime' ? 'mov' : sniffed === 'video/webm' ? 'webm' : 'mp4'
  return { buffer, mimeType: sniffed, extension }
}

// The single reusable entry point every photo-upload endpoint calls.
// Ignores whatever mediaType the caller thought the file was entirely —
// sniffs the real bytes, and:
//   - HEIC/HEIF -> decoded (heic-convert), orientation preserved
//     (sharp's .rotate() with no args auto-applies the EXIF Orientation
//     tag then strips it — the documented idiom for "preserve
//     orientation" without hand-parsing EXIF), resized/compressed,
//     re-encoded as JPEG. Never re-enters this branch on its own
//     output (the returned buffer is a real JPEG, which sniffs as
//     'image/jpeg' if ever passed back through — no double-convert path
//     exists because nothing in this codebase re-runs an already-
//     processed buffer through this function again).
//   - JPEG/PNG/WebP -> returned byte-for-byte unchanged (Slice 2
//     requirement: "Preserve JPG/PNG/WebP behavior") — the only change
//     from the OLD code path is that the extension/Content-Type used to
//     store it now come from the SNIFFED real type, never a
//     caller-supplied claim that might not match the actual bytes.
//   - anything else (including a corrupt/truncated file, or a real
//     video submitted to a photo endpoint) -> throws
//     ImagePipelineError('UNSUPPORTED_IMAGE_TYPE', ...), which every
//     caller maps to a 400.
export async function processImageForStorage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImagePipelineError('EMPTY_FILE', 'File is empty')
  }
  if (buffer.length > MAX_IMAGE_INPUT_BYTES) {
    throw new ImagePipelineError('FILE_TOO_LARGE', `File exceeds the ${Math.floor(MAX_IMAGE_INPUT_BYTES / (1024 * 1024))}MB limit`)
  }

  const sniffed = sniffImageMimeType(buffer)
  if (!sniffed) {
    throw new ImagePipelineError('UNSUPPORTED_IMAGE_TYPE', 'File is not a recognized image type (JPG, PNG, WebP, or HEIC/HEIF)')
  }

  if (sniffed === 'image/heic' || sniffed === 'image/heif') {
    let rawJpeg
    try {
      rawJpeg = await heicConvert({ buffer, format: 'JPEG', quality: 1 })
    } catch {
      // heic-convert throws on a file that LOOKS like a HEIC container
      // (correct ftyp brand) but is malformed/truncated/corrupt inside —
      // never let that raw error (which can include internal decoder
      // detail) escape to the caller.
      throw new ImagePipelineError('HEIC_DECODE_FAILED', 'Could not read this HEIC/HEIF file — it may be corrupted')
    }
    const processed = await sharp(Buffer.from(rawJpeg))
      .rotate()
      .resize({ width: HEIC_OUTPUT_MAX_DIMENSION, height: HEIC_OUTPUT_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: HEIC_OUTPUT_JPEG_QUALITY })
      .toBuffer()
    return { buffer: processed, mimeType: 'image/jpeg', extension: 'jpg' }
  }

  const extension = sniffed === 'image/png' ? 'png' : sniffed === 'image/webp' ? 'webp' : 'jpg'
  return { buffer, mimeType: sniffed, extension }
}
