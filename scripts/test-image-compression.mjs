// scripts/test-image-compression.mjs — regression coverage for
// src/lib/imageCompression.ts (Tony live-staging fix round: "large-image
// upload 413").
//
// Root cause recap (see imageCompression.ts's own header comment for the
// full story): this project's api/*.js are plain Vercel Serverless
// Functions ("Other" framework preset), which reject any request body
// over ~4.5MB with a platform-level 413 before the function code ever
// runs — no vercel.json override exists anywhere in this repo. A real
// phone photo, base64-encoded, routinely exceeds that on its own, long
// before api/_lib/image-pipeline.js's own much more generous
// MAX_IMAGE_INPUT_BYTES (30MB) check ever gets a chance to run.
//
// Structural/source-inspection only, deliberately, matching this
// project's established pattern for client-only code that touches real
// DOM/Canvas/Image/FileReader APIs unavailable in plain Node (no jsdom
// dependency exists in this repo) — see test-litter-showcase.mjs's own
// ShowcaseManager checks for the same convention. The actual upload
// success/failure PATH (compressed base64 reaching api/upload-showcase-
// media.js and surviving image-pipeline.js's own magic-byte/size checks)
// is covered end-to-end by test-showcase-media-pipeline.mjs against the
// real emulator — this file only verifies imageCompression.ts's own
// exported contract and how LittersPage.tsx wires it in.

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const src = readFileSync(new URL('../src/lib/imageCompression.ts', import.meta.url), 'utf8')

check('exports MAX_HEIC_UPLOAD_BYTES', /export const MAX_HEIC_UPLOAD_BYTES = /.test(src))
check('exports MAX_VIDEO_UPLOAD_BYTES', /export const MAX_VIDEO_UPLOAD_BYTES = /.test(src))
check('exports readFileAsBase64', /export function readFileAsBase64/.test(src))
check('exports compressImageFile', /export function compressImageFile/.test(src))
check('exports prepareImageForUpload', /export async function prepareImageForUpload/.test(src))
check('exports ImageCompressionError', /export class ImageCompressionError extends Error/.test(src))

// The actual numeric ceilings must stay comfortably under Vercel's
// ~4.5MB body limit even after base64 encoding (~33% larger) — verified
// directly here (not just "a constant exists") since a regression that
// silently raised these back toward/above the real platform ceiling
// would reintroduce the exact bug this fix round exists for.
{
  // Parses only a strict `<number> (\* <number>)*` expression — never a
  // generic eval() of source text — into its numeric product.
  function parseByteExpression(text) {
    const parts = text.trim().split('*').map(part => part.trim())
    if (!parts.every(part => /^\d+(\.\d+)?$/.test(part))) return null
    return parts.reduce((product, part) => product * Number(part), 1)
  }
  const heicMatch = /export const MAX_HEIC_UPLOAD_BYTES = ([\d.*\s]+)$/m.exec(src)
  const videoMatch = /export const MAX_VIDEO_UPLOAD_BYTES = ([\d.*\s]+)$/m.exec(src)
  const heicBytes = heicMatch ? parseByteExpression(heicMatch[1]) : null
  const videoBytes = videoMatch ? parseByteExpression(videoMatch[1]) : null
  // A small buffer below the full ~4.5MB ceiling accounts for the rest
  // of the JSON request body (token, kind, other fields) around the
  // base64 payload itself — the point is "comfortably under", not
  // "exactly at", the platform limit.
  const VERCEL_BODY_CEILING_WITH_BUFFER_BYTES = 4.3 * 1024 * 1024
  check('MAX_HEIC_UPLOAD_BYTES parses as a genuine numeric byte expression', heicBytes !== null)
  check('MAX_VIDEO_UPLOAD_BYTES parses as a genuine numeric byte expression', videoBytes !== null)
  check('MAX_HEIC_UPLOAD_BYTES, base64-inflated (~1.37x), stays comfortably under the ~4.5MB Vercel body ceiling', !!heicBytes && heicBytes * 1.37 < VERCEL_BODY_CEILING_WITH_BUFFER_BYTES, `${heicBytes} bytes`)
  check('MAX_VIDEO_UPLOAD_BYTES, base64-inflated (~1.37x), stays comfortably under the ~4.5MB Vercel body ceiling', !!videoBytes && videoBytes * 1.37 < VERCEL_BODY_CEILING_WITH_BUFFER_BYTES, `${videoBytes} bytes`)
}

// compressImageFile: same proven technique as the already-approved
// PhotoUpload.tsx resizeImage() (canvas draw + toDataURL), generalized
// with a configurable max dimension/quality instead of a second inline
// copy of the same logic.
check('compressImageFile caps the LARGER dimension, preserving aspect ratio (never stretches/crops)',
  /if \(width > maxDimension \|\| height > maxDimension\)/.test(src) && /width > height/.test(src))
check('compressImageFile re-encodes as JPEG via canvas.toDataURL', /canvas\.toDataURL\('image\/jpeg', quality\)/.test(src))
check('compressImageFile uses a Showcase-appropriate default dimension (1600px) — larger than PhotoUpload.tsx\'s 800px avatar cap, since gallery photos display much bigger', /MAX_GALLERY_DIMENSION = 1600/.test(src))
check('compressImageFile has a timeout safety net (an unsupported/corrupt format must fail, never hang forever with no feedback)',
  /setTimeout\(\(\) => \{[\s\S]{0,200}reject\(new ImageCompressionError\('TIMEOUT'/.test(src))
check('compressImageFile rejects with a clear, actionable message on both onerror and timeout (never a bare/generic Error)',
  /reject\(new ImageCompressionError\('UNREADABLE'/.test(src) && /reject\(new ImageCompressionError\('TIMEOUT'/.test(src))
check('compressImageFile always revokes its own object URL (on success AND on every failure path) — no blob URL leak', (src.match(/URL\.revokeObjectURL\(url\)/g) || []).length >= 3)

// prepareImageForUpload: HEIC/HEIF cannot be decoded into a canvas by
// any browser except Safari (see lib/heic.ts's own header comment) — the
// only safe behavior is to skip compression entirely and let the
// server's own heic-convert-based pipeline (api/_lib/image-pipeline.js)
// handle it, exactly like the already-approved PhotoUpload.tsx does.
check('prepareImageForUpload sends a HEIC/HEIF file raw (uncompressed) to the server, never attempts to compress it',
  /if \(isHeicFile\(file\)\) \{[\s\S]{0,150}return \{ base64, mediaType/.test(src))
check('prepareImageForUpload compresses every non-HEIC file before returning it', /return compressImageFile\(file\)/.test(src))

// ── LittersPage.tsx wiring — confirms the module is actually USED, not
// just defined. The Draft → Save behavioral checks (queuing, size-limit
// rejection messages, etc.) live in test-litter-showcase.mjs alongside
// the rest of ShowcaseManager's own tests; these are narrowly scoped to
// "is the right function from the right module actually being called". ──
{
  const littersPageSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('LittersPage.tsx imports prepareImageForUpload/readFileAsBase64/the byte-limit constants/ImageCompressionError from lib/imageCompression',
    /import \{ prepareImageForUpload, readFileAsBase64, MAX_HEIC_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES, ImageCompressionError \} from '\.\.\/lib\/imageCompression'/.test(littersPageSrc))
  check('handleSaveShowcaseDraft calls prepareImageForUpload for photo uploads (never sends a raw, uncompressed non-HEIC file)',
    /kind === 'photo'\s*\n\s*\? await prepareImageForUpload\(file\)/.test(littersPageSrc))
  check('A failed compression (ImageCompressionError) surfaces its own specific, actionable message rather than a generic "Upload failed"',
    /reason instanceof ImageCompressionError \? reason\.message/.test(littersPageSrc))
}

summary()
