// scripts/test-transfer-error-sanitization.mjs — Round 20 regression
// coverage for the dog-transfer save-error sanitizer
// (src/lib/transferError.ts), mirroring
// scripts/test-sale-availability-error-sanitization.mjs's structure and
// hostile-input coverage (Codex round 13/14/15 precedent for this exact
// kind of module).
//
// Root cause recap: transferDogOwnership() writes to dogs/{dogId}, which
// firestore.rules now guards with isEffectiveDogOwner/
// dogProtectedFieldsUnchanged (see firestore.rules and
// scripts/test-dog-update-legacy-rules.mjs). Whether a write is denied
// for a legitimate reason or hits a bug, the client must never surface or
// log the raw Firebase error — it can carry a Firestore document path,
// the caller's UID, the buyer name/email the form just collected, or (if
// the failure came from the transfer-email step instead) a provider
// payload/token/credential. This suite proves the sanitizer holds that
// line for every input shape, and that both real call sites
// (DogDetailPage.tsx's TransferModal.handleSubmit and LittersPage.tsx's
// handleTransferPuppy) actually use it.
//
// Usage: node scripts/test-transfer-error-sanitization.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import {
  normalizeTransferErrorCode,
  describeTransferFailure,
  TRANSFER_GENERIC_ERROR_MESSAGE,
} from '../src/lib/transferError.ts'

const { check, summary } = makeChecker()

const SECRET_MARKER = 'sk_live_FAKE_SECRET_1234567890'
const FAKE_DOC_PATH = 'projects/idogs-app-staging/databases/(default)/documents/dogs/KdnWPRwxngsIRwNiW8TA'
const FAKE_UID = '4ZcrPyvMabcdef1234567890uidlike'
const FAKE_BUYER_EMAIL = 'jane.buyer@example.com'

// =========================================================================
// SECTION 1 — permission-denied normalizes to the allowlisted code, but
// the CLIENT MESSAGE stays fixed (unlike saleAvailabilityError.ts, this
// module deliberately has no per-code copy — see the module's own header)
// =========================================================================
{
  const err = Object.assign(new Error(`Missing or insufficient permissions. Document path: ${FAKE_DOC_PATH} uid=${FAKE_UID}`), { code: 'permission-denied' })
  const { userMessage, logCode, logOperation } = describeTransferFailure(err)
  check('permission-denied: logCode is the normalized allowlisted code', logCode === 'permission-denied')
  check('permission-denied: userMessage is the fixed generic message, not per-code copy', userMessage === TRANSFER_GENERIC_ERROR_MESSAGE)
  check('permission-denied: logOperation is the fixed operation name', logOperation === 'transfer-ownership')
  check('permission-denied: the document path never appears in the sanitized userMessage', !userMessage.includes(FAKE_DOC_PATH))
  check('permission-denied: the uid never appears in the sanitized userMessage', !userMessage.includes(FAKE_UID))
}

// =========================================================================
// SECTION 2 — a real Firestore code NOT on this module's allowlist (e.g.
// 'unavailable') still normalizes to 'unknown' — allowlist, not denylist
// =========================================================================
{
  const err = Object.assign(new Error('The service is currently unavailable at internal-host:8080'), { code: 'unavailable' })
  const { userMessage, logCode } = describeTransferFailure(err)
  check('unavailable: NOT on this module\'s allowlist, normalizes to "unknown"', logCode === 'unknown')
  check('unavailable: userMessage is still the fixed generic message', userMessage === TRANSFER_GENERIC_ERROR_MESSAGE)
}

// =========================================================================
// SECTION 3 — unknown Error containing a fake path/secret/buyer email
// =========================================================================
{
  const err = new Error(`Write to ${FAKE_DOC_PATH} failed for buyer ${FAKE_BUYER_EMAIL} — auth token ${SECRET_MARKER} rejected`)
  const { userMessage, logCode } = describeTransferFailure(err)
  check('unknown Error: falls through to the fixed generic message', userMessage === TRANSFER_GENERIC_ERROR_MESSAGE)
  check('unknown Error: logCode normalizes to "unknown"', logCode === 'unknown')
  check('unknown Error: the document path never appears in userMessage', !userMessage.includes(FAKE_DOC_PATH))
  check('unknown Error: the buyer email never appears in userMessage', !userMessage.includes(FAKE_BUYER_EMAIL))
  check('unknown Error: the secret never appears in userMessage', !userMessage.includes(SECRET_MARKER))
}

// =========================================================================
// SECTION 4 — non-Error thrown values must never crash the sanitizer and
// must never leak into the sanitized output
// =========================================================================
{
  const nonErrorValues = [
    `plain string containing ${SECRET_MARKER}`,
    { message: `plain object containing ${FAKE_DOC_PATH}` },
    42,
    null,
    undefined,
    ['array', 'thrown', FAKE_BUYER_EMAIL],
  ]
  for (const value of nonErrorValues) {
    let threw = false
    let result
    try {
      result = describeTransferFailure(value)
    } catch {
      threw = true
    }
    const label = typeof value === 'object' ? JSON.stringify(value).slice(0, 40) : String(value).slice(0, 40)
    check(`non-Error thrown value (${label}...) does not crash the sanitizer`, !threw)
    if (!threw) {
      check(`non-Error thrown value (${label}...) falls through to the generic message`, result.userMessage === TRANSFER_GENERIC_ERROR_MESSAGE)
      check(`non-Error thrown value (${label}...) normalizes to code "unknown"`, result.logCode === 'unknown')
    }
  }
}

// =========================================================================
// SECTION 5 — across every scenario, neither the message nor the
// console-safe { operation, code } payload ever contains raw sensitive text
// =========================================================================
{
  const scenarios = [
    Object.assign(new Error(`perm denied at ${FAKE_DOC_PATH} for uid ${FAKE_UID}`), { code: 'permission-denied' }),
    Object.assign(new Error(`unavailable, secret=${SECRET_MARKER}`), { code: 'unavailable' }),
    new Error(`unknown shape with ${FAKE_DOC_PATH}, ${FAKE_UID}, ${FAKE_BUYER_EMAIL} and ${SECRET_MARKER}`),
    `raw string with ${SECRET_MARKER}`,
    { code: 123 },
  ]
  let allClean = true
  for (const value of scenarios) {
    const { userMessage, logCode, logOperation } = describeTransferFailure(value)
    const consoleSafePayload = JSON.stringify({ operation: logOperation, code: logCode })
    if ([userMessage, consoleSafePayload].some(s =>
      s.includes(SECRET_MARKER) || s.includes(FAKE_DOC_PATH) || s.includes(FAKE_UID) || s.includes(FAKE_BUYER_EMAIL))) {
      allClean = false
    }
  }
  check('across every scenario, neither the message nor the console-safe payload ever contains raw sensitive text', allClean)

  check('a non-string .code value (e.g. a number) normalizes to "unknown", never used as a raw lookup key',
    describeTransferFailure({ code: 123 }).logCode === 'unknown')
}

// =========================================================================
// SECTION 6 — throwing getters, Proxies, Symbols, and other hostile
// shapes must never crash the sanitizer, and `code` must be read AT MOST
// ONCE (same hardening precedent as saleAvailabilityError.ts round 14)
// =========================================================================
{
  const throwingGetterErr = {}
  Object.defineProperty(throwingGetterErr, 'code', {
    get() { throw new Error(`getter exploded, leaking ${SECRET_MARKER}`) },
    enumerable: true,
  })
  let threw = false, result
  try { result = describeTransferFailure(throwingGetterErr) } catch { threw = true }
  check('throwing getter for .code: sanitizer never throws', !threw)
  check('throwing getter for .code: normalizes to "unknown"', !threw && result.logCode === 'unknown')
  check('throwing getter for .code: userMessage is the fixed generic message', !threw && result.userMessage === TRANSFER_GENERIC_ERROR_MESSAGE)

  let readCount = 0
  const inconsistentErr = {}
  Object.defineProperty(inconsistentErr, 'code', {
    get() { readCount++; return readCount === 1 ? 'permission-denied' : 'unavailable' },
    enumerable: true,
  })
  const inconsistentResult = describeTransferFailure(inconsistentErr)
  check('inconsistent .code getter: read at most once', readCount <= 1, `readCount was ${readCount}`)
  check('inconsistent .code getter: result is internally consistent with a single read',
    (readCount === 1 && inconsistentResult.logCode === 'permission-denied') || readCount === 0)

  const throwingProxy = new Proxy({}, {
    get(_t, prop) { if (prop === 'code') throw new Error('proxy get trap exploded'); return undefined },
    has() { return true },
  })
  let proxyThrew = false, proxyResult
  try { proxyResult = describeTransferFailure(throwingProxy) } catch { proxyThrew = true }
  check('throwing Proxy get trap: sanitizer never throws', !proxyThrew)
  check('throwing Proxy get trap: normalizes to "unknown"', !proxyThrew && proxyResult.logCode === 'unknown')

  const throwingHasProxy = new Proxy({}, { has() { throw new Error('proxy has trap exploded') } })
  let hasProxyThrew = false, hasProxyResult
  try { hasProxyResult = describeTransferFailure(throwingHasProxy) } catch { hasProxyThrew = true }
  check('throwing Proxy has trap: sanitizer never throws', !hasProxyThrew)
  check('throwing Proxy has trap: normalizes to "unknown"', !hasProxyThrew && hasProxyResult.logCode === 'unknown')

  let symbolThrew = false, symbolResult
  try { symbolResult = describeTransferFailure(Symbol('boom')) } catch { symbolThrew = true }
  check('thrown Symbol: sanitizer never throws', !symbolThrew)
  check('thrown Symbol: normalizes to "unknown"', !symbolThrew && symbolResult.logCode === 'unknown')

  let symbolCodeThrew = false, symbolCodeResult
  try { symbolCodeResult = describeTransferFailure({ code: Symbol('weird-code') }) } catch { symbolCodeThrew = true }
  check('.code is a Symbol: sanitizer never throws', !symbolCodeThrew)
  check('.code is a Symbol: normalizes to "unknown"', !symbolCodeThrew && symbolCodeResult.logCode === 'unknown')

  check('normalizeTransferErrorCode() on throwing getter never throws and returns "unknown"',
    (() => { try { return normalizeTransferErrorCode(throwingGetterErr) === 'unknown' } catch { return false } })())
  check('normalizeTransferErrorCode() on throwing Proxy never throws and returns "unknown"',
    (() => { try { return normalizeTransferErrorCode(throwingProxy) === 'unknown' } catch { return false } })())
}

// =========================================================================
// SECTION 7 — only 'permission-denied' passes through; every other real
// Firestore code, and every sensitive-looking string, normalizes to
// 'unknown' (allowlist, not a denylist)
// =========================================================================
{
  const SENSITIVE_CODE_STRINGS = [
    'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.fake.token',
    FAKE_DOC_PATH,
    FAKE_BUYER_EMAIL,
    FAKE_UID,
    SECRET_MARKER,
    '../../../etc/passwd',
    '<script>alert(1)</script>',
  ]
  for (const sensitive of SENSITIVE_CODE_STRINGS) {
    check(`sensitive-looking .code string ("${sensitive.slice(0, 24)}...") normalizes to "unknown"`,
      normalizeTransferErrorCode({ code: sensitive }) === 'unknown')
  }

  const OTHER_REAL_FIRESTORE_CODES = [
    'unavailable', 'cancelled', 'deadline-exceeded', 'not-found', 'already-exists',
    'resource-exhausted', 'failed-precondition', 'aborted', 'out-of-range',
    'unimplemented', 'internal', 'unauthenticated', 'invalid-argument',
  ]
  for (const realCode of OTHER_REAL_FIRESTORE_CODES) {
    check(`real but non-approved Firestore code "${realCode}" also normalizes to "unknown"`,
      normalizeTransferErrorCode({ code: realCode }) === 'unknown')
  }

  check('the ONLY code that passes through as-is is permission-denied',
    normalizeTransferErrorCode({ code: 'permission-denied' }) === 'permission-denied')
}

// =========================================================================
// SECTION 8 — source-pattern checks against the REAL call sites, proving
// both DogDetailPage.tsx and LittersPage.tsx actually import and use the
// production sanitizer (not an inline raw console.error(err)/e.message)
// =========================================================================
{
  const moduleSrc = readFileSync(new URL('../src/lib/transferError.ts', import.meta.url), 'utf8')
  check('normalizeTransferErrorCode is defined in the module', /export function normalizeTransferErrorCode/.test(moduleSrc))
  check('describeTransferFailure is defined in the module', /export function describeTransferFailure/.test(moduleSrc))
  check('normalizeTransferErrorCode reads .code inside a try block (getter/proxy-safe)',
    /try\s*\{[\s\S]*?\.code[\s\S]*?\}\s*catch/.test(moduleSrc))
  check('the module defines an explicit allowlist Set (not a truthy/typeof string check)',
    /TRANSFER_ALLOWED_ERROR_CODES = new Set\(\['permission-denied'\]\)/.test(moduleSrc))

  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
  check('DogDetailPage.tsx imports describeTransferFailure from ../lib/transferError',
    /import\s*\{\s*describeTransferFailure\s*\}\s*from\s*'\.\.\/lib\/transferError'/.test(detailSrc))

  const transferModalMatch = detailSrc.match(/function TransferModal\([\s\S]*?\n  async function handleSubmit\(\)[\s\S]*?\n  \}\r?\n/)
  const transferModal = transferModalMatch ? transferModalMatch[0] : ''
  check('TransferModal.handleSubmit() was actually located for inspection (sanity check on the pattern above)', transferModal.length > 0)
  check('handleSubmit()\'s catch block routes through describeTransferFailure, not a bare catch {}',
    /describeTransferFailure\(err\)/.test(transferModal))
  check('handleSubmit()\'s catch block does not log the raw error object to console',
    !/console\.error\(err\)/.test(transferModal) && !/console\.error\([^)]*,\s*err\)/.test(transferModal))

  const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('LittersPage.tsx imports describeTransferFailure from ../lib/transferError',
    /import\s*\{\s*describeTransferFailure\s*\}\s*from\s*'\.\.\/lib\/transferError'/.test(littersSrc))

  const handleTransferPuppyMatch = littersSrc.match(/async function handleTransferPuppy\(\)[\s\S]*?\n  \}\r?\n/)
  const handleTransferPuppy = handleTransferPuppyMatch ? handleTransferPuppyMatch[0] : ''
  check('handleTransferPuppy() was actually located for inspection (sanity check on the pattern above)', handleTransferPuppy.length > 0)
  check('handleTransferPuppy()\'s catch block routes through describeTransferFailure, not a bare catch {}',
    /describeTransferFailure\(err\)/.test(handleTransferPuppy))
  check('handleTransferPuppy()\'s catch block does not log the raw error object to console',
    !/console\.error\(err\)/.test(handleTransferPuppy) && !/console\.error\([^)]*,\s*err\)/.test(handleTransferPuppy))

  check('src/components/ui/TransferOwnershipModal.tsx (unused component) is deliberately untouched by this fix',
    !/describeTransferFailure/.test(readFileSync(new URL('../src/components/ui/TransferOwnershipModal.tsx', import.meta.url), 'utf8')))
}

await summary()
