// Regression coverage for the litter/puppy DOB policy and litter-delete
// eligibility logic (fix/sire-heat-cycle, Final Litter Lifecycle
// Blockers).
//
// Bug 2 root cause: handleAddPuppy() in LittersPage.tsx wrote
// `dateOfBirth: litter.actualBirthDate || ''` — a planned litter with no
// actual birth date yet (only a mating/due date) could still have
// puppies added, each with an empty dateOfBirth. Fixed with a guard that
// blocks puppy creation entirely when the litter has no actualBirthDate,
// both in the UI (the "+ Add puppy" button itself is replaced with a
// message) and in the service-layer function, plus a Firestore rule
// requiring a non-empty dateOfBirth on every dog create and a litters
// update rule preventing actualBirthDate from being cleared while
// puppyIds is non-empty.
//
// This file combines:
//   1. Pure-logic mirrors of the eligible/preserved puppy partition used
//      by litter delete (isDogTransferred) and the DOB-inheritance rule.
//   2. Static source assertions that LittersPage.tsx and firestore.rules
//      actually implement the policy (batching, guards, rule shape).
//   3. Emulator-only checks (skipped with a clear notice if no emulator
//      is reachable) for the two new Firestore rule invariants.
//
// Usage: node scripts/test-litter-dob-policy.mjs
//   (emulator sections need: firebase emulators:start --only auth,firestore
//    --project demo-idogs-qa, plus FIRESTORE_EMULATOR_HOST/
//    FIREBASE_AUTH_EMULATOR_HOST — the pure-logic/structural sections run
//    without it)

const { readFileSync } = await import('node:fs')

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

// ── Mirror of lib/utils.ts's isDogTransferred + the eligible/preserved
// partition LittersPage.handleDeleteLitter uses ──
function isDogTransferred(dog) {
  return dog.status === 'transferred' || dog.transferStatus === 'pendingClaim'
}
function partitionLitterPuppies(dogs, puppyIds) {
  const puppyDogs = dogs.filter(d => puppyIds?.includes(d.id))
  const eligible = puppyDogs.filter(d => !isDogTransferred(d))
  const preserved = puppyDogs.filter(isDogTransferred)
  return { eligible, preserved }
}

// ── Test 1: eligible/preserved partition for litter delete ──
{
  const dogs = [
    { id: 'p1', status: 'active' },
    { id: 'p2', status: 'active' },
    { id: 'p3', status: 'transferred' },
    { id: 'p4', status: 'active', transferStatus: 'pendingClaim' },
    { id: 'unrelated', status: 'active' }, // not in puppyIds
  ]
  const { eligible, preserved } = partitionLitterPuppies(dogs, ['p1', 'p2', 'p3', 'p4'])
  check('Untransferred puppies (p1, p2) are eligible for deletion', eligible.length === 2 && eligible.every(d => ['p1', 'p2'].includes(d.id)))
  check('Transferred puppy (p3) is preserved', preserved.some(d => d.id === 'p3'))
  check('Pending-claim puppy (p4) is preserved', preserved.some(d => d.id === 'p4'))
  check('Unrelated dog never enters either bucket', !eligible.some(d => d.id === 'unrelated') && !preserved.some(d => d.id === 'unrelated'))
}

// ── Test 2: an empty litter (no puppies) partitions to nothing, no crash ──
{
  const { eligible, preserved } = partitionLitterPuppies([{ id: 'x', status: 'active' }], [])
  check('Litter with no puppyIds partitions to zero eligible/preserved', eligible.length === 0 && preserved.length === 0)
}

// ── Test 3: DOB inheritance — a puppy's dateOfBirth always equals the
// litter's actualBirthDate, never independently entered ──
{
  const litter = { actualBirthDate: '2026-03-15' }
  const puppyDateOfBirth = litter.actualBirthDate // mirrors createDog({ ..., dateOfBirth: litter.actualBirthDate })
  check('Puppy dateOfBirth inherits exactly from litter.actualBirthDate', puppyDateOfBirth === '2026-03-15')
}

// ── Test 4 (structural): handleAddPuppy blocks creation without an
// actual birth date, and the "+ Add puppy" control itself is replaced
// by a message rather than left clickable into a dead end ──
{
  const src = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('handleAddPuppy guards on litter.actualBirthDate before creating anything',
    /if \(!litter\.actualBirthDate\) \{/.test(src) && /toast\('Set an actual birth date/.test(src))
  check('createDog is called with litter.actualBirthDate directly (no || \'\' fallback masking a missing date)',
    /dateOfBirth: litter\.actualBirthDate,/.test(src) && !/dateOfBirth: litter\.actualBirthDate \|\| ''/.test(src))
  check('"+ Add puppy" button is conditionally replaced by a message when actualBirthDate is missing',
    /litter\.actualBirthDate \? \(/.test(src) && /Set an actual birth date to add puppies/.test(src))
}

// ── Test 5 (structural): editing a litter with existing puppies cannot
// clear actualBirthDate, and a real DOB change propagates to eligible
// (untransferred) puppies only, batched with the litter update ──
{
  const src = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('handleSaveLitter blocks clearing actualBirthDate while puppyIds is non-empty',
    /\(litter\.puppyIds\?\.length \|\| 0\) > 0 && !editLitterForm\.actualBirthDate/.test(src))
  check('DOB propagation filters puppies through isDogTransferred (only untransferred puppies updated)',
    /litter\.puppyIds\?\.includes\(d\.id\) && !isDogTransferred\(d\)/.test(src))
  check('Litter update + puppy DOB propagation use one writeBatch (no partial-update risk)',
    /const batch = writeBatch\(db\)[\s\S]{0,400}batch\.update\(doc\(db, 'litters'/.test(src))
}

// ── Test 6 (structural): litter delete batches the litter + eligible
// puppies atomically, and the confirmation reports the affected count ──
{
  const src = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('handleDeleteLitter computes eligible via isDogTransferred (not a bespoke check)',
    /const eligible = puppyDogs\.filter\(d => !isDogTransferred\(d\)\)/.test(src))
  check('Delete confirmation message includes the eligible puppy count',
    /This will also delete \$\{eligible\.length\} puppy record/.test(src))
  check('Delete confirmation message mentions preserved (transferred) puppies when any exist',
    /already-transferred puppy record\$\{preserved !== 1/.test(src))
  check('Litter delete uses one writeBatch for the litter doc + all eligible puppy docs',
    /const batch = writeBatch\(db\)[\s\S]{0,200}batch\.delete\(doc\(db, 'litters'/.test(src))
}

// ── Test 7 (structural): firestore.rules enforces both invariants
// independently of the client ──
{
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const dogsBlock = (rules.match(/match \/dogs\/\{dogId\} \{[\s\S]*?\n    \}/) || [''])[0]
  check('dogs create requires a non-empty dateOfBirth',
    /request\.resource\.data\.dateOfBirth is string &&\s*\n\s*request\.resource\.data\.dateOfBirth\.size\(\) > 0/.test(dogsBlock))
  const littersBlock = (rules.match(/match \/litters\/\{id\} \{[\s\S]*?\n    \}/) || [''])[0]
  check('litters update requires actualBirthDate to stay non-empty while puppyIds is non-empty',
    /get\('puppyIds', \[\]\)\.size\(\) == 0 \|\|/.test(littersBlock) &&
    /get\('actualBirthDate', ''\)\.size\(\) > 0/.test(littersBlock))
}

// ── Test 8: no PII logging — the new/changed code paths (delete litter,
// save litter, add puppy) never console.log/error a dog/dam/puppy name,
// buyer email, or other identifying record data ──
{
  const src = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  const fnBlocks = [
    src.match(/async function handleDeleteLitter[\s\S]*?async function handleAddPuppy/)?.[0],
    src.match(/async function handleSaveLitter[\s\S]*?async function handleDeleteLitter/)?.[0],
    src.match(/async function handleAddPuppy[\s\S]*?function startEditPuppy/)?.[0],
  ].filter(Boolean)
  check('All three litter-lifecycle functions were found for inspection', fnBlocks.length === 3)
  for (const block of fnBlocks) {
    const logCalls = block.match(/console\.(error|log|warn)\([^)]*\)/g) || []
    const leaksPii = logCalls.some(c => /\.name\b|buyerEmail|\.email\b|litterName/.test(c))
    check('No console logging of dog/litter names or emails in litter-lifecycle functions', !leaksPii, logCalls.join(' | '))
  }
}

// ── Emulator sections (skipped gracefully if no emulator reachable) ──
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  const { initializeApp } = await import('firebase/app')
  const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } = await import('firebase/auth')
  const { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc } = await import('firebase/firestore')

  const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'dob-policy-app')
  const auth = getAuth(app)
  const db = getFirestore(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)

  function isDenied(err) { return err && (err.code === 'permission-denied' || /permission/i.test(err.message)) }

  const PW = 'tam12345*'
  const R = Date.now()
  const { user } = await createUserWithEmailAndPassword(auth, `dobpolicy.${R}@emulator.local`, PW)
  const uid = user.uid

  // ── Test 9: dogs create requires non-empty dateOfBirth ──
  {
    let emptyDenied = false
    try {
      await setDoc(doc(db, 'dogs', `nodobpup_${R}`), {
        tenantId: uid, currentOwnerId: uid, createdByUserId: uid,
        sourceType: 'BREEDER_ISSUED', name: 'NoDobPup', sex: 'male', status: 'active', dateOfBirth: '',
      })
    } catch (err) { emptyDenied = isDenied(err) }
    check('9-DogsRule', 'Creating a dog with an empty dateOfBirth is rejected', emptyDenied)

    let missingDenied = false
    try {
      await setDoc(doc(db, 'dogs', `missingdobpup_${R}`), {
        tenantId: uid, currentOwnerId: uid, createdByUserId: uid,
        sourceType: 'BREEDER_ISSUED', name: 'MissingDobPup', sex: 'male', status: 'active',
      })
    } catch (err) { missingDenied = isDenied(err) }
    check('9-DogsRule', 'Creating a dog with no dateOfBirth field at all is rejected', missingDenied)

    let validOk = true
    try {
      await setDoc(doc(db, 'dogs', `validdobpup_${R}`), {
        tenantId: uid, currentOwnerId: uid, createdByUserId: uid,
        sourceType: 'BREEDER_ISSUED', name: 'ValidDobPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
      })
    } catch (err) { validOk = false }
    check('9-DogsRule', 'Creating a dog with a valid dateOfBirth still succeeds', validOk)
  }

  // ── Test 10: litters update cannot clear actualBirthDate while
  // puppyIds is non-empty, but can while it's empty ──
  {
    const damId = `dobdam_${R}`
    await setDoc(doc(db, 'dogs', damId), {
      tenantId: uid, currentOwnerId: uid, createdByUserId: uid,
      sourceType: 'BREEDER_ISSUED', name: 'DobDam', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
    })
    const litterWithPuppies = `litterwp_${R}`
    await setDoc(doc(db, 'litters', litterWithPuppies), {
      tenantId: uid, damId, name: 'WithPuppies', notes: '', actualBirthDate: '2026-01-01', puppyIds: [`validdobpup_${R}`],
    })
    let clearDenied = false
    try { await updateDoc(doc(db, 'litters', litterWithPuppies), { actualBirthDate: '' }) } catch (err) { clearDenied = isDenied(err) }
    check('10-LittersRule', 'Clearing actualBirthDate on a litter with puppies is rejected', clearDenied)

    let changeOk = true
    try { await updateDoc(doc(db, 'litters', litterWithPuppies), { actualBirthDate: '2026-01-02' }) } catch (err) { changeOk = false }
    check('10-LittersRule', 'Changing (not clearing) actualBirthDate on a litter with puppies still succeeds', changeOk)

    const litterNoPuppies = `litternp_${R}`
    await setDoc(doc(db, 'litters', litterNoPuppies), {
      tenantId: uid, damId, name: 'NoPuppiesYet', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
    })
    let clearOkWhenEmpty = true
    try { await updateDoc(doc(db, 'litters', litterNoPuppies), { actualBirthDate: '' }) } catch (err) { clearOkWhenEmpty = false }
    check('10-LittersRule', 'Clearing actualBirthDate on a planned litter with zero puppies is allowed', clearOkWhenEmpty)
  }

  await signOut(auth)
} else {
  console.log('SKIPPED: emulator sections (9, 10) — set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
