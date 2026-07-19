// scripts/test-sale-availability-error-sanitization.mjs — regression
// coverage for the Sale & availability save-error sanitizer (Codex round
// 13 Blocker 2, hardened in round 14 Blocker 3).
//
// Root cause recap: round 12 fixed the ORIGINAL bare
// `catch { toast('Failed to save', 'error') }` (which discarded the
// error completely) but overcorrected — it logged the FULL raw error
// object to console and, for anything other than a recognized
// permission-denied code, displayed `e.message` verbatim in the toast.
// Round 13 replaced that with a small, explicit allowlist of KNOWN-SAFE
// error codes mapped to pre-written copy, with every other code falling
// through to one fixed generic message.
//
// Round 14: the logic previously lived inline in DogDetailPage.tsx (JSX,
// not directly importable from a plain Node script), so this suite used
// to run a hand-maintained MIRROR of that logic — real coverage of the
// mirror's behavior, but no guarantee the mirror hadn't drifted from
// what was actually shipped (only checked via separate regex source-
// pattern assertions against the real file). The logic has now been
// extracted into src/lib/saleAvailabilityError.ts, a plain .ts module
// with no JSX — this suite imports it DIRECTLY (Node 24 can execute a
// plain, "erasable syntax" .ts file over ESM with no build step), so
// every check below runs the actual production code, not a copy of it.
//
// Round 14 also hardens normalizeSaleAvailabilityErrorCode() itself: the
// round-13 version read `e.code` THREE separate times (an `in` check, a
// `typeof` cast, then again in the return) — safe for a plain object,
// but a Proxy or an object with a throwing/side-effecting/inconsistent
// getter for `code` could throw on a later read, return a different
// value each time, or otherwise misbehave. The new version reads `code`
// AT MOST ONCE, inside try/catch, and is asserted here to never throw
// regardless of what kind of hostile value is thrown at it.
//
// Round 15, Blocker 4: round 14 read `code` safely but still returned it
// VERBATIM as long as it was a string — so a `.code` that happened to be
// a Firestore document path, a bearer token, an email address, or a
// UID-shaped string (any of which some future or malicious caller could
// set) would flow straight into `logCode`, which console.error DOES
// write. Only 'permission-denied' and 'unavailable' — the two codes this
// module actually has copy for — may ever pass through; every other
// string, including other real-looking Firestore codes, normalizes to
// the same fixed 'unknown'. See Section 8 below.
//
// Usage: node scripts/test-sale-availability-error-sanitization.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import {
  normalizeSaleAvailabilityErrorCode,
  describeSaleAvailabilitySaveFailure,
  SALE_AVAILABILITY_GENERIC_ERROR_MESSAGE,
} from '../src/lib/saleAvailabilityError.ts'

const { check, summary } = makeChecker()

// A fake secret-bearing value that must NEVER appear in any output this
// suite inspects — used across several scenarios below.
const SECRET_MARKER = 'sk_live_FAKE_SECRET_1234567890'
const FAKE_DOC_PATH = 'projects/idogs-app-staging/databases/(default)/documents/dogs/KdnWPRwxngsIRwNiW8TA'

// =========================================================================
// SECTION 1 — permission-denied gets the approved ownership guidance
// =========================================================================
{
  const err = Object.assign(new Error(`Missing or insufficient permissions. Document path: ${FAKE_DOC_PATH}`), { code: 'permission-denied' })
  const { userMessage, logCode } = describeSaleAvailabilitySaveFailure(err)
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
  const { userMessage, logCode } = describeSaleAvailabilitySaveFailure(err)
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
  const { userMessage, logCode } = describeSaleAvailabilitySaveFailure(err)
  check('unknown Error: falls through to the fixed generic message', userMessage === SALE_AVAILABILITY_GENERIC_ERROR_MESSAGE)
  check('unknown Error: logCode normalizes to "unknown", not the raw message', logCode === 'unknown')
  check('unknown Error: the document path never appears in the sanitized userMessage', !userMessage.includes(FAKE_DOC_PATH))
  check('unknown Error: the secret never appears in the sanitized userMessage', !userMessage.includes(SECRET_MARKER))
}

// =========================================================================
// SECTION 4 — non-Error thrown values (plain string, plain object, number,
// null, undefined, array) must all be handled without throwing and must
// never leak into the sanitized output
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
      result = describeSaleAvailabilitySaveFailure(value)
    } catch {
      threw = true
    }
    const label = typeof value === 'object' ? JSON.stringify(value).slice(0, 40) : String(value).slice(0, 40)
    check(`non-Error thrown value (${label}...) does not crash the sanitizer`, !threw)
    if (!threw) {
      check(`non-Error thrown value (${label}...) falls through to the generic message`, result.userMessage === SALE_AVAILABILITY_GENERIC_ERROR_MESSAGE)
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
    const { userMessage, logCode } = describeSaleAvailabilitySaveFailure(value)
    const consoleSafePayload = JSON.stringify({ code: logCode })
    if (userMessage.includes(SECRET_MARKER) || userMessage.includes(FAKE_DOC_PATH)) allClean = false
    if (consoleSafePayload.includes(SECRET_MARKER) || consoleSafePayload.includes(FAKE_DOC_PATH)) allClean = false
  }
  check('across every scenario, neither the toast nor the console-safe { code } payload ever contains raw sensitive text', allClean)

  check('a non-string .code value (e.g. a number) normalizes to "unknown", never used as a raw lookup key',
    describeSaleAvailabilitySaveFailure({ code: 123 }).logCode === 'unknown')
}

// =========================================================================
// SECTION 6 (round 14, Blocker 3) — throwing getters, Proxies, Symbols,
// and other hostile shapes must never crash the sanitizer, and `code`
// must be read AT MOST ONCE
// =========================================================================
{
  // 6a — a getter that throws every time it's accessed
  const throwingGetterErr = {}
  Object.defineProperty(throwingGetterErr, 'code', {
    get() { throw new Error(`getter exploded, leaking ${SECRET_MARKER}`) },
    enumerable: true,
  })
  let threw = false
  let result
  try {
    result = describeSaleAvailabilitySaveFailure(throwingGetterErr)
  } catch {
    threw = true
  }
  check('throwing getter for .code: sanitizer never throws', !threw)
  check('throwing getter for .code: normalizes to "unknown"', !threw && result.logCode === 'unknown')
  check('throwing getter for .code: userMessage is the fixed generic message', !threw && result.userMessage === SALE_AVAILABILITY_GENERIC_ERROR_MESSAGE)

  // 6b — a getter that returns a DIFFERENT value on each read, to detect
  // any code path that reads `.code` more than once
  let readCount = 0
  const inconsistentErr = {}
  Object.defineProperty(inconsistentErr, 'code', {
    get() {
      readCount++
      return readCount === 1 ? 'permission-denied' : 'unavailable'
    },
    enumerable: true,
  })
  const inconsistentResult = describeSaleAvailabilitySaveFailure(inconsistentErr)
  check('inconsistent .code getter: does not crash', true)
  check('inconsistent .code getter: read at most once (readCount <= 1)', readCount <= 1,
    `readCount was ${readCount}`)
  check('inconsistent .code getter: result is internally consistent with a single read',
    (readCount === 1 && inconsistentResult.logCode === 'permission-denied') || readCount === 0)

  // 6c — a Proxy whose `get` trap throws
  const throwingProxy = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'code') throw new Error('proxy get trap exploded')
      return undefined
    },
    has() { return true },
  })
  let proxyThrew = false
  let proxyResult
  try {
    proxyResult = describeSaleAvailabilitySaveFailure(throwingProxy)
  } catch {
    proxyThrew = true
  }
  check('throwing Proxy get trap: sanitizer never throws', !proxyThrew)
  check('throwing Proxy get trap: normalizes to "unknown"', !proxyThrew && proxyResult.logCode === 'unknown')

  // 6d — a Proxy whose `has` trap throws (hit by the `'code' in e` check)
  const throwingHasProxy = new Proxy({}, {
    has() { throw new Error('proxy has trap exploded') },
  })
  let hasProxyThrew = false
  let hasProxyResult
  try {
    hasProxyResult = describeSaleAvailabilitySaveFailure(throwingHasProxy)
  } catch {
    hasProxyThrew = true
  }
  check('throwing Proxy has trap: sanitizer never throws', !hasProxyThrew)
  check('throwing Proxy has trap: normalizes to "unknown"', !hasProxyThrew && hasProxyResult.logCode === 'unknown')

  // 6e — a Symbol thrown directly (not even an object)
  let symbolThrew = false
  let symbolResult
  try {
    symbolResult = describeSaleAvailabilitySaveFailure(Symbol('boom'))
  } catch {
    symbolThrew = true
  }
  check('thrown Symbol: sanitizer never throws', !symbolThrew)
  check('thrown Symbol: normalizes to "unknown"', !symbolThrew && symbolResult.logCode === 'unknown')

  // 6f — .code itself is a Symbol (not a string) — must not be used raw
  let symbolCodeThrew = false
  let symbolCodeResult
  try {
    symbolCodeResult = describeSaleAvailabilitySaveFailure({ code: Symbol('weird-code') })
  } catch {
    symbolCodeThrew = true
  }
  check('.code is a Symbol: sanitizer never throws', !symbolCodeThrew)
  check('.code is a Symbol: normalizes to "unknown", not used as a raw key', !symbolCodeThrew && symbolCodeResult.logCode === 'unknown')

  // 6g — normalizeSaleAvailabilityErrorCode() directly, same hostile
  // inputs, confirming the exported low-level function is equally safe
  // (not just the higher-level describe... wrapper)
  check('normalizeSaleAvailabilityErrorCode() on throwing getter never throws and returns "unknown"',
    (() => { try { return normalizeSaleAvailabilityErrorCode(throwingGetterErr) === 'unknown' } catch { return false } })())
  check('normalizeSaleAvailabilityErrorCode() on throwing Proxy never throws and returns "unknown"',
    (() => { try { return normalizeSaleAvailabilityErrorCode(throwingProxy) === 'unknown' } catch { return false } })())
}

// =========================================================================
// SECTION 7 (round 14) — source-pattern checks against the REAL,
// extracted module + the DogDetailPage.tsx call site, confirming the
// component actually imports and uses the production helper rather than
// an inline copy
// =========================================================================
{
  const moduleSrc = readFileSync(new URL('../src/lib/saleAvailabilityError.ts', import.meta.url), 'utf8')
  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

  check('describeSaleAvailabilitySaveFailure is defined in the extracted module',
    /export function describeSaleAvailabilitySaveFailure/.test(moduleSrc))
  check('normalizeSaleAvailabilityErrorCode is defined in the extracted module',
    /export function normalizeSaleAvailabilityErrorCode/.test(moduleSrc))
  check('normalizeSaleAvailabilityErrorCode reads .code inside a try block (getter/proxy-safe)',
    /try\s*\{[\s\S]*?\.code[\s\S]*?\}\s*catch/.test(moduleSrc))
  check('DogDetailPage.tsx no longer defines its own inline copy of the normalizer',
    !/function normalizeSaleAvailabilityErrorCode/.test(detailSrc))
  check('DogDetailPage.tsx no longer defines its own inline copy of describeSaleAvailabilitySaveFailure',
    !/function describeSaleAvailabilitySaveFailure/.test(detailSrc))
  check('DogDetailPage.tsx imports the real helper from ../lib/saleAvailabilityError',
    /import\s*\{\s*describeSaleAvailabilitySaveFailure\s*\}\s*from\s*'\.\.\/lib\/saleAvailabilityError'/.test(detailSrc))

  const panelMatch = detailSrc.match(/function SaleAvailabilityPanel\([\s\S]*?\n  async function handleSave\(\)[\s\S]*?\r?\n  }\r?\n/)
  const panel = panelMatch ? panelMatch[0] : ''
  check('SaleAvailabilityPanel.handleSave() was actually located for inspection (sanity check on the pattern above)', panel.length > 0)
  check('handleSave()\'s catch block routes through describeSaleAvailabilitySaveFailure, not a bare e.message read',
    /describeSaleAvailabilitySaveFailure\(e\)/.test(panel))
  check('handleSave()\'s catch block no longer reads e.message as CODE (only appears inside an explanatory comment)',
    !/[^`]e\.message/.test(panel.replace(/\/\/[^\n]*\n/g, '')))
  check('handleSave()\'s catch block no longer logs the raw error object to console (only a sanitized { code } payload)',
    !/console\.error\([^)]*,\s*e\)/.test(panel) && /console\.error\('sale-availability-save failed', \{ code: logCode \}\)/.test(panel))
}

// =========================================================================
// SECTION 8 (round 15, Blocker 4) — only the two APPROVED codes may pass
// through as-is; every other string — including token/path/email/UID-
// shaped sensitive-looking text, and other real Firestore codes this
// module has no copy for — normalizes to the fixed 'unknown'
// =========================================================================
{
  const SENSITIVE_CODE_STRINGS = [
    'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.fake.token',
    'projects/idogs-app-staging/databases/(default)/documents/dogs/KdnWPRwxngsIRwNiW8TA',
    'breeder@idogs.com.au',
    '4ZcrPyvMabcdef1234567890uidlike',
    'sk_live_FAKE_SECRET_1234567890',
    '../../../etc/passwd',
    '<script>alert(1)</script>',
  ]
  for (const sensitive of SENSITIVE_CODE_STRINGS) {
    const code = normalizeSaleAvailabilityErrorCode({ code: sensitive })
    check(`sensitive-looking .code string ("${sensitive.slice(0, 24)}...") normalizes to "unknown", never passed through raw`,
      code === 'unknown')
  }

  // Real Firestore codes that exist but are NOT in this module's small
  // approved allowlist — round 13/14 only ever mapped permission-denied
  // and unavailable to copy; every other genuine code must ALSO
  // normalize to 'unknown', not leak through just because it looks like
  // a legitimate Firestore error code.
  const OTHER_REAL_FIRESTORE_CODES = [
    'cancelled', 'deadline-exceeded', 'not-found', 'already-exists',
    'resource-exhausted', 'failed-precondition', 'aborted', 'out-of-range',
    'unimplemented', 'internal', 'unauthenticated', 'invalid-argument',
  ]
  for (const realCode of OTHER_REAL_FIRESTORE_CODES) {
    check(`real but non-approved Firestore code "${realCode}" also normalizes to "unknown" (allowlist, not a denylist)`,
      normalizeSaleAvailabilityErrorCode({ code: realCode }) === 'unknown')
  }

  check('the ONLY two codes that pass through as-is are permission-denied and unavailable',
    normalizeSaleAvailabilityErrorCode({ code: 'permission-denied' }) === 'permission-denied' &&
    normalizeSaleAvailabilityErrorCode({ code: 'unavailable' }) === 'unavailable')

  // End-to-end: a sensitive string set as .code must never reach the
  // "console-safe" { code } payload OR the user-facing toast message.
  const SECRET_CODE = 'ya29.a0AfH6SMC-fake-oauth-access-token-leaked-here'
  const result = describeSaleAvailabilitySaveFailure({ code: SECRET_CODE })
  check('a sensitive .code string never reaches the sanitized logCode', result.logCode === 'unknown')
  check('a sensitive .code string never reaches the user-facing toast message', !result.userMessage.includes(SECRET_CODE))

  const moduleSrc = readFileSync(new URL('../src/lib/saleAvailabilityError.ts', import.meta.url), 'utf8')
  check('the module defines an explicit allowlist Set (not just a truthy/typeof string check)',
    /SALE_AVAILABILITY_ALLOWED_CODES = new Set\(\['permission-denied', 'unavailable'\]\)/.test(moduleSrc))
  check('normalizeSaleAvailabilityErrorCode checks membership in the allowlist before returning the code',
    /SALE_AVAILABILITY_ALLOWED_CODES\.has\(code\)/.test(moduleSrc))
}

await summary()
