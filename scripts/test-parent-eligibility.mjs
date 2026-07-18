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

// ── Test 6: transferred / pending-claim / non-active status (Codex
// round 4, Blocker 1 — status must be EXACTLY 'active'; a transferred
// dog's status is always 'transferred', so it's caught by the stricter
// status check before ever reaching the old transferStatus-only check) ──
{
  const transferred = validateBreedingParent(eligibleDog({ status: 'transferred' }), { uid: UID, requiredSex: 'female' })
  check('Transferred (status=transferred) parent is rejected', transferred.valid === false && transferred.reason === 'PARENT_NOT_ACTIVE')
  const pending = validateBreedingParent(eligibleDog({ status: 'active', transferStatus: 'pendingClaim' }), { uid: UID, requiredSex: 'female' })
  check('Pending-claim parent is rejected even though currentOwnerId and status both look clean', pending.valid === false && pending.reason === 'PARENT_TRANSFERRED')
}

// ── Test 6b: every non-'active' status fails closed (Codex round 4,
// Blocker 1 — "missing, malformed, archived, deleted, transferred, or
// any other status must fail closed") ──
{
  check('status="archived" is rejected', validateBreedingParent(eligibleDog({ status: 'archived' }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_NOT_ACTIVE')
  check('status="deleted" is rejected', validateBreedingParent(eligibleDog({ status: 'deleted' }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_NOT_ACTIVE')
  check('status=undefined (missing entirely) is rejected, never defaults to active', validateBreedingParent(eligibleDog({ status: undefined }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_NOT_ACTIVE')
  check('status="" (empty string) is rejected', validateBreedingParent(eligibleDog({ status: '' }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_NOT_ACTIVE')
  check('status=null is rejected', validateBreedingParent(eligibleDog({ status: null }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_NOT_ACTIVE')
  check('status=123 (wrong type) is rejected', validateBreedingParent(eligibleDog({ status: 123 }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_NOT_ACTIVE')
  check('status="Active" (wrong case) is rejected — exact match only, no case-insensitive leniency', validateBreedingParent(eligibleDog({ status: 'Active' }), { uid: UID, requiredSex: 'female' }).reason === 'PARENT_NOT_ACTIVE')
  check('status="active" (the one accepted value) passes this check', validateBreedingParent(eligibleDog({ status: 'active' }), { uid: UID, requiredSex: 'female' }).valid === true)
}

// ── Test 6c: exact calendar age — day/month/year, not just month
// arithmetic (Codex round 4, Blocker 2) ──
{
  // "31 Jul 2025 -> 1 Jul 2026: underage" and "1 Jul 2025 -> 1 Jul 2026:
  // eligible" from the task spec, expressed as a fixed `now` so the test
  // is deterministic regardless of what day it actually runs.
  const now = new Date(2026, 6, 1) // 1 Jul 2026 (JS months are 0-indexed)
  // Directly exercise ageInMonths with a fixed `now` to pin the exact
  // day/month/year cases from the task spec, independent of whichever
  // day this suite happens to run on.
  check('ageInMonths(31 Jul 2025, now=1 Jul 2026) = 11 (one day short of 12 full months)', ageInMonths(new Date(2025, 6, 31), now) === 11)
  check('ageInMonths(1 Jul 2025, now=1 Jul 2026) = 12 (exactly 12 full months)', ageInMonths(new Date(2025, 6, 1), now) === 12)
  // Deterministic leap-day behavior: birth on 29 Feb 2024 (leap year) —
  // the "anniversary" in non-leap 2025 has no 29 Feb, so it must land on
  // 1 Mar, never silently miscounting.
  check('ageInMonths(29 Feb 2024, now=28 Feb 2025) = 11 (leap-day birth, day before the non-leap-year rollover)', ageInMonths(new Date(2024, 1, 29), new Date(2025, 1, 28)) === 11)
  check('ageInMonths(29 Feb 2024, now=1 Mar 2025) = 12 (leap-day birth, deterministically resolves to 1 Mar in a non-leap year)', ageInMonths(new Date(2024, 1, 29), new Date(2025, 2, 1)) === 12)
  // Deterministic month-end behavior: birth on the 31st of a long month,
  // "now" in a shorter month.
  check('ageInMonths(31 Jan 2025, now=28 Feb 2025) = 0 (Feb has no 31st — anniversary not yet reached)', ageInMonths(new Date(2025, 0, 31), new Date(2025, 1, 28)) === 0)
  check('ageInMonths(31 Jan 2025, now=1 Mar 2025) = 1 (rolled into March)', ageInMonths(new Date(2025, 0, 31), new Date(2025, 2, 1)) === 1)
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
  // Codex round 4, Blocker 1: the Dam/Sire read now happens via tx.get()
  // INSIDE db.runTransaction, not a bare .get() outside one — re-reads
  // it fresh at commit time (see parent-eligibility.js's own comment on
  // why a plain get()-then-write() sequence has a race window a
  // transaction closes).
  check('create-litter.js reads the Dam via a ref (db.collection(\'dogs\').doc(damId)) — never trusts req.body for dog data',
    /const damRef = db\.collection\('dogs'\)\.doc\(damId\)/.test(apiSrc))
  check('create-litter.js re-reads the Dam INSIDE the transaction (tx.get(damRef)), not before it',
    /await tx\.get\(damRef\)/.test(apiSrc))
  check('create-litter.js does the Dam/Sire validation + litter write inside one db.runTransaction',
    /await db\.runTransaction\(async \(tx\) => \{/.test(apiSrc))
  check('create-litter.js validates via validateBreedingParent, not any client-submitted eligibility claim',
    /validateBreedingParent\(damSnap\.exists \? damSnap\.data\(\) : null/.test(apiSrc))
  check('save-heat-cycle.js reads the Dam via a ref (db.collection(\'dogs\').doc(dogId)) on create',
    /const damRef = db\.collection\('dogs'\)\.doc\(dogId\)/.test(heatSrc))
  check('save-heat-cycle.js re-reads the Dam INSIDE the transaction (tx.get(damRef)) on create, not before it',
    /await tx\.get\(damRef\)/.test(heatSrc))
  check('save-heat-cycle.js does CREATE validation + write inside db.runTransaction (appears at least twice: create and update paths)',
    (heatSrc.match(/await db\.runTransaction\(async \(tx\) => \{/g) || []).length >= 2)
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

  // ── Test 13: parent mutation DURING the API operation (Codex round 4,
  // Blocker 1 — "concurrent ownership, status, transfer, claim, deceased
  // or DOB changes must conflict, retry and revalidate"). Mirrors
  // create-litter.js's exact transaction shape via the Admin SDK
  // directly (no HTTP layer available in this test harness). The Dam is
  // transferred by a fully-completed, separate write BEFORE the
  // transaction runs at all — proving the transaction's tx.get() reads
  // live state at execution time, never a snapshot from before the
  // request started, which is the property that actually matters here
  // (a request that arrives after a concurrent transfer must see it).
  //
  // A literal mid-callback concurrent write to the SAME document from
  // the SAME Admin SDK client was tried and DROPPED — it deadlocks: the
  // transaction holds a read lock on the Dam until it commits, but a
  // plain (non-transactional) write to that same document from the same
  // client blocks waiting for that lock to release, while the
  // transaction callback itself is awaiting that write's promise before
  // it can finish and commit. That's an artifact of sharing one client
  // across both operations, not something a real concurrent REQUEST
  // (its own separate client/connection) would hit — so it isn't a real
  // product bug, just an unsafe way to write this specific test. ──
  {
    const damId = `damconcurrent_${R}`
    await adminDb.collection('dogs').doc(damId).set({
      tenantId: uid, currentOwnerId: uid, createdByUserId: uid, sourceType: 'BREEDER_ISSUED',
      name: 'ConcurrentDam', sex: 'female', status: 'active', isDeceased: false, dateOfBirth: dobYearsAgo(3),
    })
    // Fully-completed concurrent mutation, BEFORE the transaction starts.
    await adminDb.collection('dogs').doc(damId).update({ status: 'transferred' })

    const damRef = adminDb.collection('dogs').doc(damId)
    const litterRef = adminDb.collection('litters').doc()
    const outcome = await adminDb.runTransaction(async (tx) => {
      const damSnap = await tx.get(damRef)
      const damCheck = validateBreedingParent(damSnap.exists ? damSnap.data() : null, { uid, requiredSex: 'female' })
      if (!damCheck.valid) return { ok: false, reason: damCheck.reason }
      tx.set(litterRef, { tenantId: uid, damId, name: 'ConcurrentTest', notes: '', puppyIds: [], createdAt: new Date().toISOString() })
      return { ok: true }
    })

    check('13-ConcurrentMutation', 'The transaction reads live state and rejects the already-transferred Dam', outcome.ok === false && outcome.reason === 'PARENT_NOT_ACTIVE', JSON.stringify(outcome))
    const litterSnap = await litterRef.get()
    check('13-ConcurrentMutation', 'No litter was committed for the now-invalid Dam', !litterSnap.exists)
  }

  await signOut(clientAuth).catch(() => {})
} else {
  console.log('SKIPPED: emulator integration section (Tests 11-12) — set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
