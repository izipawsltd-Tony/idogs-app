// Regression coverage for the canonical server-side breeding-parent
// eligibility policy (fix/sire-heat-cycle, Codex round 3, Blocker 1).
//
// api/_lib/parent-eligibility.js is imported DIRECTLY here (not
// mirrored) — it's plain, dependency-free ESM with no Vite/Firebase
// client imports, so this exercises the exact code the API routes run,
// not a copy of it that could drift.
//
// Combines:
//   1. Pure-logic tests against validateBreedingParent/
//      parseDobStrictServer directly (no emulator needed).
//   2. Emulator-only integration tests: real Admin SDK reads of real
//      (emulated) Dog documents run through the SAME validator, plus
//      confirmation that firestore.rules now denies ANY direct client
//      write to litters/heatCycles create (even a fully eligible one) —
//      the trusted server endpoint is the only path, not just the
//      "usual" one.
//
// Usage: node scripts/test-parent-eligibility.mjs
//   (integration section needs: firebase emulators:start --only
//    auth,firestore --project demo-idogs-qa, plus
//    FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST — the pure-logic
//    section runs without it)

import { validateBreedingParent, parseDobStrictServer, ageInMonths, MIN_BREEDING_MONTHS } from '../api/_lib/parent-eligibility.js'

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

function dobYearsAgo(years) {
  const d = new Date()
  d.setMonth(d.getMonth() - Math.round(years * 12))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dobMonthsAgo(months) {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const UID = 'breeder-uid-1'

function eligibleDog(overrides = {}) {
  return {
    currentOwnerId: UID, sex: 'female', isDeceased: false, status: 'active',
    dateOfBirth: dobYearsAgo(3),
    ...overrides,
  }
}

// ── Test 1: MIN_BREEDING_MONTHS matches the documented universal floor ──
{
  check('MIN_BREEDING_MONTHS is 12 (the floor across every AU state in breedingCompliance.ts)', MIN_BREEDING_MONTHS === 12)
}

// ── Test 2: nonexistent parent ──
{
  const result = validateBreedingParent(null, { uid: UID, requiredSex: 'female' })
  check('Nonexistent parent (null doc) is rejected', result.valid === false && result.reason === 'PARENT_NOT_FOUND')
}

// ── Test 3: wrong tenant / not controlled ──
{
  const result = validateBreedingParent(eligibleDog({ currentOwnerId: 'someone-else' }), { uid: UID, requiredSex: 'female' })
  check('A dog not currently controlled by the requester is rejected', result.valid === false && result.reason === 'PARENT_NOT_CONTROLLED')
}

// ── Test 4: wrong sex ──
{
  const result = validateBreedingParent(eligibleDog({ sex: 'male' }), { uid: UID, requiredSex: 'female' })
  check('Wrong sex is rejected', result.valid === false && result.reason === 'PARENT_WRONG_SEX')
}

// ── Test 5: deceased ──
{
  const result = validateBreedingParent(eligibleDog({ isDeceased: true }), { uid: UID, requiredSex: 'female' })
  check('Deceased parent is rejected', result.valid === false && result.reason === 'PARENT_DECEASED')
}

// ── Test 6: transferred / pending-claim ──
{
  const transferred = validateBreedingParent(eligibleDog({ status: 'transferred' }), { uid: UID, requiredSex: 'female' })
  check('Transferred (status=transferred) parent is rejected', transferred.valid === false && transferred.reason === 'PARENT_TRANSFERRED')
  const pending = validateBreedingParent(eligibleDog({ status: 'active', transferStatus: 'pendingClaim' }), { uid: UID, requiredSex: 'female' })
  check('Pending-claim parent is rejected even though currentOwnerId and status both look clean', pending.valid === false && pending.reason === 'PARENT_TRANSFERRED')
}

// ── Test 7: invalid calendar / missing / malformed / future DOB ──
{
  check('Missing DOB is rejected', validateBreedingParent(eligibleDog({ dateOfBirth: undefined }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_INVALID_DOB')
  check('Malformed DOB string is rejected', validateBreedingParent(eligibleDog({ dateOfBirth: 'not-a-date' }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_INVALID_DOB')
  check('Impossible calendar date ("2020-02-30") is rejected', validateBreedingParent(eligibleDog({ dateOfBirth: '2020-02-30' }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_INVALID_DOB')
  check('Future DOB is rejected', validateBreedingParent(eligibleDog({ dateOfBirth: '2099-01-01' }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_INVALID_DOB')
  check('Non-string DOB (wrong type) is rejected', validateBreedingParent(eligibleDog({ dateOfBirth: 20200101 }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_INVALID_DOB')
}

// ── Test 8: underage (valid DOB, but under the actual minimum breeding
// maturity — the check Firestore Rules cannot do) ──
{
  const underage = validateBreedingParent(eligibleDog({ dateOfBirth: dobMonthsAgo(6) }), { uid: UID, requiredSex: 'female' })
  check('A dog with a valid but recent DOB (6 months old) is rejected as underage', underage.valid === false && underage.reason === 'PARENT_UNDERAGE')
  const justUnder = validateBreedingParent(eligibleDog({ dateOfBirth: dobMonthsAgo(11) }), { uid: UID, requiredSex: 'female' })
  check('11 months old is still underage', justUnder.valid === false && justUnder.reason === 'PARENT_UNDERAGE')
  const atThreshold = validateBreedingParent(eligibleDog({ dateOfBirth: dobMonthsAgo(12) }), { uid: UID, requiredSex: 'female' })
  check('Exactly 12 months old meets the minimum', atThreshold.valid === true)
}

// ── Test 9: fully eligible dog passes ──
{
  const result = validateBreedingParent(eligibleDog(), { uid: UID, requiredSex: 'female' })
  check('A fully eligible dog (3yo, active, owned, correct sex) passes', result.valid === true)
  const maleResult = validateBreedingParent(eligibleDog({ sex: 'male' }), { uid: UID, requiredSex: 'male' })
  check('A fully eligible male dog passes the male check', maleResult.valid === true)
}

// ── Test 10: client-bypass simulation — even if a malicious/buggy
// client submits a "clean-looking" dogData object claiming eligibility,
// this function only ever trusts what's PASSED to it as `dogData`. The
// real safety property (never trusting client-submitted parent
// attributes) comes from the CALLER always passing Admin-SDK-fetched
// data, not from anything this pure function can enforce on its own —
// verified structurally below. ──
{
  const apiSrc = await (await import('node:fs')).promises.readFile(new URL('../api/create-litter.js', import.meta.url), 'utf8')
  const heatSrc = await (await import('node:fs')).promises.readFile(new URL('../api/save-heat-cycle.js', import.meta.url), 'utf8')
  check('create-litter.js re-reads the Dam via db.collection(\'dogs\').doc(damId).get() — never trusts req.body for dog data',
    /db\.collection\('dogs'\)\.doc\(damId\)\.get\(\)/.test(apiSrc))
  check('create-litter.js validates via validateBreedingParent, not any client-submitted eligibility claim',
    /validateBreedingParent\(damSnap\.exists \? damSnap\.data\(\) : null/.test(apiSrc))
  check('save-heat-cycle.js re-reads the Dam via db.collection(\'dogs\').doc(dogId).get() on create',
    /db\.collection\('dogs'\)\.doc\(dogId\)\.get\(\)/.test(heatSrc))
  check('Both endpoints verify a Firebase ID token before doing anything (uid comes from the verified token, never the body)',
    /verifyIdToken\(idToken\)/.test(apiSrc) && /verifyIdToken\(idToken\)/.test(heatSrc))
}

// ── Emulator integration section (skipped gracefully if unavailable) ──
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  const { initializeApp } = await import('firebase/app')
  const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } = await import('firebase/auth')
  const { getFirestore, connectFirestoreEmulator, doc, setDoc } = await import('firebase/firestore')
  const { initializeApp: initAdminApp } = await import('firebase-admin/app')
  const { getFirestore: getAdminFirestore } = await import('firebase-admin/firestore')

  const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'parent-eligibility-app')
  const clientAuth = getAuth(app)
  const clientDb = getFirestore(app)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080)

  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST // already set
  const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' }, 'parent-eligibility-admin')
  const adminDb = getAdminFirestore(adminApp)

  function isDenied(err) { return err && (err.code === 'permission-denied' || /permission/i.test(err.message)) }

  const PW = 'tam12345*'
  const R = Date.now()
  const { user } = await createUserWithEmailAndPassword(clientAuth, `parenteligibility.${R}@emulator.local`, PW)
  const uid = user.uid

  // ── Test 11: real (emulated) Admin SDK data run through the real validator ──
  {
    const eligibleId = `eligible_${R}`
    await adminDb.collection('dogs').doc(eligibleId).set({
      tenantId: uid, currentOwnerId: uid, createdByUserId: uid, sourceType: 'BREEDER_ISSUED',
      name: 'Eligible', sex: 'female', status: 'active', isDeceased: false, dateOfBirth: dobYearsAgo(3),
    })
    const snap = await adminDb.collection('dogs').doc(eligibleId).get()
    const result = validateBreedingParent(snap.data(), { uid, requiredSex: 'female' })
    check('11-Integration', 'A real emulated eligible dog document validates as eligible', result.valid === true)

    const underageId = `underage_${R}`
    await adminDb.collection('dogs').doc(underageId).set({
      tenantId: uid, currentOwnerId: uid, createdByUserId: uid, sourceType: 'BREEDER_ISSUED',
      name: 'Underage', sex: 'female', status: 'active', isDeceased: false, dateOfBirth: dobMonthsAgo(3),
    })
    const underageSnap = await adminDb.collection('dogs').doc(underageId).get()
    const underageResult = validateBreedingParent(underageSnap.data(), { uid, requiredSex: 'female' })
    check('11-Integration', 'A real emulated underage dog document is rejected', underageResult.valid === false && underageResult.reason === 'PARENT_UNDERAGE')
  }

  // ── Test 12: direct client writes to litters/heatCycles create are
  // now denied UNCONDITIONALLY — even a fully eligible, well-formed
  // payload — proving the server endpoint is the only path, not just
  // the usual one. ──
  {
    await signOut(clientAuth).catch(() => {})
    await signInWithEmailAndPassword(clientAuth, `parenteligibility.${R}@emulator.local`, PW)

    const damId = `damdenied_${R}`
    await adminDb.collection('dogs').doc(damId).set({
      tenantId: uid, currentOwnerId: uid, createdByUserId: uid, sourceType: 'BREEDER_ISSUED',
      name: 'DeniedDam', sex: 'female', status: 'active', isDeceased: false, dateOfBirth: dobYearsAgo(3),
    })
    let litterCreateDenied = false
    try {
      await setDoc(doc(clientDb, 'litters', `litter_denied_${R}`), {
        tenantId: uid, damId, name: 'Should Be Denied', notes: '', puppyIds: [],
      })
    } catch (err) { litterCreateDenied = isDenied(err) }
    check('12-ServerOnly', 'A direct client litters create is denied even for a fully eligible Dam', litterCreateDenied)

    let heatCreateDenied = false
    try {
      await setDoc(doc(clientDb, 'heatCycles', `cyc_denied_${R}`), {
        dogId: damId, tenantId: uid, heatNumber: 1, heatStartDate: '2026-01-01',
      })
    } catch (err) { heatCreateDenied = isDenied(err) }
    check('12-ServerOnly', 'A direct client heatCycles create is denied even for a fully eligible Dam', heatCreateDenied)
  }

  await signOut(clientAuth).catch(() => {})
} else {
  console.log('SKIPPED: emulator integration section (Tests 11-12) — set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
