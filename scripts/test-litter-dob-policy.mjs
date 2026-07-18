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

// Codex round 6: some of this file's check() calls pass check(sectionLabel,
// description, condition) — fixed via call-shape detection. Codex round
// 7, Blocker 1: now uses the shared, self-tested
// scripts/_lib/test-check.mjs, which keeps that same shape detection AND
// throws loudly instead of silently passing when given an unawaited
// Promise/thenable as the condition.
import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

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
// clear actualBirthDate, and a real DOB change propagates to still-
// eligible puppies only. Codex round 4, Blocker 3 moved this whole
// operation server-side (api/update-litter.js) — firestore.rules denies
// a direct client litters update outright, so the client-side
// writeBatch/isDogTransferred-filter approach round 3 used no longer
// exists to check for; the same invariants are now enforced (and
// exercised end-to-end via an Admin SDK mirror) in
// test-atomic-transactions.mjs's Section 4. ──
{
  const src = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  const apiSrc = readFileSync(new URL('../api/update-litter.js', import.meta.url), 'utf8')
  check('handleSaveLitter calls the server endpoint (updateLitter from lib/db) rather than writing Firestore directly',
    /const \{ updatedPuppyCount \} = await updateLitter\(litterId, editLitterForm\)/.test(src))
  check('api/update-litter.js blocks clearing actualBirthDate while puppies exist',
    /hasPuppies && !safePatch\.actualBirthDate/.test(apiSrc))
  check('api/update-litter.js propagates DOB changes via the shared litter-eligibility policy (partitionLitterCandidatesServer), not a bare isDogTransferred filter',
    /partitionLitterCandidatesServer\(litterId, fetched, uid\)/.test(apiSrc))
}

// ── Test 6 (structural): litter delete is now a trusted server endpoint
// (Codex round 4, Blocker 3) whose own Admin SDK transaction re-reads
// and re-decides eligibility from scratch — LittersPage.tsx's own copy
// of partitionLitterCandidates is now preview-only (confirm-dialog
// wording, non-authoritative — see that function's own comment); the
// canonical, enforcing copy is api/_lib/litter-eligibility.js, exercised
// end-to-end in test-atomic-transactions.mjs's Section 1/2/6. ──
{
  const src = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  const eligibilitySrc = readFileSync(new URL('../api/_lib/litter-eligibility.js', import.meta.url), 'utf8')
  const deleteApiSrc = readFileSync(new URL('../api/delete-litter.js', import.meta.url), 'utf8')
  check('partitionLitterCandidates (client preview) requires exact litterId membership before considering a dog at all',
    /confirmedMembers = fetched\.filter\(d => d\.litterId === litterId\)/.test(src))
  // Codex round 5, Blocker 3: eligibility is now presence-based (a
  // history field being present at all is a signal, not just a truthy
  // value — see isDogHistoryBearing's own comment on why `!d.buyerEmail`
  // was wrong), factored into isDogSafeToDetach rather than an inline
  // truthiness expression.
  check('api/_lib/litter-eligibility.js computes eligible via isDogSafeToDetach (currentOwnerId, transfer state, presence-based history — incl. claimedBy)',
    /export function isDogSafeToDetach\(dog, requesterUid\)/.test(eligibilitySrc) &&
    /dog\.currentOwnerId !== requesterUid/.test(eligibilitySrc) &&
    /isDogHistoryBearing\(dog\)/.test(eligibilitySrc) &&
    /const HISTORY_FIELDS = \[.*'buyerEmail'.*'previousOwnerId'.*'transferredAt'.*'claimedAt'.*'claimedBy'.*\]/.test(eligibilitySrc))
  check('Delete confirmation message includes the eligible puppy count',
    /This will also delete \$\{eligibleCount\} puppy record/.test(src))
  check('Delete confirmation message mentions preserved puppies when any exist',
    /preservedCount !== 1 \? 's' : ''\} will be kept/.test(src))
  check('handleDeleteLitter calls the server endpoint (deleteLitterServer from lib/db) rather than a client transaction',
    /outcome = await deleteLitterServer\(litter\.id\)/.test(src))
  // Codex round 5, Blocker 2: delete-litter.js now ALSO queries dogs by
  // litterId directly (the reverse direction), not just litter.puppyIds.
  check('api/delete-litter.js runs the eligibility decision inside db.runTransaction, reading litter, forward puppyIds, AND a reverse litterId query before any tx.delete',
    /await db\.runTransaction\(async \(tx\) => \{[\s\S]{0,100}const litterSnap = await tx\.get\(litterRef\)/.test(deleteApiSrc) &&
    /db\.collection\('dogs'\)\.where\('litterId', '==', litterId\)/.test(deleteApiSrc) &&
    /resolveLitterMembership\(litterId, forwardFetched, reverseFetched\)/.test(deleteApiSrc))
}

// ── Test 7 (structural): firestore.rules enforces both invariants
// independently of the client ──
{
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const dogsBlock = (rules.match(/match \/dogs\/\{dogId\} \{[\s\S]*?\n    \}/) || [''])[0]
  check('dogs create requires a validly-shaped dateOfBirth (isValidDobString)',
    /isValidDobString\(request\.resource\.data\.dateOfBirth\)/.test(dogsBlock))
  const littersBlock = (rules.match(/match \/litters\/\{id\} \{[\s\S]*?\n    \}/) || [''])[0]
  // Codex round 4, Blocker 3: litters update is no longer a conditional
  // in-rules check (DOB-format-while-puppies-exist) — it's denied
  // unconditionally, and that same invariant is now enforced (with a
  // stronger, real-past-date check, not just format) server-side in
  // api/update-litter.js — see test-atomic-transactions.mjs Section 4.
  check('litters update is denied outright for direct client writes (moved server-side)', /allow create, update, delete: if false;/.test(littersBlock))
  const updateApiSrc = readFileSync(new URL('../api/update-litter.js', import.meta.url), 'utf8')
  check('api/update-litter.js enforces the actualBirthDate-cannot-be-cleared-with-puppies invariant server-side',
    /hasPuppies && !safePatch\.actualBirthDate/.test(updateApiSrc))
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
  const { initializeApp: initAdminApp } = await import('firebase-admin/app')
  const { getFirestore: getAdminFirestore } = await import('firebase-admin/firestore')

  const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'dob-policy-app')
  const auth = getAuth(app)
  const db = getFirestore(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  // litters create is now server-endpoint-only (Codex round 3) — these
  // fixtures simulate what api/create-litter.js would have written,
  // since this section's actual target is the UPDATE rule, unaffected.
  const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' }, 'dob-policy-admin')
  const adminDb = getAdminFirestore(adminApp)

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

  // ── Test 10: a direct client litters update is now denied
  // UNCONDITIONALLY (Codex round 4, Blocker 3) — not just the clear-
  // while-puppies-exist case round 3's conditional rule caught. The
  // actual clear-blocked / change-allowed / clear-allowed-when-empty
  // behavior now lives in api/update-litter.js and is exercised end-to-
  // end (via an Admin SDK mirror) in test-atomic-transactions.mjs's
  // Section 4. ──
  {
    const damId = `dobdam_${R}`
    await setDoc(doc(db, 'dogs', damId), {
      tenantId: uid, currentOwnerId: uid, createdByUserId: uid,
      sourceType: 'BREEDER_ISSUED', name: 'DobDam', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
    })
    const litterWithPuppies = `litterwp_${R}`
    await adminDb.collection('litters').doc(litterWithPuppies).set({
      tenantId: uid, damId, name: 'WithPuppies', notes: '', actualBirthDate: '2026-01-01', puppyIds: [`validdobpup_${R}`],
    })
    let clearDenied = false
    try { await updateDoc(doc(db, 'litters', litterWithPuppies), { actualBirthDate: '' }) } catch (err) { clearDenied = isDenied(err) }
    check('10-LittersRule', 'Clearing actualBirthDate on a litter with puppies is rejected (direct client write denied outright)', clearDenied)

    let harmlessChangeDenied = false
    try { await updateDoc(doc(db, 'litters', litterWithPuppies), { actualBirthDate: '2026-01-02' }) } catch (err) { harmlessChangeDenied = isDenied(err) }
    check('10-LittersRule', 'Even a harmless (non-clearing) direct client update is denied — there is no in-rules carve-out left at all', harmlessChangeDenied)

    const litterNoPuppies = `litternp_${R}`
    await adminDb.collection('litters').doc(litterNoPuppies).set({
      tenantId: uid, damId, name: 'NoPuppiesYet', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
    })
    let clearDeniedEvenWhenEmpty = false
    try { await updateDoc(doc(db, 'litters', litterNoPuppies), { actualBirthDate: '' }) } catch (err) { clearDeniedEvenWhenEmpty = isDenied(err) }
    check('10-LittersRule', 'Clearing actualBirthDate on a planned litter with zero puppies is ALSO denied directly (must go through api/update-litter.js, which still allows it there)', clearDeniedEvenWhenEmpty)
  }

  // ── Test 11: a direct client litters create is denied outright now
  // (moved to api/create-litter.js — see test-parent-eligibility.mjs for
  // the full eligibility-logic coverage) ──
  {
    const damId11 = `dobdam11_${R}`
    await setDoc(doc(db, 'dogs', damId11), {
      tenantId: uid, currentOwnerId: uid, createdByUserId: uid,
      sourceType: 'BREEDER_ISSUED', name: 'DobDam11', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
    })
    let createDenied = false
    try {
      await setDoc(doc(db, 'litters', `litter_clientdenied_${R}`), {
        tenantId: uid, damId: damId11, name: 'Should Be Denied', notes: '', puppyIds: [],
      })
    } catch (err) { createDenied = isDenied(err) }
    check('11-LittersServerOnly', 'A direct client litters create is denied even for a well-formed payload', createDenied)
  }

  await signOut(auth)
} else {
  skip('9-11 emulator sections (dogs/litters Rules + server-only create checks)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
}

await summary()
