// scripts/test-image-compression.mjs — regression coverage for
// src/lib/imageCompression.ts (Tony live-staging fix rounds: "large-image
// upload 413", then "HEIC upload fails").
//
// Root cause recap #1 (413, see imageCompression.ts's own header comment
// for the full story): this project's api/*.js are plain Vercel
// Serverless Functions ("Other" framework preset), which reject any
// request body over ~4.5MB with a platform-level 413 before the function
// code ever runs — no vercel.json override exists anywhere in this repo.
// A real phone photo, base64-encoded, routinely exceeds that on its own,
// long before api/_lib/image-pipeline.js's own much more generous
// MAX_IMAGE_INPUT_BYTES (30MB) check ever gets a chance to run.
//
// Root cause recap #2 (HEIC upload fails): the PREVIOUS version of this
// module sent a HEIC/HEIF file RAW (uncompressed) to the server, capped
// at a small 3MB pre-flight ceiling to stay under the same ~4.5MB body
// limit after base64 inflation — but a real iPhone HEIC photo routinely
// runs 3-8MB, so that ceiling silently rejected most ordinary photos.
// Fixed by decoding HEIC/HEIF client-side via libheif-js's WASM build,
// declared directly because application code imports it, and running it
// through the SAME resize/compress pipeline every other photo uses, so
// there is no longer any reason to cap HEIC specially at all.
//
// Structural/source-inspection only, deliberately, matching this
// project's established pattern for client-only code that touches real
// DOM/Canvas/Image/FileReader/WASM APIs unavailable in plain Node (no
// jsdom dependency exists in this repo) — see test-litter-showcase.mjs's
// own ShowcaseManager checks for the same convention. The actual upload
// success/failure PATH (compressed base64 reaching api/upload-showcase-
// media.js and surviving image-pipeline.js's own magic-byte/size checks)
// is covered end-to-end by test-showcase-media-pipeline.mjs against the
// real emulator — this file only verifies imageCompression.ts's own
// exported contract and how LittersPage.tsx wires it in.

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const src = readFileSync(new URL('../src/lib/imageCompression.ts', import.meta.url), 'utf8')

check('exports MAX_VIDEO_UPLOAD_BYTES', /export const MAX_VIDEO_UPLOAD_BYTES = /.test(src))
check('MAX_HEIC_UPLOAD_BYTES is no longer EXPORTED (a historical mention in the header comment explaining why is fine) — HEIC is decoded+compressed client-side now, never sent raw, so it no longer needs its own special pre-flight byte ceiling', !/export const MAX_HEIC_UPLOAD_BYTES/.test(src))
check('exports readFileAsBase64', /export function readFileAsBase64/.test(src))
check('exports compressImageFile', /export function compressImageFile/.test(src))
check('exports prepareImageForUpload', /export async function prepareImageForUpload/.test(src))
check('exports ImageCompressionError', /export class ImageCompressionError extends Error/.test(src))
check("ImageCompressionError's code union includes HEIC_DECODE_FAILED", /'UNREADABLE' \| 'TIMEOUT' \| 'HEIC_DECODE_FAILED'/.test(src))

// UPDATE (Implementation Phase 1 — direct media upload, video-limit
// round): MAX_VIDEO_UPLOAD_BYTES used to have to stay comfortably under
// Vercel's ~4.5MB body limit even after base64 encoding, because video
// went through the base64-proxy path. That is no longer true — video
// now uploads as a raw File straight to Storage via a signed URL (see
// LittersPage.tsx/db.ts's uploadShowcaseMediaDirect), never touching
// Vercel's request body or base64 at all, so this constant's real
// ceiling is now the direct-upload path's own limit
// (api/_lib/direct-upload.js's MAX_DIRECT_VIDEO_UPLOAD_BYTES) — checked
// here to be exactly 20MB and kept in sync with the server-side value
// (the two are deliberately separate constants, not one shared import
// across a client/server boundary — see that module's own comment).
{
  function parseByteExpression(text) {
    const parts = text.trim().split('*').map(part => part.trim())
    if (!parts.every(part => /^\d+(\.\d+)?$/.test(part))) return null
    return parts.reduce((product, part) => product * Number(part), 1)
  }
  const videoMatch = /export const MAX_VIDEO_UPLOAD_BYTES = ([\d.*\s]+)$/m.exec(src)
  const videoBytes = videoMatch ? parseByteExpression(videoMatch[1]) : null
  check('MAX_VIDEO_UPLOAD_BYTES parses as a genuine numeric byte expression', videoBytes !== null)
  check('MAX_VIDEO_UPLOAD_BYTES is exactly 20MB (the approved direct-upload video limit)', videoBytes === 20 * 1024 * 1024, `${videoBytes} bytes`)

  const directUploadSrc = readFileSync(new URL('../api/_lib/direct-upload.js', import.meta.url), 'utf8')
  const serverMatch = /export const MAX_DIRECT_VIDEO_UPLOAD_BYTES = ([\d.*\s]+)$/m.exec(directUploadSrc)
  const serverBytes = serverMatch ? parseByteExpression(serverMatch[1]) : null
  check('api/_lib/direct-upload.js\'s MAX_DIRECT_VIDEO_UPLOAD_BYTES matches the client constant exactly (20MB on both sides, kept in sync deliberately, not by shared import)', videoBytes !== null && videoBytes === serverBytes)
}

// compressImageFile: same proven technique as the already-approved
// PhotoUpload.tsx resizeImage() (canvas draw + toDataURL), generalized
// with a configurable max dimension/quality instead of a second inline
// copy of the same logic. Now shared with the HEIC path via
// resizeAndEncodeJpeg() rather than duplicated.
check('a shared resizeAndEncodeJpeg() helper exists (used by both the <img>-based path and the new HEIC-decoded-canvas path)', /function resizeAndEncodeJpeg/.test(src))
check('resizeAndEncodeJpeg caps the LARGER dimension, preserving aspect ratio (never stretches/crops)',
  /if \(width > maxDimension \|\| height > maxDimension\)/.test(src) && /width > height/.test(src))
check('resizeAndEncodeJpeg re-encodes as JPEG via canvas.toDataURL', /canvas\.toDataURL\('image\/jpeg', quality\)/.test(src))
check('the Showcase-appropriate default dimension (1600px) is unchanged — larger than PhotoUpload.tsx\'s 800px avatar cap, since gallery photos display much bigger', /MAX_GALLERY_DIMENSION = 1600/.test(src))
check('compressImageFile has a timeout safety net (an unsupported/corrupt format must fail, never hang forever with no feedback)',
  /setTimeout\(\(\) => \{[\s\S]{0,200}reject\(new ImageCompressionError\('TIMEOUT'/.test(src))
check('compressImageFile rejects with a clear, actionable message on both onerror and timeout (never a bare/generic Error)',
  /reject\(new ImageCompressionError\('UNREADABLE'/.test(src) && /reject\(new ImageCompressionError\('TIMEOUT'/.test(src))
check('compressImageFile always revokes its own object URL (on success AND on every failure path) — no blob URL leak', (src.match(/URL\.revokeObjectURL\(url\)/g) || []).length >= 2)

// ── HEIC/HEIF: now genuinely decoded and compressed, never sent raw ────

check('prepareImageForUpload decodes HEIC/HEIF via decodeHeicToCanvas() and runs it through the SAME resize/compress pipeline as every other format — never sends it raw anymore',
  /if \(isHeicFile\(file\)\) \{[\s\S]{0,150}decodeHeicToCanvas\(file\)/.test(src) && /return resizeAndEncodeJpeg\(canvas, width, height/.test(src))
check('prepareImageForUpload compresses every non-HEIC file exactly as before', /return compressImageFile\(file\)/.test(src))

check('the WASM decoder is loaded via a DYNAMIC import (lazy-loaded chunk — zero bundle cost for every upload that is not HEIC)',
  /import\('libheif-js\/wasm-bundle'\)/.test(src))
check('the loaded WASM module is cached across calls (loadLibheif does not re-fetch/re-instantiate per HEIC file in the same session)',
  /let libheifModulePromise/.test(src) && /if \(!libheifModulePromise\)/.test(src))
check('a failure loading the WASM module clears the cache so the NEXT HEIC file can retry, rather than permanently caching a failure',
  /libheifModulePromise = null/.test(src))
check('a WASM-load failure surfaces a clear, actionable ImageCompressionError, never a raw/cryptic error',
  /Could not load the HEIC image decoder/.test(src))

check('decodeHeicToCanvas validates the DECODED CONTENT (real images returned), not just the file extension/MIME type',
  /if \(!Array\.isArray\(images\) \|\| images\.length === 0\)/.test(src))
check('decodeHeicToCanvas rejects invalid/non-finite/non-positive decoded dimensions rather than trusting them blindly',
  /validateHeicDecodeDimensions\(width, height\)/.test(src))
check('decoded dimensions and pixel count are validated before the RGBA buffer is allocated',
  src.indexOf('validateHeicDecodeDimensions(width, height)') < src.indexOf('new Uint8ClampedArray(dimensions.rgbaBytes)'))
check('decodeHeicToCanvas has its own timeout safety net around image.display() (a malformed decode is not guaranteed to invoke its callback)',
  /setTimeout\(\(\) => \{[\s\S]{0,150}reject\(new ImageCompressionError\('HEIC_DECODE_FAILED', 'This HEIC\/HEIF file took too long to decode'/.test(src))
check('every HEIC decode failure path throws ImageCompressionError with code HEIC_DECODE_FAILED and a clear message, never a raw decoder exception',
  (src.match(/new ImageCompressionError\('HEIC_DECODE_FAILED'/g) || []).length >= 5)
check('decodeHeicToCanvas documents that HEIF rotation/mirror properties are mandatorily-applied by the decoder (orientation preserved with no extra EXIF-handling code needed)',
  /HEIF's rotation\/mirror transformative properties/.test(src))

// ── LittersPage.tsx wiring — confirms the module is actually USED, not
// just defined, and that the obsolete small-HEIC-size gate is gone. The
// Draft → Save behavioral checks (queuing, size-limit rejection
// messages, etc.) live in test-litter-showcase.mjs alongside the rest of
// ShowcaseManager's own tests; these are narrowly scoped to "is the
// right function from the right module actually being called". ──
{
  const littersPageSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  // UPDATE (Implementation Phase 1 — direct media upload): readFileAsBase64
  // is no longer imported here — video now uploads the raw File directly
  // (uploadShowcaseMediaDirect), with no base64 step at all in this flow.
  check('LittersPage.tsx imports prepareImageForUpload/MAX_VIDEO_UPLOAD_BYTES/ImageCompressionError from lib/imageCompression (MAX_HEIC_UPLOAD_BYTES and readFileAsBase64 no longer imported — both removed)',
    /import \{ prepareImageForUpload, MAX_VIDEO_UPLOAD_BYTES, ImageCompressionError \} from '\.\.\/lib\/imageCompression'/.test(littersPageSrc))
  check('LittersPage.tsx no longer imports isHeicFile — the special HEIC pre-flight size gate that used it was removed along with MAX_HEIC_UPLOAD_BYTES',
    !littersPageSrc.includes("import { isHeicFile } from '../lib/heic'"))
  check('handleAddFiles no longer has a separate, stricter size ceiling for HEIC — it is gated by the same generic 30MB photo sanity check as every other format',
    !/isHeicFile\(file\) && file\.size > MAX_HEIC_UPLOAD_BYTES/.test(littersPageSrc) &&
    /kind === 'photo' && file\.size > 30 \* 1024 \* 1024/.test(littersPageSrc))
  check('handleSaveShowcaseDraft calls prepareImageForUpload for photo uploads (never sends a raw, uncompressed file of any format)',
    /await uploadShowcaseMediaDirect\(puppyId, 'photo', \(await prepareImageForUpload\(file\)\)\.base64, 'image\/jpeg'\)/.test(littersPageSrc))
  check('A failed compression/decode (ImageCompressionError) surfaces its own specific, actionable message rather than a generic "Upload failed"',
    /reason instanceof ImageCompressionError \? reason\.message/.test(littersPageSrc))
}

// ── vite-env.d.ts: the ambient module declaration this TS build needs
// for the untyped libheif-js/wasm-bundle import ──
{
  const viteEnvSrc = readFileSync(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8')
  check("vite-env.d.ts declares the 'libheif-js/wasm-bundle' ambient module (no @types package exists for it)",
    /declare module 'libheif-js\/wasm-bundle'/.test(viteEnvSrc))
}

// ── package.json: direct imports require a direct dependency. ──
{
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  check('libheif-js is declared directly and pinned to the reviewed LGPL-3.0 build', allDeps['libheif-js'] === '1.19.8')
  check('heic-convert (the existing dependency libheif-js comes in through) is still declared', 'heic-convert' in allDeps)
}

summary()
