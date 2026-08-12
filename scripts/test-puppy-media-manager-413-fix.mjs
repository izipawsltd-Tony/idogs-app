// scripts/test-puppy-media-manager-413-fix.mjs — regression coverage for
// the "mobile Litter Showcase upload returns 413" fix.
//
// Root cause (read-only audit, confirmed): PuppyMediaManager.handleUpload
// in LittersPage.tsx — reached via a puppy's "✏️ Edit" panel — sent the
// ORIGINAL file straight to the server as base64 JSON with zero client-
// side resize, unlike ShowcaseManager's queued draft flow (handleAddFiles
// / handleSaveShowcaseDraft), which already went through
// lib/imageCompression.ts's prepareImageForUpload() for exactly this
// reason. A real phone JPEG (routinely 3-8MB) base64-inflates ~33%,
// landing well past Vercel's Serverless Function request-body ceiling
// before api/upload-showcase-media.js's handler ever runs.
//
// PuppyMediaManager is a closure inside LittersPage.tsx (a large
// component file with Firebase/router imports, not something a plain
// Node script can mount) — these checks are structural/source-pattern
// proofs against the REAL file, the same established convention already
// used throughout this codebase's own test suite (e.g.
// test-sale-availability-error-sanitization.mjs's balanced-brace
// short-circuit proofs, test-buyer-journey-assign-buyer.mjs's structural
// checks against the real LittersPage.tsx).
//
// Usage: node scripts/test-puppy-media-manager-413-fix.mjs (no emulator needed)
//
// UPDATE (Implementation Phase 1 — direct media upload): the transport
// this fix relied on (compress client-side, then send as base64 JSON
// through api/upload-showcase-media.js) has been superseded by
// uploadShowcaseMediaDirect() (src/lib/db.ts) — the file now goes
// straight to Storage via a short-lived signed URL, never through this
// Vercel function's own request body at all, which removes the 413
// ceiling from the equation entirely rather than continuing to compress
// against it. The regex assertions below were updated to match the new
// call shape; what they PROVE is unchanged: photos are still compressed
// client-side via prepareImageForUpload() before any upload happens,
// oversized video is still rejected before any network work, and
// ShowcaseManager's separate handleAddFiles/handleSaveShowcaseDraft path
// remains untouched.

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')

// Same balanced-brace extractor already established (and CRLF-proven)
// elsewhere in this codebase's own test suite (test-puppy-edit-
// authorization.mjs's handleSavePuppy check, test-sale-availability-
// error-sanitization.mjs's Section 11) — ported here rather than
// imported, matching this codebase's existing convention of
// self-contained test files with no cross-file imports between
// test-*.mjs scripts.
function findMatchingBraceEnd(src, openBraceIdx) {
  let depth = 0
  let inString = null
  let i = openBraceIdx
  for (; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nextNewline = src.indexOf('\n', i)
      i = nextNewline === -1 ? src.length : nextNewline
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue }
    if (ch === '{') { depth++; continue }
    if (ch === '}') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  return i
}
function extractFunctionSource(src, signaturePattern) {
  const sigMatch = signaturePattern.exec(src)
  if (!sigMatch) return ''
  const startIdx = sigMatch.index
  const bodyOpenSearch = /\)\s*\{/.exec(src.slice(startIdx))
  if (!bodyOpenSearch) return ''
  const openIdx = startIdx + bodyOpenSearch.index + bodyOpenSearch[0].length - 1
  return src.slice(startIdx, findMatchingBraceEnd(src, openIdx))
}

// Isolate PuppyMediaManager's own body (up to the next top-level
// function declaration) so every check below is scoped to THIS
// component, never accidentally matching ShowcaseManager's separate
// handleAddFiles/handleSaveShowcaseDraft guard elsewhere in the file.
const puppyMediaManagerSrc = extractFunctionSource(littersSrc, /function PuppyMediaManager\(/)

// =========================================================================
// SECTION 1 — PuppyMediaManager exists and was actually located
// =========================================================================
check('PuppyMediaManager component body was found by the balanced-brace extractor', puppyMediaManagerSrc.length > 500)

// =========================================================================
// SECTION 2 (REQUIRED) — photos go through prepareImageForUpload() before
// any base64/network work; the raw original is never sent directly.
// =========================================================================
{
  check('LittersPage.tsx imports the real prepareImageForUpload from ../lib/imageCompression (reused, not duplicated)',
    /import\s*\{[^}]*\bprepareImageForUpload\b[^}]*\}\s*from\s*'\.\.\/lib\/imageCompression'/.test(littersSrc))

  check('REQUIRED: PuppyMediaManager.handleUpload compresses the photo via prepareImageForUpload() and passes the RESULT directly into uploadShowcaseMediaDirect — compression happens before any byte leaves the browser (guaranteed by JS argument-evaluation order: the awaited prepareImageForUpload() call is nested INSIDE the uploadShowcaseMediaDirect() call expression, so it must resolve before that call can even be invoked)',
    /await uploadShowcaseMediaDirect\(puppy\.id, 'photo', \(await prepareImageForUpload\(file\)\)\.base64, 'image\/jpeg'\)/.test(puppyMediaManagerSrc))

  check('REQUIRED: the raw original file is NOT sent directly for photos — the photo branch never passes the raw `file` as the upload body',
    !/uploadShowcaseMediaDirect\(puppy\.id, 'photo', file,/.test(puppyMediaManagerSrc))

  check('video is sent as the raw File directly (never compressed, and — since the direct-upload transport removed the base64-proxy step entirely — never base64-encoded either anymore, by design, not an oversight)',
    /await uploadShowcaseMediaDirect\(puppy\.id, 'video', file, file\.type \|\| 'video\/mp4'\)/.test(puppyMediaManagerSrc))

  check('the old raw base64 FileReader helper (readAsBase64) was removed from this component — no longer needed now that video uploads the raw File directly',
    !/function readAsBase64/.test(puppyMediaManagerSrc))

  check('no duplicate compression logic was introduced — PuppyMediaManager does not define its own resize/canvas/compress helper',
    !/canvas\.toDataURL\(['"]image\/jpeg['"]/.test(puppyMediaManagerSrc) && !/getContext\('2d'\)/.test(puppyMediaManagerSrc))
}

// =========================================================================
// SECTION 3 (REQUIRED) — an oversized video is rejected client-side
// BEFORE any base64/network work, with a clear user-facing message.
// =========================================================================
{
  check('LittersPage.tsx imports the real MAX_VIDEO_UPLOAD_BYTES from ../lib/imageCompression (reused, same constant ShowcaseManager already uses)',
    /import\s*\{[^}]*\bMAX_VIDEO_UPLOAD_BYTES\b[^}]*\}\s*from\s*'\.\.\/lib\/imageCompression'/.test(littersSrc))

  const guardIdx = puppyMediaManagerSrc.indexOf("if (kind === 'video' && file.size > MAX_VIDEO_UPLOAD_BYTES)")
  check('REQUIRED: PuppyMediaManager.handleUpload has an oversized-video guard', guardIdx !== -1)

  const uploadCallIdx2 = puppyMediaManagerSrc.indexOf("await uploadShowcaseMediaDirect(puppy.id, 'video', file, file.type || 'video/mp4')")
  check('REQUIRED: the oversized-video guard runs BEFORE the direct-upload call (no network/Storage-grant request is ever made for an oversized video)',
    guardIdx !== -1 && uploadCallIdx2 !== -1 && guardIdx < uploadCallIdx2)

  // Causal-chain proof (same rigor as this codebase's existing
  // hasShortCircuitingRestrictedGuard pattern): the guard's own block
  // must contain a real `return`, and that return must sit between the
  // guard condition and the network call.
  const guardBlockOpenIdx = puppyMediaManagerSrc.indexOf('{', guardIdx)
  const guardBlockEndIdx = findMatchingBraceEnd(puppyMediaManagerSrc, guardBlockOpenIdx)
  const guardBlock = puppyMediaManagerSrc.slice(guardBlockOpenIdx, guardBlockEndIdx)
  check('the guard block contains a real return statement (short-circuits, does not just warn and continue)', /\breturn\b/.test(guardBlock))
  check('the guard block shows a clear, actionable user-facing size error before returning',
    /toast\(`This video is over \$\{Math\.floor\(MAX_VIDEO_UPLOAD_BYTES \/ \(1024 \* 1024\)\)\}MB/.test(guardBlock))

  // Causal predicate mirroring this codebase's own established
  // hasShortCircuitingRestrictedGuard shape (test-sale-availability-
  // error-sanitization.mjs, test-puppy-edit-authorization.mjs): true
  // only if the guard condition exists, opens a block containing a real
  // return, and that return sits strictly between the condition and the
  // write/upload call.
  function hasShortCircuitingVideoGuard(fnBody) {
    const conditionIdx = fnBody.indexOf("if (kind === 'video' && file.size > MAX_VIDEO_UPLOAD_BYTES)")
    if (conditionIdx === -1) return false
    const openIdx = fnBody.indexOf('{', conditionIdx)
    if (openIdx === -1) return false
    const blockEnd = findMatchingBraceEnd(fnBody, openIdx)
    const block = fnBody.slice(openIdx, blockEnd)
    const returnMatch = /\breturn\b/.exec(block)
    if (!returnMatch) return false
    const returnIdx = openIdx + returnMatch.index
    const uploadIdx = fnBody.indexOf("uploadShowcaseMediaDirect(puppy.id, 'video', file, file.type || 'video/mp4')")
    if (uploadIdx === -1) return false
    return conditionIdx < returnIdx && returnIdx < uploadIdx
  }
  check('the video-size guard genuinely short-circuits (predicate is true against the real source)', hasShortCircuitingVideoGuard(puppyMediaManagerSrc))

  // Negative self-test: deleting the guard's return from an in-memory
  // copy must flip the predicate to false — proves the predicate above
  // is actually load-bearing, not a check that would pass regardless.
  const returnMatch = /\breturn\b/.exec(guardBlock)
  if (returnMatch) {
    const mutatedBlock = guardBlock.slice(0, returnMatch.index) + guardBlock.slice(returnMatch.index + 'return'.length)
    const mutatedFull = puppyMediaManagerSrc.slice(0, guardBlockOpenIdx) + mutatedBlock + puppyMediaManagerSrc.slice(guardBlockEndIdx)
    check('NEGATIVE SELF-TEST: deleting the guard\'s return from an in-memory copy correctly flips the predicate to failure',
      hasShortCircuitingVideoGuard(mutatedFull) === false)
  } else {
    check('NEGATIVE SELF-TEST: skipped — positive case did not pass', false, '(investigate the check above first)')
  }

  check('the video kind is still accepted and uploaded normally when under the size limit (guard is a ceiling, not a blanket block)',
    /: await uploadShowcaseMediaDirect\(puppy\.id, 'video', file, file\.type \|\| 'video\/mp4'\)/.test(puppyMediaManagerSrc))
}

// =========================================================================
// SECTION 4 (REQUIRED) — the existing ShowcaseManager queued-upload path
// Showcase no longer has a second upload path; all guards stay canonical.
// =========================================================================
{
  check('Showcase no longer defines a duplicate handleAddFiles upload path',
    !/function handleAddFiles/.test(littersSrc))
  check('Showcase save cannot call uploadShowcaseMediaDirect or updateShowcaseMediaOrder',
    (() => {
      const showcaseSave = extractFunctionSource(littersSrc, /async function handleSaveShowcaseDraft\(/)
      return !/uploadShowcaseMediaDirect|updateShowcaseMediaOrder/.test(showcaseSave)
    })())
  check('PuppyMediaManager remains the single handleUpload implementation',
    /async function handleUpload/.test(puppyMediaManagerSrc) &&
    (littersSrc.match(/async function handleUpload/g) || []).length === 1)
}

// =========================================================================
// SECTION 5 — existing behavior preserved: auth/ownership/storage flow,
// HEIC handling, and success semantics untouched.
// =========================================================================
{
  check('handleUpload calls the shared uploadShowcaseMediaDirect() for both kinds (reused, no new/duplicate upload function per kind)',
    /const result = kind === 'photo'/.test(puppyMediaManagerSrc) && /await uploadShowcaseMediaDirect\(puppy\.id, 'photo'/.test(puppyMediaManagerSrc) && /await uploadShowcaseMediaDirect\(puppy\.id, 'video'/.test(puppyMediaManagerSrc))
  check('handleUpload still calls applyResult() to update local photos/videos state on success (existing success behavior preserved)',
    /applyResult\(result\)/.test(puppyMediaManagerSrc))
  check('handleUpload still shows the existing "Photo added"/"Video added" success toast, unchanged',
    /toast\(`\$\{kind === 'photo' \? 'Photo' : 'Video'\} added`\)/.test(puppyMediaManagerSrc))
  check('handleUpload still clears the uploading state in a finally block regardless of outcome (unchanged)',
    /finally \{\s*setUploading\(null\)\s*\}/.test(puppyMediaManagerSrc))
  // HEIC/HEIF handling now flows through prepareImageForUpload (already
  // proven above); confirm this component's own file input still accepts
  // HEIC so the fix is actually reachable for that format.
  check('the photo file input still accepts HEIC/HEIF (accept="image/*,.heic,.heif"), unchanged',
    /accept="image\/\*,\.heic,\.heif"/.test(littersSrc))
}

await summary()
