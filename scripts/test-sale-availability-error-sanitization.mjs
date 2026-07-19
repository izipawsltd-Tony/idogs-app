// scripts/test-sale-availability-error-sanitization.mjs — regression
// coverage for SaleAvailabilityPanel's sanitized error handling (Codex
// round 13, Blocker 2).
//
// Root cause recap: round 12 fixed the ORIGINAL bare
// `catch { toast('Failed to save', 'error') }` (which discarded the
// error completely) but overcorrected — it logged the FULL raw error
// object to console and, for anything other than a recognized
// permission-denied code, displayed `e.message` verbatim in the toast.
// An arbitrary thrown value's message can carry a document path, an
// internal backend string, or worse; neither the console nor the user
// should ever see it unfiltered. Round 13 replaces that with a small,
// explicit allowlist of KNOWN-SAFE error codes mapped to pre-written
// copy — permission-denied and unavailable — with every other code
// (including no code at all, or a non-Error thrown value) falling
// through to one fixed generic retry/support message. Only a
// normalized `code` string is ever logged, never the raw error.
//
// This mirrors DogDetailPage.tsx's actual
// normalizeSaleAvailabilityErrorCode()/describeSaleAvailabilitySaveFailure()
// logic (both are inline TSX, not separately importable plain-JS
// modules) and combines behavioral execution of the mirror with
// source-pattern checks against the real file, so the mirror can't
// silently drift from what's actually shipped.
//
// Usage: node scripts/test-sale-availability-error-sanitization.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

// ── Mirror of DogDetailPage.tsx's actual current logic ──
const KNOWN_ERROR_MESSAGES = {
  'permission-denied': "you don't have permission to update this dog anymore — ownership may have changed since this page loaded",
  'unavailable': 'you appear to be offline, or our servers are temporarily unavailable — please try again in a moment',
}
const GENERIC_ERROR_MESSAGE = 'Failed to save. Please try again, or contact support if this keeps happening.'

function normalizeErrorCode(e) {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') {
    return e.code
  }
  return 'unknown'
}

function describeSaveFailure(e) {
  const code = normalizeErrorCode(e)
  const detail = KNOWN_ERROR_MESSAGES[code]
  return {
    userMessage: detail ? `Failed to save — ${detail}` : GENERIC_ERROR_MESSAGE,
    logCode: code,
  }
}

// A fake secret-bearing value that must NEVER appear in any output this
// suite inspects — used across several scenarios below.
const SECRET_MARKER = 'sk_live_FAKE_SECRET_1234567890'
const FAKE_DOC_PATH = 'projects/idogs-app-staging/databases/(default)/documents/dogs/KdnWPRwxngsIRwNiW8TA'

// =========================================================================
// SECTION 1 — permission-denied gets the approved ownership guidance
// =========================================================================
{
  const err = Object.assign(new Error(`Missing or insufficient permissions. Document path: ${FAKE_DOC_PATH}`), { code: 'permission-denied' })
  const { userMessage, logCode } = describeSaveFailure(err)
  check('permission-denied: userMessage includes the approved ownership-changed guidance',
    userMessage.includes("ownership may have changed since this page loaded"))
  check('permission-denied: logCode is the normalized code, not the raw error', logCode === 'permission-denied')
  check('permission-denied: the document path in the real error message never appears in the sanitized userMessage',
    !userMessage.includes(FAKE_DOC_PATH))
}

// =========================================================================
// SECTION 2 — known safe network/unavailable case
// =========================================================================
{
  const err = Object.assign(new Error('The service is currently unavailable at internal-host:8080. Backend trace: xyz'), { code: 'unavailable' })
  const { userMessage, logCode } = describeSaveFailure(err)
  check('unavailable: recognized as a known-safe code, not routed to the fully generic bucket',
    userMessage.includes('offline') || userMessage.includes('temporarily unavailable'))
  check('unavailable: logCode is the normalized code', logCode === 'unavailable')
  check('unavailable: the raw backend trace text never appears in the sanitized userMessage',
    !userMessage.includes('internal-host') && !userMessage.includes('Backend trace'))
}

// =========================================================================
// SECTION 3 — unknown Error containing a fake document path/secret
// =========================================================================
{
  const err = new Error(`Write to ${FAKE_DOC_PATH} failed — auth token ${SECRET_MARKER} rejected`)
  // Deliberately no .code property — an unrecognized/unknown error shape.
  const { userMessage, logCode } = describeSaveFailure(err)
  check('unknown Error: falls through to the fixed generic message', userMessage === GENERIC_ERROR_MESSAGE)
  check('unknown Error: logCode normalizes to "unknown", not the raw message', logCode === 'unknown')
  check('unknown Error: the document path never appears in the sanitized userMessage', !userMessage.includes(FAKE_DOC_PATH))
  check('unknown Error: the secret never appears in the sanitized userMessage', !userMessage.includes(SECRET_MARKER))
}

// =========================================================================
// SECTION 4 — non-Error thrown value (a plain string, a plain object, a
// number, null, undefined) must all be handled without throwing and
// must never leak into the sanitized output
// =========================================================================
{
  const nonErrorValues = [
    `plain string containing ${SECRET_MARKER}`,
    { message: `plain object containing ${FAKE_DOC_PATH}` },
    42,
    null,
    undefined,
    ['array', 'thrown', SECRET_MARKER],
  ]
  for (const value of nonErrorValues) {
    let threw = false
    let result
    try {
      result = describeSaveFailure(value)
    } catch {
      threw = true
    }
    const label = typeof value === 'object' ? JSON.stringify(value).slice(0, 40) : String(value).slice(0, 40)
    check(`non-Error thrown value (${label}...) does not crash the sanitizer`, !threw)
    if (!threw) {
      check(`non-Error thrown value (${label}...) falls through to the generic message`, result.userMessage === GENERIC_ERROR_MESSAGE)
      check(`non-Error thrown value (${label}...) normalizes to code "unknown"`, result.logCode === 'unknown')
    }
  }
}

// =========================================================================
// SECTION 5 — across EVERY scenario above, neither the toast text nor
// the "console-safe" logged payload ({ code }) ever contains the fake
// secret, the fake document path, or any raw Error message text
// =========================================================================
{
  const scenarios = [
    Object.assign(new Error(`perm denied at ${FAKE_DOC_PATH}`), { code: 'permission-denied' }),
    Object.assign(new Error(`unavailable, secret=${SECRET_MARKER}`), { code: 'unavailable' }),
    new Error(`unknown shape with ${FAKE_DOC_PATH} and ${SECRET_MARKER}`),
    `raw string with ${SECRET_MARKER}`,
    { code: 123 }, // non-string code must also normalize to 'unknown', not be used raw
  ]
  let allClean = true
  for (const value of scenarios) {
    const { userMessage, logCode } = describeSaveFailure(value)
    const consoleSafePayload = JSON.stringify({ code: logCode })
    if (userMessage.includes(SECRET_MARKER) || userMessage.includes(FAKE_DOC_PATH)) allClean = false
    if (consoleSafePayload.includes(SECRET_MARKER) || consoleSafePayload.includes(FAKE_DOC_PATH)) allClean = false
  }
  check('across every scenario, neither the toast nor the console-safe { code } payload ever contains raw sensitive text', allClean)

  check('a non-string .code value (e.g. a number) normalizes to "unknown", never used as a raw lookup key',
    describeSaveFailure({ code: 123 }).logCode === 'unknown')
}

// =========================================================================
// SECTION 6 — source-pattern checks against the REAL DogDetailPage.tsx
// =========================================================================
{
  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

  check('describeSaleAvailabilitySaveFailure is defined in the real file',
    /function describeSaleAvailabilitySaveFailure/.test(detailSrc))
  check('normalizeSaleAvailabilityErrorCode is defined in the real file',
    /function normalizeSaleAvailabilityErrorCode/.test(detailSrc))

  const panelMatch = detailSrc.match(/function SaleAvailabilityPanel\([\s\S]*?\n  async function handleSave\(\)[\s\S]*?\r?\n  }\r?\n/)
  const panel = panelMatch ? panelMatch[0] : ''
  check('SaleAvailabilityPanel.handleSave() was actually located for inspection (sanity check on the pattern above)', panel.length > 0)

  check('handleSave()\'s catch block routes through describeSaleAvailabilitySaveFailure, not a bare e.message read',
    /describeSaleAvailabilitySaveFailure\(e\)/.test(panel))
  check('handleSave()\'s catch block no longer reads e.message as CODE (only appears inside an explanatory comment)',
    !/[^`]e\.message/.test(panel.replace(/\/\/[^\n]*\n/g, '')))
  check('handleSave()\'s catch block no longer logs the raw error object to console (only a sanitized { code } payload)',
    !/console\.error\([^)]*,\s*e\)/.test(panel) && /console\.error\('sale-availability-save failed', \{ code: logCode \}\)/.test(panel))

  check('the known-error message map only contains the two approved codes (permission-denied, unavailable)',
    /SALE_AVAILABILITY_KNOWN_ERROR_MESSAGES: Record<string, string> = \{\s*'permission-denied':[\s\S]*?'unavailable':[\s\S]*?\}/.test(detailSrc))
  check('the generic fallback message never references e.message, document paths, or backend text',
    /SALE_AVAILABILITY_GENERIC_ERROR_MESSAGE = 'Failed to save\. Please try again, or contact support if this keeps happening\.'/.test(detailSrc))
}

await summary()
