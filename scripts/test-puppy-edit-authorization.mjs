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
function extractFunctionSource(src, signaturePattern) {
  const sigMatch = signaturePattern.exec(src)
  if (!sigMatch) return ''
  const startIdx = sigMatch.index
  const bodyOpenSearch = /\)\s*\{/.exec(src.slice(startIdx))
  if (!bodyOpenSearch) return ''
  const openIdx = startIdx + bodyOpenSearch.index + bodyOpenSearch[0].length - 1
  let depth = 0
  let inString = null
  let i = openIdx
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
  return src.slice(startIdx, i)
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

  // Codex re-review fix: the previous version of this check was a single
  // large-distance regex containing a literal `return\n\s*\}\n\s*try \{`
  // — that `\n` requires the byte immediately after "return" to be LF.
  // This repo's git config has core.autocrlf=true, so a fresh checkout
  // or `git archive` export of the exact same committed content can
  // legitimately be CRLF, making that literal `\n` fail to match even
  // though the logic itself is correct — the same class of bug this
  // codebase already hit and fixed once for test-litter-showcase.mjs.
  // Replaced with a balanced-brace extraction of handleSavePuppy's real
  // body (immune to line-ending encoding — see extractFunctionSource
  // above) plus a plain indexOf ORDER comparison, which asserts the same
  // fact — the restricted guard textually precedes the write call inside
  // the function — without depending on any specific byte sequence
  // between them.
  const handleSavePuppyBody = extractFunctionSource(littersSrc, /async function handleSavePuppy\(/)
  check('LittersPage.tsx: handleSavePuppy() was found by the balanced-brace extractor (extraction sanity check)',
    handleSavePuppyBody.length > 0)
  const restrictedGuardIdx = handleSavePuppyBody.indexOf("status === 'restricted'")
  const writeCallIdx = handleSavePuppyBody.indexOf('await updateDog(')
  check('LittersPage.tsx: handleSavePuppy short-circuits BEFORE attempting the write when the puppy is restricted',
    restrictedGuardIdx !== -1 && writeCallIdx !== -1 && restrictedGuardIdx < writeCallIdx,
    `restrictedGuardIdx=${restrictedGuardIdx}, writeCallIdx=${writeCallIdx}`)

  check('LittersPage.tsx: the restricted-puppy short-circuit message is clear and actionable, not the old bare "Failed to update puppy"',
    /over your plan's dog limit and is read-only — upgrade or free up a slot to edit it/.test(littersSrc))

  check('LittersPage.tsx: the edit form disables its fields (fieldset disabled) for a restricted puppy',
    /<fieldset disabled=\{isPuppyRestricted\}/.test(littersSrc))

  check('LittersPage.tsx: the Save changes button is also disabled for a restricted puppy (defense in depth alongside the fieldset)',
    /onClick=\{\(\) => handleSavePuppy\(puppy, litter\)\} disabled=\{isPuppyRestricted\}/.test(littersSrc))
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
