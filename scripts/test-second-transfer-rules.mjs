// scripts/test-second-transfer-rules.mjs — Hotfix regression coverage for
// the "claimed owner cannot re-transfer" production incident (Honey,
// idogsbreeder@gmail.com -> trunghieungo@gmail.com).
//
// CONFIRMED PRODUCTION INCIDENT this exists for: after a dog completes its
// first transfer+claim, buyerEmail/buyerName/transferredAt/previousOwnerId
// remain set forever as permanent provenance (api/claim-transferred-dogs.js
// deliberately never clears them). The pre-hotfix firestore.rules made
// those four fields immutable once set, at ALL — so transferDogOwnership()
// (src/lib/db.ts), which must write NEW values into those exact fields to
// start any second-or-later transfer, was denied with permission-denied
// every single time, even when initiated by the genuine, currently-claimed
// owner. This affected every claimed dog universally, not any one shape.
//
// The fix (firestore.rules: isLegitimateNewTransferTransition() /
// dogTransferProvenanceValid()) recognizes the EXACT shape
// transferDogOwnership() always writes and allows exactly that shape
// through, while continuing to deny isolated edits, spoofed provenance,
// and malformed/partial transitions.
//
// Every fixture here is seeded via the Admin SDK (bypasses rules) so a
// dog can be placed in a specific mid-lifecycle shape (already-transferred-
// once, already-claimed) without depending on the client rules under test
// to construct that shape — matching the established pattern in
// test-dog-update-legacy-rules.mjs and test-dog-ownership-matrix.mjs.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-second-transfer-rules.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, updateDoc } from 'firebase/firestore'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' })
const adminDb = getAdminFirestore(adminApp)
async function seedDog(dogId, data) {
  await adminDb.collection('dogs').doc(dogId).set(data)
}
// Mirrors api/claim-transferred-dogs.js's ACTUAL production write shape
// exactly (not a simplified stand-in) — currentOwnerId reassigned, status
// reset to active, transferStatus deleted, claimedAt/claimedBy set.
async function simulateRealClaim(dogId, newOwnerUid) {
  const { FieldValue } = await import('firebase-admin/firestore')
  await adminDb.collection('dogs').doc(dogId).update({
    currentOwnerId: newOwnerUid,
    status: 'active',
    transferStatus: FieldValue.delete(),
    claimedAt: new Date().toISOString(),
    claimedBy: newOwnerUid,
  })
}

import { makeChecker } from './_lib/test-check.mjs'
const { check, summary } = makeChecker()
function isDenied(err) {
  return err && (err.code === 'permission-denied' || /permission/i.test(err.message))
}

const PW = 'tam12345*'
const R = Date.now()
const email = n => `retransfer.${n}.${R}@emulator.local`

async function newUser(name) {
  const { user } = await createUserWithEmailAndPassword(auth, email(name), PW)
  await signOut(auth)
  return user.uid
}
async function as(name) {
  await signOut(auth).catch(() => {})
  await signInWithEmailAndPassword(auth, email(name), PW)
}

const ownerA = await newUser('ownerA')
const ownerB = await newUser('ownerB')
const ownerC = await newUser('ownerC')
const stranger = await newUser('stranger')

// The exact real write shape transferDogOwnership() produces (src/lib/db.ts).
function transferWrite(callerUid, buyerEmail, buyerName) {
  return {
    status: 'transferred',
    transferStatus: 'pendingClaim',
    previousOwnerId: callerUid,
    buyerName,
    buyerEmail,
    transferredAt: new Date().toISOString(),
  }
}

// =========================================================================
// SECTION 1 — full chain, modern breeder-issued dog: transfer -> claim ->
// SECOND transfer -> claim -> THIRD transfer. This is the exact shape of
// the confirmed production incident and its resolution.
// =========================================================================
{
  const dogId = `chain_modern_${R}`
  await seedDog(dogId, {
    name: 'ChainDog', status: 'active', dateOfBirth: '2020-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'BREEDER_ISSUED',
  })

  // First transfer (A -> B) — must still succeed (pre-existing behavior).
  await as('ownerA')
  let firstOk = true
  try { await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B')) } catch { firstOk = false }
  check('1-Chain', 'First transfer (A -> B) succeeds', firstOk)

  await simulateRealClaim(dogId, ownerB)

  // SECOND transfer (B -> C) — this is the exact bug: must now succeed.
  await as('ownerB')
  let secondOk = true
  try { await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerB, email('ownerC'), 'Owner C')) } catch (err) { secondOk = false; console.log('  second transfer error:', err.code) }
  check('1-Chain', 'SECOND transfer (B -> C, the confirmed production bug) now succeeds', secondOk)

  const afterSecond = (await adminDb.collection('dogs').doc(dogId).get()).data()
  check('1-Chain', 'After second transfer: buyerEmail updated to the new buyer', afterSecond.buyerEmail === email('ownerC'))
  check('1-Chain', 'After second transfer: previousOwnerId updated to B (the seller of THIS transfer)', afterSecond.previousOwnerId === ownerB)
  check('1-Chain', 'After second transfer: currentOwnerId still B (unchanged until C claims)', afterSecond.currentOwnerId === ownerB)

  await simulateRealClaim(dogId, ownerC)

  // THIRD transfer (C -> A) — proves the fix isn't a one-time unlock.
  await as('ownerC')
  let thirdOk = true
  try { await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerC, email('ownerA'), 'Owner A')) } catch { thirdOk = false }
  check('1-Chain', 'THIRD transfer (C -> A) also succeeds — not a one-time unlock', thirdOk)
}

// =========================================================================
// SECTION 2 — same chain (transfer -> claim -> second transfer) for a
// Round 20 legacy-shape dog (missing createdByUserId/sourceType, no
// currentOwnerId until claimed — the true pre-currentOwnerId-era shape).
// =========================================================================
{
  const dogId = `chain_legacy_${R}`
  await seedDog(dogId, {
    name: 'LegacyChainDog', status: 'active', dateOfBirth: '2019-01-01',
    tenantId: ownerA,
    // currentOwnerId, createdByUserId, sourceType all intentionally absent
    // — genuinely ancient shape, ownership falls back to tenantId.
  })

  await as('ownerA')
  let firstOk = true
  try { await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B')) } catch (err) { firstOk = false; console.log('  legacy first transfer error:', err.code) }
  check('2-LegacyChain', 'Legacy dog (no currentOwnerId/createdByUserId/sourceType): first transfer succeeds', firstOk)

  await simulateRealClaim(dogId, ownerB)

  await as('ownerB')
  let secondOk = true
  try { await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerB, email('ownerC'), 'Owner C')) } catch { secondOk = false }
  check('2-LegacyChain', 'Legacy dog: SECOND transfer (post-claim, now has currentOwnerId) succeeds', secondOk)
}

// =========================================================================
// SECTION 3 — same chain for an owner-created dog.
// =========================================================================
{
  const dogId = `chain_ownercreated_${R}`
  await seedDog(dogId, {
    name: 'OwnerCreatedChainDog', status: 'active', dateOfBirth: '2021-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'OWNER_CREATED',
  })

  await as('ownerA')
  let firstOk = true
  try { await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B')) } catch { firstOk = false }
  check('3-OwnerCreatedChain', 'Owner-created dog: first transfer succeeds', firstOk)

  await simulateRealClaim(dogId, ownerB)

  await as('ownerB')
  let secondOk = true
  try { await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerB, email('ownerC'), 'Owner C')) } catch { secondOk = false }
  check('3-OwnerCreatedChain', 'Owner-created dog: SECOND transfer succeeds', secondOk)
}

// =========================================================================
// SECTION 4 — wrong owner / stranger cannot transfer a claimed dog
// =========================================================================
{
  const dogId = `wrongowner_${R}`
  await seedDog(dogId, {
    name: 'WrongOwnerDog', status: 'active', dateOfBirth: '2020-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'BREEDER_ISSUED',
  })
  await as('ownerA')
  await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B'))
  await simulateRealClaim(dogId, ownerB)

  // Former owner (A, tenantId still matches, but currentOwnerId moved to B) tries to transfer again.
  await as('ownerA')
  let formerDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerC'), 'Owner C')) } catch (err) { formerDenied = isDenied(err) }
  check('4-WrongOwner', 'Former owner (no longer currentOwnerId) cannot start a new transfer', formerDenied)

  // Stranger tries.
  await as('stranger')
  let strangerDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), transferWrite(stranger, email('ownerC'), 'Owner C')) } catch (err) { strangerDenied = isDenied(err) }
  check('4-WrongOwner', 'Stranger cannot start a new transfer', strangerDenied)
}

// =========================================================================
// SECTION 5 — isolated edit of buyerEmail/buyerName/transferredAt/
// previousOwnerId (NOT a full valid transition) on an already-claimed dog
// is still denied — the fix must not open a general edit hole.
// =========================================================================
{
  const dogId = `isolatededit_${R}`
  await seedDog(dogId, {
    name: 'IsolatedEditDog', status: 'active', dateOfBirth: '2020-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'BREEDER_ISSUED',
  })
  await as('ownerA')
  await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B'))
  await simulateRealClaim(dogId, ownerB)

  await as('ownerB')
  let denied1 = false
  try { await updateDoc(doc(db, 'dogs', dogId), { buyerEmail: 'hacked@example.com' }) } catch (err) { denied1 = isDenied(err) }
  check('5-IsolatedEdit', 'Isolated buyerEmail-only edit (no full transition) is denied', denied1)

  let denied2 = false
  try { await updateDoc(doc(db, 'dogs', dogId), { previousOwnerId: stranger }) } catch (err) { denied2 = isDenied(err) }
  check('5-IsolatedEdit', 'Isolated previousOwnerId-only edit is denied', denied2)

  let denied3 = false
  try { await updateDoc(doc(db, 'dogs', dogId), { transferredAt: new Date().toISOString() }) } catch (err) { denied3 = isDenied(err) }
  check('5-IsolatedEdit', 'Isolated transferredAt-only edit is denied', denied3)
}

// =========================================================================
// SECTION 6 — spoofed previousOwnerId during an otherwise transition-
// shaped write is denied (must equal the CALLER's own uid, never anyone
// else's, even a plausible-looking one).
// =========================================================================
{
  const dogId = `spoofedprevowner_${R}`
  await seedDog(dogId, {
    name: 'SpoofDog', status: 'active', dateOfBirth: '2020-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'BREEDER_ISSUED',
  })
  await as('ownerA')
  await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B'))
  await simulateRealClaim(dogId, ownerB)

  await as('ownerB')
  let denied = false
  try {
    const write = transferWrite(ownerB, email('ownerC'), 'Owner C')
    write.previousOwnerId = stranger // spoofed — not the caller's own uid
    await updateDoc(doc(db, 'dogs', dogId), write)
  } catch (err) { denied = isDenied(err) }
  check('6-SpoofedPreviousOwner', 'previousOwnerId spoofed to someone other than the caller is denied', denied)
}

// =========================================================================
// SECTION 7 — currentOwnerId cannot be directly changed by the client,
// even smuggled inside an otherwise-valid transfer transition write.
// =========================================================================
{
  const dogId = `directownership_${R}`
  await seedDog(dogId, {
    name: 'DirectOwnershipDog', status: 'active', dateOfBirth: '2020-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'BREEDER_ISSUED',
  })
  await as('ownerA')
  await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B'))
  await simulateRealClaim(dogId, ownerB)

  await as('ownerB')
  let denied = false
  try {
    const write = transferWrite(ownerB, email('ownerC'), 'Owner C')
    write.currentOwnerId = stranger // genuine takeover attempt — a DIFFERENT uid, not a same-value no-op
    await updateDoc(doc(db, 'dogs', dogId), write)
  } catch (err) { denied = isDenied(err) }
  check('7-DirectOwnershipTakeover', 'currentOwnerId changed to a different uid inside an otherwise-valid transfer write is denied', denied)

  // Sanity check (not a security property): re-asserting the SAME
  // currentOwnerId value it already has is a no-op from Rules' own
  // diff().affectedKeys() perspective and correctly still succeeds — only
  // an actual VALUE change is a takeover attempt.
  let sameValueOk = true
  try {
    const write2 = transferWrite(ownerB, email('ownerC2'), 'Owner C2')
    write2.currentOwnerId = ownerB
    await updateDoc(doc(db, 'dogs', dogId), write2)
  } catch { sameValueOk = false }
  check('7-DirectOwnershipTakeover', 'Re-asserting the SAME currentOwnerId value (no actual change) still succeeds', sameValueOk)
}

// =========================================================================
// SECTION 8 — protected provenance fields (tenantId/createdByUserId/
// sourceType/originBreederId) remain immutable even during an otherwise-
// legitimate second transfer.
// =========================================================================
{
  const dogId = `protectedduringtransfer_${R}`
  await seedDog(dogId, {
    name: 'ProtectedDog', status: 'active', dateOfBirth: '2020-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'BREEDER_ISSUED', originBreederId: ownerA,
  })
  await as('ownerA')
  await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B'))
  await simulateRealClaim(dogId, ownerB)

  await as('ownerB')
  const attempts = [
    ['tenantId', stranger],
    ['createdByUserId', stranger],
    ['sourceType', 'OWNER_CREATED'],
    ['originBreederId', stranger],
  ]
  for (const [field, value] of attempts) {
    let denied = false
    try {
      const write = transferWrite(ownerB, email('ownerC'), 'Owner C')
      write[field] = value
      await updateDoc(doc(db, 'dogs', dogId), write)
    } catch (err) { denied = isDenied(err) }
    check('8-ProtectedDuringTransfer', `${field} cannot be changed even inside a legitimate transfer write`, denied)
  }
}

// =========================================================================
// SECTION 9 — malformed / partial transitions are denied
// =========================================================================
{
  const dogId = `malformed_${R}`
  await seedDog(dogId, {
    name: 'MalformedDog', status: 'active', dateOfBirth: '2020-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'BREEDER_ISSUED',
  })
  await as('ownerA')
  await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B'))
  await simulateRealClaim(dogId, ownerB)

  await as('ownerB')

  let denied1 = false
  try {
    const w = transferWrite(ownerB, email('ownerC'), 'Owner C')
    delete w.previousOwnerId // omit the required field
    await updateDoc(doc(db, 'dogs', dogId), w)
  } catch (err) { denied1 = isDenied(err) }
  check('9-Malformed', 'Transition missing previousOwnerId entirely is denied', denied1)

  let denied2 = false
  try {
    const w = transferWrite(ownerB, email('ownerC'), 'Owner C')
    w.buyerEmail = '' // empty string, not a genuine buyer email
    await updateDoc(doc(db, 'dogs', dogId), w)
  } catch (err) { denied2 = isDenied(err) }
  check('9-Malformed', 'Transition with an empty-string buyerEmail is denied', denied2)

  let denied3 = false
  try {
    const w = transferWrite(ownerB, email('ownerC'), 'Owner C')
    w.transferStatus = 'somethingElse' // not 'pendingClaim'
    await updateDoc(doc(db, 'dogs', dogId), w)
  } catch (err) { denied3 = isDenied(err) }
  check('9-Malformed', 'Transition with a non-"pendingClaim" transferStatus is denied', denied3)

  let denied4 = false
  try {
    // status changes but none of the buyer fields are present at all —
    // not a real transferDogOwnership()-shaped call.
    await updateDoc(doc(db, 'dogs', dogId), { status: 'transferred', transferStatus: 'pendingClaim' })
  } catch (err) { denied4 = isDenied(err) }
  check('9-Malformed', 'status/transferStatus flip with no buyer fields at all is denied', denied4)
}

// =========================================================================
// SECTION 10 — claimedAt/claimedBy remain flatly immutable (no legitimate
// client-side second-write path exists for them at all, unlike the other
// four fields).
// =========================================================================
{
  const dogId = `claimedatimmutable_${R}`
  await seedDog(dogId, {
    name: 'ClaimedAtDog', status: 'active', dateOfBirth: '2020-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'BREEDER_ISSUED',
  })
  await as('ownerA')
  await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B'))
  await simulateRealClaim(dogId, ownerB)

  await as('ownerB')
  let denied = false
  try {
    const w = transferWrite(ownerB, email('ownerC'), 'Owner C')
    w.claimedAt = new Date().toISOString() // attempting to also rewrite claimedAt
    await updateDoc(doc(db, 'dogs', dogId), w)
  } catch (err) { denied = isDenied(err) }
  check('10-ClaimedAtImmutable', 'claimedAt cannot be changed even inside an otherwise-valid transfer write', denied)
}

// =========================================================================
// SECTION 11 — ordinary unrelated-field update on a claimed dog still
// works normally (the fix must not require every update to look like a
// transfer transition).
// =========================================================================
{
  const dogId = `ordinaryupdate_${R}`
  await seedDog(dogId, {
    name: 'OrdinaryDog', status: 'active', dateOfBirth: '2020-01-01',
    tenantId: ownerA, currentOwnerId: ownerA, createdByUserId: ownerA, sourceType: 'BREEDER_ISSUED',
  })
  await as('ownerA')
  await updateDoc(doc(db, 'dogs', dogId), transferWrite(ownerA, email('ownerB'), 'Owner B'))
  await simulateRealClaim(dogId, ownerB)

  await as('ownerB')
  let ok = true
  try { await updateDoc(doc(db, 'dogs', dogId), { notes: 'a normal edit', weight: 22.5 }) } catch { ok = false }
  check('11-OrdinaryUpdate', 'Ordinary unrelated-field update on a claimed dog still succeeds', ok)
}

await summary()
