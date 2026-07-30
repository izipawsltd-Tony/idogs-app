// scripts/test-puppy-edit-authorization.mjs — regression coverage for
// staging QA Bug 2 ("Red Boy puppy editing").
//
// Root cause recap: NOT a Firestore Rules defect, and NOT weakened here.
// A litter puppy is created by api/create-litter-puppy.js, which — per
// iDogs Pricing v1.1 §3.2/§3.3 (LOCKED) — silently lands a puppy created
// while the breeder is at/over their plan's dog cap as `status:
// 'restricted'` (read-only, same rule DogDetailPage already enforces and
// explains for every other dog type). The OLD success response never
// told the client this happened, and the OLD create/edit UI gave zero
// signal either — a breeder saw an unconditional "added — QR Passport
// created!" toast, then hit a bare, unexplained "Failed to update puppy"
// the first time they tried an ordinary edit (e.g. coat colour). Verified
// empirically against a fresh emulator before this fix: an ordinary
// ACTIVE puppy, edited by its own creator, with the exact document shape
// api/create-litter-puppy.js writes, was already ALLOWED by
// firestore.rules — the Rules-level ownership/ordinary-field-edit path
// was never broken. Section 2 below proves that baseline explicitly.
//
// The fix (three files, no Rules change):
//   - api/create-litter-puppy.js now returns the created/existing
//     puppy's actual `status` in its response.
//   - src/lib/db.ts's createLitterPuppyAtomic() surfaces that field.
//   - src/pages/LittersPage.tsx: (a) handleAddPuppy shows a distinct,
//     honest toast when the new puppy landed restricted; (b) a puppy
//     row shows a 🔒 Restricted badge, mirroring DogDetailPage's
//     existing convention; (c) handleSavePuppy short-circuits with clear
//     guidance for a restricted puppy instead of round-tripping into a
//     Rules denial; (d) the edit form itself goes read-only (disabled
//     fieldset + Save button) for a restricted puppy.
//
// Usage: node scripts/test-puppy-edit-authorization.mjs
//   Section 1 (structural, no emulator needed) always runs.
//   Section 2 (Rules-level emulator matrix) needs
//   FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST set and the
//   local Firebase emulator running.

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, skip, summary } = makeChecker()

const apiSrc = readFileSync(new URL('../api/create-litter-puppy.js', import.meta.url), 'utf8')
const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
const toastHookSrc = readFileSync(new URL('../src/hooks/useToast.ts', import.meta.url), 'utf8')
const appSrc = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8')

// Codex re-review fix: extracts one function's full source (signature
// through its matching closing brace) via balanced-brace scanning —
// ported from the exact, already-proven helper in
// test-litter-showcase.mjs (see that file's own extractFunctionSource
// for the full rationale/self-test). Needed here because this repo's
// git config has core.autocrlf=true, so `git archive`/a fresh checkout
// can produce CRLF line endings even though the working tree that wrote
// this file used LF — a regex asserting relative ORDER between two
// substrings must never depend on a literal `\n` matching a specific
// byte. `\s` (not literal `\n`) already matches `\r` too, so this
// extraction is inherently line-ending-agnostic with no special-casing.
//
// findMatchingBraceEnd() is the shared core (string/comment-aware depth
// counter): given the index of an ALREADY-LOCATED opening `{`, returns
// the index just past its matching `}`. extractFunctionSource() uses it
// to grab a whole function body from a signature pattern;
// extractBracedBlock() uses the exact same core to isolate an arbitrary
// SMALLER block (e.g. just an `if (...) { ... }`) once its opening brace
// is already known — both stay perfectly in sync with each other because
// there is only one balanced-brace implementation, not two.
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

function extractBracedBlock(src, openBraceIdx) {
  return src.slice(openBraceIdx, findMatchingBraceEnd(src, openBraceIdx))
}

// Codex re-review fix #2: an earlier version of this check only proved
// "the guard condition text appears before the write-call text" —
// `restrictedGuardIdx < writeCallIdx` — which would keep passing even if
// someone accidentally DELETED the `return` inside the guard (execution
// would then fall through into the write regardless of the condition
// still being present in the source). This predicate instead proves the
// whole causal chain a real short-circuit needs: the guard condition
// exists; it opens a block; that block contains an actual `return`
// statement (not just the word "return" anywhere in the function —
// isolated to the guard's own balanced-brace block first); and that
// return sits BEFORE the write call. Returns a small result object
// (never throws) so both the real source and a deliberately-mutated
// copy can be run through the exact same logic — see the negative
// self-test below, which is what actually PROVES this predicate can
// detect the regression it claims to prevent, not just that it happens
// to return true once.
function hasShortCircuitingRestrictedGuard(fnBody) {
  const conditionIdx = fnBody.indexOf("status === 'restricted'")
  if (conditionIdx === -1) return { ok: false, reason: 'restricted-status condition not found' }

  const guardOpenIdx = fnBody.indexOf('{', conditionIdx)
  if (guardOpenIdx === -1) return { ok: false, reason: 'no block opens after the condition' }
  const guardBlock = extractBracedBlock(fnBody, guardOpenIdx)
  if (!guardBlock) return { ok: false, reason: 'guard block did not close (unbalanced braces)' }

  const returnMatch = /\breturn\b/.exec(guardBlock)
  if (!returnMatch) return { ok: false, reason: 'no return statement inside the guard block' }
  const returnIdx = guardOpenIdx + returnMatch.index

  const writeCallIdx = fnBody.indexOf('await updateDog(')
  if (writeCallIdx === -1) return { ok: false, reason: 'write call (await updateDog() not found' }

  if (!(conditionIdx < returnIdx)) return { ok: false, reason: 'return is not after the restricted condition' }
  if (!(returnIdx < writeCallIdx)) return { ok: false, reason: 'return is not before the write call' }

  return { ok: true, reason: '', conditionIdx, returnIdx, writeCallIdx }
}

// =========================================================================
// SECTION 1 — structural: the actual fix is really in the shipped files
// =========================================================================
{
  check('api/create-litter-puppy.js: the retry ("alreadyExisted") branch returns the existing dog\'s real status',
    /return \{ ok: true, alreadyExisted: true,[^}]*status: dog\.status \}/.test(apiSrc))

  check('api/create-litter-puppy.js: the fresh-creation branch returns the puppyStatus it just computed',
    /return \{ ok: true, alreadyExisted: false,[^}]*status: puppyStatus \}/.test(apiSrc))

  check('api/create-litter-puppy.js: the final JSON response includes status (not silently dropped after the tx)',
    /res\.status\(200\)\.json\(\{[^}]*alreadyExisted: result\.alreadyExisted, status: result\.status/.test(apiSrc))

  check('db.ts: createLitterPuppyAtomic()\'s return type includes an optional status',
    /Promise<\{ dogId: string; passportId: string; alreadyExisted: boolean; status\?: string \}>/.test(dbSrc))

  check('db.ts: createLitterPuppyAtomic() actually forwards status from the API response, not just alreadyExisted',
    /return \{ dogId: result\.dogId, passportId: result\.passportId, alreadyExisted: result\.alreadyExisted, status: result\.status \}/.test(dbSrc))

  check('LittersPage.tsx: handleAddPuppy reads status back from createLitterPuppyAtomic',
    /const \{ alreadyExisted, status: createdStatus \} = await createLitterPuppyAtomic/.test(littersSrc))

  check('LittersPage.tsx: a puppy that lands restricted gets a DISTINCT, honest toast — not the unconditional success message',
    /createdStatus === 'restricted'[\s\S]{0,300}you're over your plan's dog limit/.test(littersSrc))

  check('LittersPage.tsx: each puppy row computes isPuppyRestricted from its own status field',
    /const isPuppyRestricted = \(puppy as any\)\.status === 'restricted'/.test(littersSrc))

  check('LittersPage.tsx: a restricted puppy shows a 🔒 Restricted badge in its row (mirrors DogDetailPage\'s existing convention)',
    /isPuppyRestricted && \([\s\S]{0,400}🔒 Restricted/.test(littersSrc))

  // Codex re-review fix #1 (CRLF): the original version of this check
  // was a single large-distance regex containing a literal
  // `return\n\s*\}\n\s*try \{` — that `\n` requires the byte immediately
  // after "return" to be LF. This repo's git config has
  // core.autocrlf=true, so a fresh checkout or `git archive` export of
  // the exact same committed content can legitimately be CRLF, making
  // that literal `\n` fail to match even though the logic itself is
  // correct — the same class of bug this codebase already hit and fixed
  // once for test-litter-showcase.mjs.
  //
  // Codex re-review fix #2 (mutation-proof): the FIRST correction only
  // proved `restrictedGuardIdx < writeCallIdx` — the condition TEXT
  // precedes the write-call TEXT — which stays true even if the actual
  // `return` inside the guard were deleted (the guard would still
  // "exist" earlier in the source; it just wouldn't short-circuit
  // anything anymore). hasShortCircuitingRestrictedGuard() (above)
  // proves the real causal chain instead: the condition exists, opens a
  // block, that block contains a genuine return statement, and the
  // return sits between the condition and the write call. The negative
  // self-test right after this proves the predicate actually CAN catch
  // that regression, not merely that it happens to return true once.
  const handleSavePuppyBody = extractFunctionSource(littersSrc, /async function handleSavePuppy\(/)
  check('LittersPage.tsx: handleSavePuppy() was found by the balanced-brace extractor (extraction sanity check)',
    handleSavePuppyBody.length > 0)

  const realResult = hasShortCircuitingRestrictedGuard(handleSavePuppyBody)
  check('LittersPage.tsx: handleSavePuppy short-circuits BEFORE attempting the write when the puppy is restricted (guard condition exists, opens a block containing a real return statement, ordered before the write call)',
    realResult.ok, realResult.reason)

  // NEGATIVE SELF-TEST (mutation check): delete just the matched `return`
  // keyword from an IN-MEMORY copy of the real extracted function body
  // and re-run the exact same predicate. If the predicate is doing real
  // work, removing the one thing it's supposed to require must flip its
  // verdict from true to false — proving this test would actually catch
  // someone accidentally deleting the guard's return, not just that it
  // passes today.
  if (realResult.ok) {
    const mutatedBody = handleSavePuppyBody.slice(0, realResult.returnIdx) + handleSavePuppyBody.slice(realResult.returnIdx + 'return'.length)
    const mutatedResult = hasShortCircuitingRestrictedGuard(mutatedBody)
    check('NEGATIVE SELF-TEST: deleting the guard\'s return statement from an in-memory copy makes hasShortCircuitingRestrictedGuard() correctly report failure — proves this test can detect the exact regression it claims to prevent',
      mutatedResult.ok === false, `mutated predicate unexpectedly returned ok=${mutatedResult.ok}`)
  } else {
    check('NEGATIVE SELF-TEST: skipped because the positive case above did not pass — cannot meaningfully mutate a guard that was never found', false,
      '(this should never happen unless the check above already failed; investigate that first)')
  }

  // Codex re-review fix #2, item 4: prove the SAME predicate — the real
  // one used above, not a re-implementation — reaches the identical
  // positive AND negative verdicts on an in-memory CRLF-converted copy
  // of the whole file, not just on whatever line ending this checkout
  // happens to have right now. This is what actually verifies the CRLF
  // immunity claimed above, rather than just asserting it in a comment.
  {
    const crlfLittersSrc = littersSrc.replace(/\r\n|\n/g, '\r\n')
    check('CRLF sanity: the in-memory conversion actually produced CRLF (self-check on the fixture itself)',
      /\r\n/.test(crlfLittersSrc) && !/[^\r]\n/.test(crlfLittersSrc))
    const crlfBody = extractFunctionSource(crlfLittersSrc, /async function handleSavePuppy\(/)
    const crlfRealResult = hasShortCircuitingRestrictedGuard(crlfBody)
    check('CRLF: handleSavePuppy short-circuit is still correctly detected against an all-CRLF copy of LittersPage.tsx',
      crlfRealResult.ok, crlfRealResult.reason)
    if (crlfRealResult.ok) {
      const crlfMutatedBody = crlfBody.slice(0, crlfRealResult.returnIdx) + crlfBody.slice(crlfRealResult.returnIdx + 'return'.length)
      const crlfMutatedResult = hasShortCircuitingRestrictedGuard(crlfMutatedBody)
      check('CRLF: the negative self-test (mutated return) still correctly fails against an all-CRLF copy',
        crlfMutatedResult.ok === false, `mutated predicate unexpectedly returned ok=${crlfMutatedResult.ok}`)
    }
  }

  check('LittersPage.tsx: the restricted-puppy short-circuit message is clear and actionable, not the old bare "Failed to update puppy"',
    /over your plan's dog limit and is read-only — upgrade or free up a slot to edit it/.test(littersSrc))

  check('LittersPage.tsx: the edit form disables its fields (fieldset disabled) for a restricted puppy',
    /<fieldset disabled=\{isPuppyRestricted\}/.test(littersSrc))

  check('LittersPage.tsx: the Save changes button is also disabled for a restricted puppy (defense in depth alongside the fieldset)',
    /onClick=\{\(\) => handleSavePuppy\(puppy, litter\)\} disabled=\{isPuppyRestricted\}/.test(littersSrc))
}

// =========================================================================
// SECTION 1B — staging QA follow-up (Red Boy, round 4): opening Edit on a
// restricted puppy must not itself attempt any write, and must never show
// a stale toast left over from an earlier, unrelated action. Staging QA
// observed a "permission-denied"-style message on opening Edit with no
// Console/Network error at all — consistent with a leftover toast (see
// useToast.ts's 3.5s auto-dismiss timer) still being visible at that
// moment, not a genuine request made by opening the editor.
// =========================================================================
{
  check('useToast.ts exports dismissAll(), which clears every toast at once (not dismiss-by-id)',
    /const dismissAll = useCallback\(\(\) => \{[\s\S]{0,40}setToasts\(\[\]\)/.test(toastHookSrc))
  check('useToast.ts returns dismissAll alongside toasts/toast/dismiss',
    /return \{ toasts, toast, dismiss, dismissAll \}/.test(toastHookSrc))

  check('App.tsx destructures dismissAll from useToast()',
    /const \{ toasts, toast, dismiss, dismissAll \} = useToast\(\)/.test(appSrc))
  check('App.tsx wires dismissAll through to LittersPage',
    /<LittersPage toast=\{toast\} dismissAll=\{dismissAll\} \/>/.test(appSrc))

  check('LittersPage.tsx\'s Props declares dismissAll',
    /dismissAll: \(\) => void/.test(littersSrc))
  check('LittersPage.tsx\'s component destructures dismissAll from its props',
    /export default function LittersPage\(\{ toast, dismissAll \}: Props\)/.test(littersSrc))

  const startEditPuppyBody = extractFunctionSource(littersSrc, /function startEditPuppy\(/)
  check('LittersPage.tsx: startEditPuppy() was found by the balanced-brace extractor (extraction sanity check)',
    startEditPuppyBody.length > 0)

  check('LittersPage.tsx: opening the editor (startEditPuppy) is synchronous and makes no Firestore write of its own — no updateDog( call anywhere in its body',
    !startEditPuppyBody.includes('updateDog(') && !/^\s*async function startEditPuppy\(/m.test(littersSrc))
  check('LittersPage.tsx: opening the editor does not itself display any NEW toast — only dismissAll() (clearing), never toast(',
    !startEditPuppyBody.includes('toast('))

  // Proves dismissAll() is called, AND that it happens BEFORE the editor
  // actually opens (setEditingPuppy(puppy.id)) — not just that both
  // appear somewhere in the function. Mirrors hasShortCircuitingRestrictedGuard's
  // structure/rigor: a real causal-order predicate, not a bare substring
  // check, verified further below with the same negative-mutation +
  // CRLF-immunity proof already established for the Save-guard check.
  function clearsStaleToastsBeforeOpeningEditor(fnBody) {
    const dismissIdx = fnBody.indexOf('dismissAll()')
    if (dismissIdx === -1) return { ok: false, reason: 'dismissAll() is not called' }
    const openIdx = fnBody.indexOf('setEditingPuppy(puppy.id)')
    if (openIdx === -1) return { ok: false, reason: 'setEditingPuppy(puppy.id) not found — editor never actually opens' }
    if (!(dismissIdx < openIdx)) return { ok: false, reason: 'dismissAll() happens AFTER the editor already opened, not before' }
    return { ok: true, reason: '', dismissIdx, openIdx }
  }

  const staleClearResult = clearsStaleToastsBeforeOpeningEditor(startEditPuppyBody)
  check('LittersPage.tsx: startEditPuppy clears any stale toast (dismissAll()) BEFORE the editor opens (setEditingPuppy) — a leftover message from an earlier action can never be mistaken for one this action caused',
    staleClearResult.ok, staleClearResult.reason)

  if (staleClearResult.ok) {
    const mutatedBody = startEditPuppyBody.slice(0, staleClearResult.dismissIdx) + startEditPuppyBody.slice(staleClearResult.dismissIdx + 'dismissAll()'.length)
    const mutatedResult = clearsStaleToastsBeforeOpeningEditor(mutatedBody)
    check('NEGATIVE SELF-TEST: deleting the dismissAll() call from an in-memory copy makes clearsStaleToastsBeforeOpeningEditor() correctly report failure',
      mutatedResult.ok === false, `mutated predicate unexpectedly returned ok=${mutatedResult.ok}`)
  } else {
    check('NEGATIVE SELF-TEST: skipped because the positive case above did not pass — cannot meaningfully mutate a call that was never found', false,
      '(this should never happen unless the check above already failed; investigate that first)')
  }

  {
    const crlfLittersSrc2 = littersSrc.replace(/\r\n|\n/g, '\r\n')
    const crlfStartEditBody = extractFunctionSource(crlfLittersSrc2, /function startEditPuppy\(/)
    const crlfStaleClearResult = clearsStaleToastsBeforeOpeningEditor(crlfStartEditBody)
    check('CRLF: the stale-toast-clears-before-editor-opens check is still correctly detected against an all-CRLF copy of LittersPage.tsx',
      crlfStaleClearResult.ok, crlfStaleClearResult.reason)
    if (crlfStaleClearResult.ok) {
      const crlfMutatedBody2 = crlfStartEditBody.slice(0, crlfStaleClearResult.dismissIdx) + crlfStartEditBody.slice(crlfStaleClearResult.dismissIdx + 'dismissAll()'.length)
      const crlfMutatedResult2 = clearsStaleToastsBeforeOpeningEditor(crlfMutatedBody2)
      check('CRLF: the negative self-test (mutated dismissAll call) still correctly fails against an all-CRLF copy',
        crlfMutatedResult2.ok === false, `mutated predicate unexpectedly returned ok=${crlfMutatedResult2.ok}`)
    }
  }
}

// =========================================================================
// SECTION 2 — Firestore Rules matrix (emulator-gated)
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  const { initializeApp } = await import('firebase/app')
  const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } = await import('firebase/auth')
  const { getFirestore, connectFirestoreEmulator, doc, updateDoc, getDoc } = await import('firebase/firestore')
  const { initializeApp: initAdminApp } = await import('firebase-admin/app')
  const { getFirestore: getAdminFirestore } = await import('firebase-admin/firestore')

  const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'puppy-edit-client')
  const clientAuth = getAuth(app)
  const clientDb = getFirestore(app)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080)

  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
  const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' }, 'puppy-edit-admin')
  const adminDb = getAdminFirestore(adminApp)

  function isDenied(err) { return err && (err.code === 'permission-denied' || /permission/i.test(err.message)) }

  const PW = 'tam12345*'
  const R = Date.now()
  const email = n => `puppyedit.${n}.${R}@emulator.local`
  async function newUser(name) {
    const { user } = await createUserWithEmailAndPassword(clientAuth, email(name), PW)
    await signOut(clientAuth)
    return user.uid
  }
  async function as(name) {
    await signOut(clientAuth).catch(() => {})
    await signInWithEmailAndPassword(clientAuth, email(name), PW)
  }

  const breederUid = await newUser('breeder')
  const strangerUid = await newUser('stranger')

  // The exact document shape api/create-litter-puppy.js writes for a
  // fresh, under-cap ("active") puppy (see its tx.set(dogRef, {...})).
  function puppyFixture(overrides = {}) {
    return {
      tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
      sourceType: 'BREEDER_ISSUED', originBreederId: breederUid,
      name: 'Red Boy', breed: 'Labrador', sex: 'male', dateOfBirth: '2026-06-01',
      colour: 'Red', microchip: '', ankc: '', notes: 'From litter: Test Litter · Collar: Red',
      litterId: `litter_${R}`, lifeStage: 'puppy', isDeceased: false, photos: [],
      status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      ...overrides,
    }
  }

  // ── 2a: the exact required case — an authorized breeder creates a
  // puppy (here, seeded directly with create-litter-puppy.js's real
  // output shape) and can edit coatColour on it. ──
  {
    const dogId = `dogA_${R}`
    await adminDb.collection('dogs').doc(dogId).set(puppyFixture({ passportId: `RED-2026-A-${R}` }))
    await as('breeder')
    let err = null
    try {
      await updateDoc(doc(clientDb, 'dogs', dogId), { colour: 'White' })
    } catch (e) { err = e }
    check('2a-ALLOWED', 'An authorized breeder can edit coatColour on their own newly-created, active puppy', err === null, err?.message)

    // ── 2b: White persists after reload/read-back ──
    const readBack = await getDoc(doc(clientDb, 'dogs', dogId))
    check('2b-PERSISTED', 'coatColour ("White") persists and reads back correctly after the save', readBack.data()?.colour === 'White')
  }

  // ── 2c: unauthorized users remain denied ──
  {
    const dogId = `dogC_${R}`
    await adminDb.collection('dogs').doc(dogId).set(puppyFixture({ passportId: `RED-2026-C-${R}` }))
    await as('stranger')
    let err = null
    try {
      await updateDoc(doc(clientDb, 'dogs', dogId), { colour: 'White' })
    } catch (e) { err = e }
    check('2c-DENIED', 'An unrelated stranger is denied editing coatColour on someone else\'s puppy', isDenied(err))
    const after = (await adminDb.collection('dogs').doc(dogId).get()).data()
    check('2c-DENIED', 'The denied write left no trace — colour was never changed', after.colour === 'Red')
  }

  // ── 2d: protected ownership/transfer fields remain immutable, even
  // when smuggled alongside an otherwise-legitimate coatColour edit ──
  {
    const dogId = `dogD_${R}`
    await adminDb.collection('dogs').doc(dogId).set(puppyFixture({ passportId: `RED-2026-D-${R}` }))
    await as('breeder')
    let err = null
    try {
      await updateDoc(doc(clientDb, 'dogs', dogId), { colour: 'White', currentOwnerId: strangerUid })
    } catch (e) { err = e }
    check('2d-PRESERVED', 'A currentOwnerId change bundled into a puppy edit is denied outright (protected field)', isDenied(err))
    const after = (await adminDb.collection('dogs').doc(dogId).get()).data()
    check('2d-PRESERVED', 'currentOwnerId is unchanged after the denied attempt', after.currentOwnerId === breederUid)
    check('2d-PRESERVED', 'colour is also unchanged — the whole write was denied, not partially applied', after.colour === 'Red')
  }

  // ── 2e: the exact Red Boy condition — a puppy that landed
  // status:'restricted' (over the breeder's plan cap at creation,
  // api/create-litter-puppy.js's own puppyStatus logic) stays read-only
  // for its own legitimate creator/owner. Confirms the UI fix's target
  // condition is real at the Rules level, and that this fix does NOT
  // weaken it. ──
  {
    const dogId = `dogE_${R}`
    await adminDb.collection('dogs').doc(dogId).set(puppyFixture({ passportId: `RED-2026-E-${R}`, status: 'restricted' }))
    await as('breeder')
    let err = null
    try {
      await updateDoc(doc(clientDb, 'dogs', dogId), { colour: 'White' })
    } catch (e) { err = e }
    check('2e-RESTRICTED', 'A restricted puppy stays read-only even for its own legitimate owner (unrelated existing rule, confirmed unweakened)', isDenied(err))
    const after = (await adminDb.collection('dogs').doc(dogId).get()).data()
    check('2e-RESTRICTED', 'The denied write left no trace on a restricted puppy', after.colour === 'Red')
  }
} else {
  skip('Section 2 emulator matrix (puppy edit authorization: allowed/denied/restricted cases)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
}

summary()
