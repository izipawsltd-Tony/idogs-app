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

const { check, skip, summary } = makeChecker()

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
  // Codex fix-round (Black boy): the import gained a second named export
  // (normalizeSaleAvailabilityErrorCode, for the stale-ownership refetch
  // — see Section 9 below) — this check no longer requires
  // describeSaleAvailabilitySaveFailure to be the ONLY thing imported
  // from the module, just that it's still imported from the real one.
  check('DogDetailPage.tsx imports the real helper from ../lib/saleAvailabilityError',
    /import\s*\{[^}]*\bdescribeSaleAvailabilitySaveFailure\b[^}]*\}\s*from\s*'\.\.\/lib\/saleAvailabilityError'/.test(detailSrc))

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

// =========================================================================
// SECTION 9 (Codex fix-round — Sale & Availability permission failure):
// structural proof of the actual fix, plus a Rules-emulator permission
// matrix proving the ALLOWED and DENIED cases directly.
//
// Root cause: SaleAvailabilityPanel was gated purely on the account ROLE
// (`!isOwner`, i.e. "is a breeder-role account"), never on whether the
// viewer is THIS SPECIFIC dog's current effective owner
// (dog.currentOwnerId === user?.uid). A litter's puppy list
// (LittersPage.tsx) links to every puppy's detail page regardless of
// transfer status — including a "Transferred" one — so a former breeder
// could reach a transferred/claimed-away puppy's Overview tab, see an
// EDITABLE Sale & Availability form, and have every save attempt denied
// by firestore.rules' dogs/{dogId} update rule (isEffectiveDogOwner()),
// surfacing as "you don't have permission to update this dog anymore".
// That denial was always CORRECT Rules behavior — the bug was presenting
// an editable form to someone Rules would never allow to save. The fix
// threads DogDetailPage's existing isCurrentEffectiveOwner flag (already
// used to gate the Delete button) down through OverviewTab to also gate
// SaleAvailabilityPanel — no firestore.rules change at all.
// =========================================================================
{
  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
  check('OverviewTab accepts isCurrentEffectiveOwner as its own prop, distinct from isOwner (account role)',
    /isCurrentEffectiveOwner: boolean/.test(detailSrc))
  check('The OverviewTab call site passes isCurrentEffectiveOwner (not just isOwner)',
    /<OverviewTab[^>]*isCurrentEffectiveOwner=\{isCurrentEffectiveOwner\}/.test(detailSrc))
  check('SaleAvailabilityPanel is now gated on BOTH !isOwner AND isCurrentEffectiveOwner',
    /\{!isOwner && isCurrentEffectiveOwner && <SaleAvailabilityPanel/.test(detailSrc))
  check('SaleAvailabilityPanel is no longer gated on !isOwner alone (the actual bug)',
    !/\{!isOwner && <SaleAvailabilityPanel/.test(detailSrc))

  // ── Staging QA finding (Black boy) — round 2: isCurrentEffectiveOwner
  // alone is not enough. It's computed once from the `dog` state THIS
  // page loaded with — if the buyer claims the dog (currentOwnerId
  // reassigned server-side) WHILE the former breeder's tab stays open,
  // that gate stays wrongly true until something refreshes `dog`. Fix
  // has two parts, both checked structurally here (simple substring/
  // regex checks against the full file source — deliberately NOT
  // brace-boundary function extraction, avoiding the exact class of
  // line-ending-fragile pattern a previous round already had to fix
  // elsewhere): (1) any failed save reverts the form/badge to the dog's
  // last known values, via a single shared formFromDog() helper used for
  // BOTH the initial mount value and the post-failure revert; (2) a
  // permission-denied failure specifically triggers a fresh re-fetch of
  // the dog, so isCurrentEffectiveOwner recomputes correctly (in the
  // PARENT) and the panel unmounts on the very next render instead of
  // staying stuck showing a form that will keep failing forever. ──
  check('formFromDog() is extracted as a single shared helper (init and revert can never drift apart)',
    /function formFromDog\(d: Dog\)/.test(detailSrc))
  check('SaleAvailabilityPanel initializes its form via formFromDog(dog)',
    /const initial = formFromDog\(dog\)/.test(detailSrc))
  check('The status badge derives from form.availabilityStatus — the exact state that gets reverted on failure',
    /const status = form\.availabilityStatus/.test(detailSrc))
  check('handleSave\'s catch block reverts the form (and therefore the badge) via formFromDog(dog) on ANY failure — never leaves a rejected/unsaved edit displayed',
    /setForm\(formFromDog\(dog\)\)/.test(detailSrc))
  check('onUpdateSale imports normalizeSaleAvailabilityErrorCode to detect a permission-denied failure specifically',
    /import \{ describeSaleAvailabilitySaveFailure, normalizeSaleAvailabilityErrorCode \} from '\.\.\/lib\/saleAvailabilityError'/.test(detailSrc))
  check('onUpdateSale re-fetches the dog fresh via getDog(dogId!) on a permission-denied failure (stale-ownership recovery)',
    /normalizeSaleAvailabilityErrorCode\(err\) === 'permission-denied'/.test(detailSrc) && /const fresh = await getDog\(dogId!\)/.test(detailSrc) && /if \(fresh\) setDog\(fresh\)/.test(detailSrc))
  check('onUpdateSale re-throws the original error after attempting recovery — SaleAvailabilityPanel\'s own catch (toast + form revert) still runs unconditionally',
    /if \(fresh\) setDog\(fresh\)[\s\S]{0,500}throw err/.test(detailSrc))
}

// =========================================================================
// SECTION 10 (staging QA finding, Black boy) — REQUIRED UX: "failed save
// rolls back both the selector and displayed badge". A REAL mounted-
// component test (react-test-renderer + act()) proving the revert
// actually happens at runtime, not just that the source contains the
// right lines (Section 9 above already proves that separately).
//
// SaleAvailabilityPanel itself is not exported (a local function inside
// DogDetailPage.tsx, which pulls in Firebase/router/a large surrounding
// page — not something a plain Node script can mount directly), so this
// harness faithfully MIRRORS its exact revert shape — a single
// form-from-dog mapping function used for both the initial value and the
// post-failure revert, with the badge deriving from that same form state
// — the same "wrap the real pattern in a harness when the component
// itself isn't importable" approach already used elsewhere in this
// codebase's own test suite (e.g. useShowcaseRequestGuard's real hook
// wrapped in a harness component for scripts/test-litter-showcase.mjs).
// The REAL file's use of this exact shape (formFromDog, badge reading
// form.availabilityStatus, setForm(formFromDog(dog)) in the catch block)
// is what Section 9's structural checks above independently verify.
// =========================================================================
{
  const React = (await import('react')).default
  const { useState } = React
  const TestRenderer = (await import('react-test-renderer')).default
  const { act } = TestRenderer

  function formFromDogMirror(d) { return { availabilityStatus: d.availabilityStatus || '' } }

  function SaleAvailabilityHarness({ dog, controls }) {
    const [form, setForm] = useState(formFromDogMirror(dog))
    controls.setLocalAvailability = (value) => setForm(prev => ({ ...prev, availabilityStatus: value }))
    // Mirrors handleSave()'s exact try/catch shape: on success, the just-
    // set local value IS now correct (already persisted) and is left as-
    // is; on ANY failure, revert via formFromDog(dog) — never leave the
    // rejected attempt displayed.
    controls.save = async (mutationPromise, dogAtSaveTime) => {
      try {
        await mutationPromise
      } catch {
        setForm(formFromDogMirror(dogAtSaveTime))
      }
    }
    controls.getBadgeStatus = () => form.availabilityStatus // mirrors `const status = form.availabilityStatus`
    return null
  }

  // ── Save success: the locally-set value is correctly kept (it's now
  // the true persisted value) ──
  {
    const controls = {}
    let renderer
    act(() => { renderer = TestRenderer.create(React.createElement(SaleAvailabilityHarness, { dog: { availabilityStatus: 'unavailable' }, controls })) })
    act(() => { controls.setLocalAvailability('available') })
    check('10-SUCCESS', 'Badge shows the user\'s locally-set value while a save is pending', controls.getBadgeStatus() === 'available')
    await act(async () => { await controls.save(Promise.resolve()) })
    check('10-SUCCESS', 'After a SUCCESSFUL save, the badge/selector keeps the new value', controls.getBadgeStatus() === 'available')
    act(() => { renderer.unmount() })
  }

  // ── Save failure (the exact staging bug, Black boy): the badge/
  // selector must revert to the dog's last known value, never keep
  // showing the rejected "Available" attempt. ──
  {
    const controls = {}
    let renderer
    const dogAtLoad = { availabilityStatus: 'unavailable' }
    act(() => { renderer = TestRenderer.create(React.createElement(SaleAvailabilityHarness, { dog: dogAtLoad, controls })) })
    check('10-FAILURE', 'Sanity: badge starts at the dog\'s actual persisted value (unavailable)', controls.getBadgeStatus() === 'unavailable')

    act(() => { controls.setLocalAvailability('available') })
    check('10-FAILURE', 'Badge shows "available" while the (about to fail) save is pending — exactly what staging QA observed', controls.getBadgeStatus() === 'available')

    const permissionDeniedErr = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    await act(async () => { await controls.save(Promise.reject(permissionDeniedErr), dogAtLoad) })
    check('10-FAILURE', 'REQUIRED UX: after the FAILED save, the badge reverts to the last server-confirmed value ("unavailable") — never left showing the rejected "available" attempt', controls.getBadgeStatus() === 'unavailable')

    act(() => { renderer.unmount() })
  }

  // ── A non-permission failure (e.g. a transient network error) must
  // revert exactly the same way — "for ANY reason", not just
  // permission-denied. ──
  {
    const controls = {}
    let renderer
    const dogAtLoad = { availabilityStatus: 'reserved' }
    act(() => { renderer = TestRenderer.create(React.createElement(SaleAvailabilityHarness, { dog: dogAtLoad, controls })) })
    act(() => { controls.setLocalAvailability('sold') })
    const networkErr = Object.assign(new Error('The service is currently unavailable.'), { code: 'unavailable' })
    await act(async () => { await controls.save(Promise.reject(networkErr), dogAtLoad) })
    check('10-FAILURE', 'A non-permission failure (network/unavailable) also reverts the badge — "for ANY reason", not just permission-denied', controls.getBadgeStatus() === 'reserved')
    act(() => { renderer.unmount() })
  }

  // ── Restricted-puppy Save button: harness-level proof that a disabled
  // Save control, when invoked anyway (mirroring "the handler is called
  // programmatically, bypassing the UI's disabled attribute"), never
  // reaches the write function at all. Mirrors the exact guard shape
  // Section 11 below proves exists in the real handleSave(): check
  // isRestricted FIRST, before anything resembling a write attempt. ──
  {
    const controls = {}
    let renderer
    const mutationCalls = []
    function RestrictedSaveHarness({ isRestricted, controls }) {
      controls.save = async () => {
        if (isRestricted) { controls.lastMessage = 'PLAN_LIMIT_MESSAGE'; return }
        mutationCalls.push(1)
        controls.lastMessage = 'SAVED'
      }
      return null
    }
    act(() => { renderer = TestRenderer.create(React.createElement(RestrictedSaveHarness, { isRestricted: true, controls })) })
    await act(async () => { await controls.save() })
    check('10-RESTRICTED', 'Invoking save() on a restricted puppy never reaches the write function (mutationCalls stays empty)', mutationCalls.length === 0)
    check('10-RESTRICTED', 'Invoking save() on a restricted puppy surfaces the plan-limit message, not a save-succeeded/permission-denied one', controls.lastMessage === 'PLAN_LIMIT_MESSAGE')
    act(() => { renderer.unmount() })
  }
}

// =========================================================================
// SECTION 11 (staging QA finding, Red Boy follow-up) — the SAME class of
// bug Sections 9/10 already fixed once (Black boy: gate on
// isCurrentEffectiveOwner) had a second gap: NEITHER Section 9's fix NOR
// the original code ever checked 'restricted' status. A puppy over its
// plan's dog cap keeps currentOwnerId pointing at the same breeder
// (isCurrentEffectiveOwner stays true), so SaleAvailabilityPanel kept
// rendering fully editable, Save stayed clickable, and every attempt was
// denied by firestore.rules' restricted-dog clause — surfacing the exact
// same "you don't have permission to update this dog anymore" message
// Section 9 was supposed to have eliminated. Root cause: correct Rules
// behavior, avoidable UI dead end — same shape as before, just a
// different missed condition. No Rules change here either.
//
// Also found and fixed in the same commit (Codex audit requirement):
// two OTHER independently-editable dogs/{dogId} write paths in the same
// Overview tab with the identical gap — the Breeder ID editor and the
// Pedigree Register selector. Both covered below too.
// =========================================================================
{
  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

  // Same balanced-brace extractor already established (and CRLF-proven)
  // for scripts/test-puppy-edit-authorization.mjs's handleSavePuppy
  // check — ported here rather than imported, matching this codebase's
  // existing convention of self-contained test files with no cross-file
  // imports between test-*.mjs scripts.
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
  // Proves the causal chain, not just text order: the isRestricted check
  // exists, opens a block, that block contains a real return, and the
  // return sits before the actual write attempt (`await onSave(` for
  // Sale & Availability, `await onUpdateBreederId(` for Breeder ID).
  function hasShortCircuitingRestrictedGuard(fnBody, writeCallNeedle) {
    const conditionIdx = fnBody.indexOf('if (isRestricted)')
    if (conditionIdx === -1) return { ok: false, reason: 'isRestricted guard condition not found' }
    const guardOpenIdx = fnBody.indexOf('{', conditionIdx)
    if (guardOpenIdx === -1) return { ok: false, reason: 'no block opens after the condition' }
    const guardBlockEnd = findMatchingBraceEnd(fnBody, guardOpenIdx)
    const guardBlock = fnBody.slice(guardOpenIdx, guardBlockEnd)
    const returnMatch = /\breturn\b/.exec(guardBlock)
    if (!returnMatch) return { ok: false, reason: 'no return statement inside the guard block' }
    const returnIdx = guardOpenIdx + returnMatch.index
    const writeCallIdx = fnBody.indexOf(writeCallNeedle)
    if (writeCallIdx === -1) return { ok: false, reason: `write call (${writeCallNeedle}) not found` }
    if (!(conditionIdx < returnIdx)) return { ok: false, reason: 'return is not after the restricted condition' }
    if (!(returnIdx < writeCallIdx)) return { ok: false, reason: 'return is not before the write call' }
    return { ok: true, reason: '', returnIdx }
  }
  // Runs the positive case, the negative self-test (delete the matched
  // `return` from an in-memory copy, confirm the predicate correctly
  // flips to failure), and the same pair again against an in-memory
  // CRLF-converted copy of the whole file — the exact rigor already
  // established and required for the equivalent LittersPage.tsx checks.
  function proveGuardIsMutationAndCrlfProof(label, signaturePattern, writeCallNeedle) {
    const fnBody = extractFunctionSource(detailSrc, signaturePattern)
    check(`${label}: function body found by the balanced-brace extractor`, fnBody.length > 0)
    const real = hasShortCircuitingRestrictedGuard(fnBody, writeCallNeedle)
    check(`${label}: short-circuits BEFORE attempting the write when the dog is restricted (guard exists, contains a real return, ordered before the write call)`, real.ok, real.reason)
    if (real.ok) {
      const mutated = fnBody.slice(0, real.returnIdx) + fnBody.slice(real.returnIdx + 'return'.length)
      const mutatedResult = hasShortCircuitingRestrictedGuard(mutated, writeCallNeedle)
      check(`NEGATIVE SELF-TEST (${label}): deleting the guard's return from an in-memory copy correctly flips the predicate to failure`, mutatedResult.ok === false)
    } else {
      check(`NEGATIVE SELF-TEST (${label}): skipped — positive case did not pass`, false, '(investigate the check above first)')
    }
    const crlfSrc = detailSrc.replace(/\r\n|\n/g, '\r\n')
    const crlfBody = extractFunctionSource(crlfSrc, signaturePattern)
    const crlfReal = hasShortCircuitingRestrictedGuard(crlfBody, writeCallNeedle)
    check(`CRLF (${label}): short-circuit still correctly detected against an all-CRLF copy of DogDetailPage.tsx`, crlfReal.ok, crlfReal.reason)
    if (crlfReal.ok) {
      const crlfMutated = crlfBody.slice(0, crlfReal.returnIdx) + crlfBody.slice(crlfReal.returnIdx + 'return'.length)
      const crlfMutatedResult = hasShortCircuitingRestrictedGuard(crlfMutated, writeCallNeedle)
      check(`CRLF NEGATIVE SELF-TEST (${label}): mutated return still correctly fails against an all-CRLF copy`, crlfMutatedResult.ok === false)
    }
  }

  // ── Sale & availability ──
  check('OverviewTab computes isRestricted from dog.status (the same field DogDetailPage\'s own top-level restricted banner already uses)',
    /const isRestricted = \(dog as any\)\.status === 'restricted'/.test(detailSrc))
  check('SaleAvailabilityPanel declares isRestricted as its own required prop',
    /function SaleAvailabilityPanel\(\{ dog, onSave, toast, isRestricted \}: \{[\s\S]{0,200}isRestricted: boolean/.test(detailSrc))
  check('The render call site passes isRestricted into SaleAvailabilityPanel',
    /<SaleAvailabilityPanel dog=\{dog\} onSave=\{onUpdateSale\} toast=\{toast\} isRestricted=\{isRestricted\} \/>/.test(detailSrc))
  check('The Availability dropdown and reservation/deposit fields are wrapped in a fieldset disabled for a restricted dog',
    /<fieldset disabled=\{isRestricted\}/.test(detailSrc))
  check('The Sale & availability Save button is also disabled for a restricted dog (defense in depth alongside the fieldset)',
    /disabled=\{!hasChanges \|\| saving \|\| isRestricted\}/.test(detailSrc))
  proveGuardIsMutationAndCrlfProof('Sale & availability handleSave', /async function handleSave\(\)/, 'await onSave(')
  check('Sale & availability\'s restricted-guard message is a distinct plan-limit explanation, never the permission-denied/generic save-failure copy',
    /This dog is over your plan's limit and is read-only[\s\S]{0,120}edit Sale & availability/.test(detailSrc))

  // ── Breeder ID (found during the required audit of the whole editor) ──
  check('The Breeder ID ✎ trigger button is disabled for a restricted dog',
    /<button onClick=\{\(\) => setEditingBreederId\(true\)\} disabled=\{isRestricted\} className="btn btn-ghost btn-sm" style=\{\{ padding: '2px 6px'/.test(detailSrc))
  check('The Breeder ID "+ Add" trigger button is disabled for a restricted dog',
    /<button onClick=\{\(\) => setEditingBreederId\(true\)\} disabled=\{isRestricted\} className="btn btn-ghost btn-sm" style=\{\{ padding: '2px 8px'/.test(detailSrc))
  check('The Breeder ID Save button is disabled for a restricted dog',
    /disabled=\{savingBreederId \|\| isRestricted\}/.test(detailSrc))
  proveGuardIsMutationAndCrlfProof('Breeder ID handleSaveBreederId', /async function handleSaveBreederId\(\)/, 'await onUpdateBreederId(')

  // ── Pedigree Register (also found during the audit — auto-saves on
  // change with no separate Save button, so `disabled` on the select
  // itself IS the primary defense, backed by an inline guard) ──
  check('The Pedigree Register select is disabled for a restricted dog',
    /value=\{\(dog as any\)\.pedigreeRegister \|\| 'main'\}\s*\r?\n\s*disabled=\{isRestricted\}/.test(detailSrc))
  check('The Pedigree Register onChange handler also guards on isRestricted before writing (defense in depth, not just the disabled attribute)',
    /onChange=\{async e => \{[\s\S]{0,400}if \(isRestricted\) return[\s\S]{0,80}await updateDog\(dog\.id, \{ pedigreeRegister/.test(detailSrc))
}

if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  const { initializeApp } = await import('firebase/app')
  const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } = await import('firebase/auth')
  const { getFirestore, connectFirestoreEmulator, doc, updateDoc } = await import('firebase/firestore')
  const { initializeApp: initAdminApp } = await import('firebase-admin/app')
  const { getFirestore: getAdminFirestore } = await import('firebase-admin/firestore')

  const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'sale-availability-client')
  const clientAuth = getAuth(app)
  const clientDb = getFirestore(app)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080)

  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
  const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' }, 'sale-availability-admin')
  const adminDb = getAdminFirestore(adminApp)

  function isDenied(err) { return err && (err.code === 'permission-denied' || /permission/i.test(err.message)) }

  const PW = 'tam12345*'
  const R = Date.now()
  const email = n => `saleavail.${n}.${R}@emulator.local`
  async function newUser(name) {
    const { user } = await createUserWithEmailAndPassword(clientAuth, email(name), PW)
    await signOut(clientAuth)
    return user.uid
  }
  async function as(name) {
    await signOut(clientAuth).catch(() => {})
    await signInWithEmailAndPassword(clientAuth, email(name), PW)
  }

  const currentOwnerUid = await newUser('currentowner')
  const strangerUid = await newUser('stranger')

  // ── Test 9a (ALLOWED): the legitimate current owner CAN save Sale &
  // Availability fields on a normal, active, untransferred dog they own.
  // Proves the root cause really was UI-only — firestore.rules never
  // blocked this legitimate case. ──
  {
    const dogId = `dog9a_${R}`
    await adminDb.collection('dogs').doc(dogId).set({
      tenantId: currentOwnerUid, currentOwnerId: currentOwnerUid, createdByUserId: currentOwnerUid,
      sourceType: 'BREEDER_ISSUED', name: 'AllowedPup', sex: 'female', status: 'active', dateOfBirth: '2026-01-01',
    })
    await as('currentowner')
    let allowedErr = null
    try {
      await updateDoc(doc(clientDb, 'dogs', dogId), {
        availabilityStatus: 'reserved', reservedForName: 'Jane Buyer', reservedForEmail: 'jane@example.com', depositStatus: 'pending',
      })
    } catch (err) { allowedErr = err }
    check('9a-ALLOWED', 'The legitimate current owner can update Sale & Availability fields on their own dog', allowedErr === null, allowedErr?.message)
    const after = (await adminDb.collection('dogs').doc(dogId).get()).data()
    check('9a-ALLOWED', 'The write actually persisted (availabilityStatus)', after.availabilityStatus === 'reserved')
    check('9a-ALLOWED', 'The write actually persisted (reservedForName)', after.reservedForName === 'Jane Buyer')
  }

  // ── Test 9b (DENIED — the exact bug scenario): a FORMER owner, after a
  // genuine transfer+claim (currentOwnerId reassigned, full history fields
  // set — the exact shape a real claim leaves), is denied. This is the
  // scenario the misleading error message was actually, correctly,
  // guarding — the UI fix stops presenting the form, but the underlying
  // Rules denial must still hold regardless. ──
  {
    const dogId = `dog9b_${R}`
    const buyerUid = await newUser('buyer9b')
    await adminDb.collection('dogs').doc(dogId).set({
      tenantId: currentOwnerUid, currentOwnerId: buyerUid, createdByUserId: currentOwnerUid,
      sourceType: 'BREEDER_ISSUED', name: 'TransferredPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
      buyerEmail: email('buyer9b'), buyerName: 'Buyer Nine B', previousOwnerId: currentOwnerUid,
      transferredAt: new Date().toISOString(), claimedAt: new Date().toISOString(), claimedBy: buyerUid,
    })
    await as('currentowner') // the FORMER owner — currentOwnerId no longer matches them
    let deniedErr = null
    try {
      await updateDoc(doc(clientDb, 'dogs', dogId), { availabilityStatus: 'sold' })
    } catch (err) { deniedErr = err }
    check('9b-DENIED', 'A former owner (post-transfer/claim) is denied updating Sale & Availability fields', isDenied(deniedErr))
    const after = (await adminDb.collection('dogs').doc(dogId).get()).data()
    check('9b-DENIED', 'The denied write left no trace — availabilityStatus was never set', after.availabilityStatus === undefined)
  }

  // ── Test 9c (DENIED): a completely unrelated stranger, never involved
  // with the dog at all, is denied. ──
  {
    const dogId = `dog9c_${R}`
    await adminDb.collection('dogs').doc(dogId).set({
      tenantId: currentOwnerUid, currentOwnerId: currentOwnerUid, createdByUserId: currentOwnerUid,
      sourceType: 'BREEDER_ISSUED', name: 'StrangerTargetPup', sex: 'female', status: 'active', dateOfBirth: '2026-01-01',
    })
    await as('stranger')
    let deniedErr = null
    try {
      await updateDoc(doc(clientDb, 'dogs', dogId), { availabilityStatus: 'available' })
    } catch (err) { deniedErr = err }
    check('9c-DENIED', 'An unrelated stranger (never owned this dog) is denied', isDenied(deniedErr))
  }

  // ── Test 9d (existing protection PRESERVED, not weakened): even the
  // legitimate current owner cannot smuggle a protected ownership field
  // through a Sale & Availability-shaped write. ──
  {
    const dogId = `dog9d_${R}`
    await adminDb.collection('dogs').doc(dogId).set({
      tenantId: currentOwnerUid, currentOwnerId: currentOwnerUid, createdByUserId: currentOwnerUid,
      sourceType: 'BREEDER_ISSUED', name: 'ProtectedFieldsPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
    })
    await as('currentowner')
    let deniedErr = null
    try {
      await updateDoc(doc(clientDb, 'dogs', dogId), { availabilityStatus: 'sold', currentOwnerId: strangerUid })
    } catch (err) { deniedErr = err }
    check('9d-PRESERVED', 'The current owner cannot bundle a currentOwnerId change into a Sale & Availability write', isDenied(deniedErr))
    const after = (await adminDb.collection('dogs').doc(dogId).get()).data()
    check('9d-PRESERVED', 'currentOwnerId is unchanged after the denied attempt', after.currentOwnerId === currentOwnerUid)
  }

  // ── Test 9e (existing protection PRESERVED, not weakened): a
  // 'restricted' dog (over the plan's cap) remains read-only for Sale &
  // Availability too, even for its legitimate current owner — this fix
  // must not broaden that already-deliberate business rule. ──
  {
    const dogId = `dog9e_${R}`
    await adminDb.collection('dogs').doc(dogId).set({
      tenantId: currentOwnerUid, currentOwnerId: currentOwnerUid, createdByUserId: currentOwnerUid,
      sourceType: 'BREEDER_ISSUED', name: 'RestrictedPup', sex: 'female', status: 'restricted', dateOfBirth: '2026-01-01',
    })
    await as('currentowner')
    let deniedErr = null
    try {
      await updateDoc(doc(clientDb, 'dogs', dogId), { availabilityStatus: 'available' })
    } catch (err) { deniedErr = err }
    check('9e-PRESERVED', 'A restricted dog stays read-only for Sale & Availability, even for its own current owner (unrelated existing rule, confirmed unweakened)', isDenied(deniedErr))
  }

  await signOut(clientAuth).catch(() => {})
} else {
  skip('Section 9 emulator matrix (Sale & Availability allowed/denied permission cases)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
}

await summary()
