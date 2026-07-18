// Emulator-only regression test for the SERVER-SIDE (Admin SDK) litter
// lifecycle endpoints introduced/hardened in Codex round 4:
// api/delete-litter.js (Blocker 3), api/create-litter-puppy.js
// (Blockers 3 + 4), api/update-litter.js (Blocker 3),
// api/remove-litter-puppy.js (Blocker 3), plus the remaining Blocker 5
// (ownership-history) checks not already covered in
// test-litter-delete-cleanup.mjs: previousOwnerId/transferredAt/
// claimedAt/claimedBy WITHOUT buyerEmail, history-field immutability,
// and direct deletion of a history-bearing Dog being denied outright.
//
// This file superseded an earlier version that mirrored the round-3
// CLIENT-side Firestore transactions those endpoints replaced — round 4,
// Blocker 3 requires firestore.rules to deny direct client litters
// update/delete unconditionally, so there is no client transaction left
// to test; every mirror function below replicates the real endpoint's
// ADMIN SDK transaction logic instead (bypasses Rules, exactly as the
// real endpoint does), same testing approach test-parent-eligibility.mjs
// already established for create-litter.js/save-heat-cycle.js.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-atomic-transactions.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, collection, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore, FieldValue as AdminFieldValue } from 'firebase-admin/firestore'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' })
const adminDb = getAdminFirestore(adminApp)

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}
function isDenied(err) {
  return err && (err.code === 'permission-denied' || /permission/i.test(err.message))
}
async function safeGetDoc(ref) {
  try { return await getDoc(ref) } catch (err) { if (isDenied(err)) return { exists: () => false }; throw err }
}

const PW = 'tam12345*'
const R = Date.now()
const email = n => `atomic.${n}.${R}@emulator.local`

async function newUser(name) {
  const { user } = await createUserWithEmailAndPassword(auth, email(name), PW)
  await signOut(auth)
  return user.uid
}
async function as(name) {
  await signOut(auth).catch(() => {})
  await signInWithEmailAndPassword(auth, email(name), PW)
}

// Mirrors api/_lib/litter-eligibility.js's partitionLitterCandidatesServer
// exactly, including claimedBy (Codex round 4, Blocker 5).
function partitionLitterCandidates(litterId, fetched, requesterUid) {
  const confirmedMembers = fetched.filter(d => d.litterId === litterId)
  const eligible = confirmedMembers.filter(d =>
    d.currentOwnerId === requesterUid &&
    d.status !== 'transferred' && d.transferStatus !== 'pendingClaim' &&
    !d.buyerEmail && !d.previousOwnerId && !d.transferredAt && !d.claimedAt && !d.claimedBy
  )
  return { confirmedMembers, eligible, preserved: confirmedMembers.length - eligible.length }
}

// Mirrors api/delete-litter.js's transaction exactly (Admin SDK).
async function deleteLitterServer(litterId, requesterUid) {
  const litterRef = adminDb.collection('litters').doc(litterId)
  return adminDb.runTransaction(async (tx) => {
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists) return { deletedCount: 0, notFound: true }
    const litter = litterSnap.data()
    if (litter.tenantId !== requesterUid) throw new Error('NOT_YOUR_LITTER')
    const puppyIds = litter.puppyIds || []
    const candidateSnaps = await Promise.all(puppyIds.map(id => tx.get(adminDb.collection('dogs').doc(id))))
    const fetched = candidateSnaps.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }))
    const { eligible, preserved } = partitionLitterCandidates(litterId, fetched, requesterUid)
    tx.delete(litterRef)
    for (const puppy of eligible) tx.delete(adminDb.collection('dogs').doc(puppy.id))
    return { deletedCount: eligible.length, preservedCount: preserved }
  })
}

// Mirrors api/update-litter.js's transaction exactly (Admin SDK).
async function updateLitterServer(litterId, patch, requesterUid) {
  const litterRef = adminDb.collection('litters').doc(litterId)
  return adminDb.runTransaction(async (tx) => {
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists) return { ok: false, reason: 'NOT_FOUND' }
    const litter = litterSnap.data()
    if (litter.tenantId !== requesterUid) return { ok: false, reason: 'NOT_YOURS' }
    const puppyIds = litter.puppyIds || []
    const hasPuppies = puppyIds.length > 0
    const dobChanged = Object.prototype.hasOwnProperty.call(patch, 'actualBirthDate') && patch.actualBirthDate !== (litter.actualBirthDate || '')
    if (dobChanged && hasPuppies && !patch.actualBirthDate) {
      return { ok: false, reason: 'CANNOT_CLEAR_WITH_PUPPIES' }
    }
    let updatedPuppyCount = 0
    if (dobChanged && patch.actualBirthDate && hasPuppies) {
      const candidateSnaps = await Promise.all(puppyIds.map(id => tx.get(adminDb.collection('dogs').doc(id))))
      const fetched = candidateSnaps.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }))
      const { eligible } = partitionLitterCandidates(litterId, fetched, requesterUid)
      for (const puppy of eligible) tx.update(adminDb.collection('dogs').doc(puppy.id), { dateOfBirth: patch.actualBirthDate })
      updatedPuppyCount = eligible.length
    }
    tx.update(litterRef, patch)
    return { ok: true, updatedPuppyCount }
  })
}

// Mirrors api/remove-litter-puppy.js's transaction exactly (Admin SDK).
async function removeLitterPuppyServer(litterId, puppyId, requesterUid) {
  const litterRef = adminDb.collection('litters').doc(litterId)
  const dogRef = adminDb.collection('dogs').doc(puppyId)
  return adminDb.runTransaction(async (tx) => {
    const litterSnap = await tx.get(litterRef)
    const dogSnap = await tx.get(dogRef)
    if (!litterSnap.exists) return { ok: false, reason: 'NOT_FOUND' }
    if (litterSnap.data().tenantId !== requesterUid) return { ok: false, reason: 'NOT_YOURS' }
    if (dogSnap.exists && dogSnap.data().litterId !== litterId) return { ok: false, reason: 'NOT_CONFIRMED_MEMBER' }
    tx.update(litterRef, { puppyIds: AdminFieldValue.arrayRemove(puppyId) })
    return { ok: true }
  })
}

const PAYLOAD_FIELDS = ['name', 'breed', 'sex', 'dateOfBirth', 'colour', 'microchip', 'ankc', 'notes']
function payloadsMatch(a, b) {
  if (!a || !b) return false
  return PAYLOAD_FIELDS.every(f => String(a[f] ?? '') === String(b[f] ?? ''))
}

// Mirrors api/create-litter-puppy.js's transaction exactly (Admin SDK),
// minus the passport-id-collision retry loop (orthogonal to what these
// tests exercise — the create-vs-collision loop itself is unchanged from
// round 3 and structurally covered elsewhere). Codex round 4, Blocker 4:
// an existing dogId is never trusted alone — every retry is checked
// against a persisted litterPuppyOperations/{operationId} record.
async function createLitterPuppyServer({ operationId, litterId, dogId, payload, requesterUid, passportIdOverride }) {
  const dogRef = adminDb.collection('dogs').doc(dogId)
  const litterRef = adminDb.collection('litters').doc(litterId)
  const operationRef = adminDb.collection('litterPuppyOperations').doc(operationId)
  const candidate = passportIdOverride || `PUP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const reservationRef = adminDb.collection('passportReservations').doc(candidate)

  return adminDb.runTransaction(async (tx) => {
    const opSnap = await tx.get(operationRef)
    if (opSnap.exists) {
      const op = opSnap.data()
      if (op.tenantId !== requesterUid) return { ok: false, reason: 'OPERATION_TENANT_MISMATCH' }
      if (op.litterId !== litterId) return { ok: false, reason: 'OPERATION_LITTER_MISMATCH' }
      if (op.dogId !== dogId) return { ok: false, reason: 'OPERATION_DOG_MISMATCH' }
      if (!payloadsMatch(op.payload, payload)) return { ok: false, reason: 'OPERATION_PAYLOAD_MISMATCH' }

      const dogSnap = await tx.get(dogRef)
      if (!dogSnap.exists) return { ok: false, reason: 'DOG_MISSING' }
      const dog = dogSnap.data()
      if (dog.litterId !== litterId || dog.tenantId !== requesterUid || dog.currentOwnerId !== requesterUid) {
        return { ok: false, reason: 'DOG_STATE_MISMATCH' }
      }
      const reservationSnap = await tx.get(adminDb.collection('passportReservations').doc(dog.passportId))
      if (!reservationSnap.exists || reservationSnap.data().createdBy !== requesterUid) {
        return { ok: false, reason: 'RESERVATION_MISMATCH' }
      }
      const litterSnap = await tx.get(litterRef)
      if (litterSnap.exists && !(litterSnap.data().puppyIds || []).includes(dogId)) {
        tx.update(litterRef, { puppyIds: AdminFieldValue.arrayUnion(dogId) })
      }
      return { ok: true, alreadyExisted: true, dogId, passportId: dog.passportId }
    }

    const dogSnap = await tx.get(dogRef)
    if (dogSnap.exists) return { ok: false, reason: 'DOG_ID_COLLISION' }
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists) return { ok: false, reason: 'LITTER_NOT_FOUND' }
    if (litterSnap.data().tenantId !== requesterUid) return { ok: false, reason: 'NOT_YOUR_LITTER' }
    const reservationSnap = await tx.get(reservationRef)
    if (reservationSnap.exists) return { ok: false, reason: 'PASSPORT_ID_TAKEN' }

    tx.set(reservationRef, { createdAt: new Date().toISOString(), createdBy: requesterUid })
    tx.set(dogRef, {
      ...PAYLOAD_FIELDS.reduce((acc, f) => ({ ...acc, [f]: payload[f] ?? '' }), {}),
      tenantId: requesterUid, currentOwnerId: requesterUid, createdByUserId: requesterUid,
      sourceType: 'BREEDER_ISSUED', passportId: candidate, litterId, isDeceased: false, status: 'active',
    })
    tx.set(operationRef, {
      tenantId: requesterUid, litterId, dogId,
      payload: PAYLOAD_FIELDS.reduce((acc, f) => ({ ...acc, [f]: payload[f] ?? '' }), {}),
      status: 'completed', createdAt: new Date().toISOString(),
    })
    tx.update(litterRef, { puppyIds: AdminFieldValue.arrayUnion(dogId) })
    return { ok: true, alreadyExisted: false, dogId, passportId: candidate }
  })
}

const breederUid = await newUser('breeder')

// =========================================================================
// SECTION 1 — delete-litter.js: reads live state at execution time, never
// a stale pre-fetch. The Dam/puppy transfer completes BEFORE the server
// transaction runs at all.
// =========================================================================
{
  await as('breeder')
  const damId = `dam1_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam1', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter1_${R}`
  const pupId = `pup1_${R}`
  await setDoc(doc(db, 'dogs', pupId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Pup1', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter1', notes: '', actualBirthDate: '2026-01-01', puppyIds: [pupId],
  })

  const buyerUid1 = await newUser('buyer1')
  await as('breeder') // newUser() signs out after creating — re-sign-in before any further client reads
  await adminDb.collection('dogs').doc(pupId).update({ currentOwnerId: buyerUid1, status: 'active' })

  const outcome = await deleteLitterServer(litterId, breederUid)
  check('1-FreshRead', 'The transaction excludes the already-transferred puppy (reads live state, not a stale snapshot)', outcome.deletedCount === 0)
  const pupStillThere = await safeGetDoc(doc(db, 'dogs', pupId))
  check('1-FreshRead', 'The transferred puppy survives with its new owner intact', pupStillThere.exists() && pupStillThere.data().currentOwnerId === buyerUid1)
  const litterGone = await safeGetDoc(doc(db, 'litters', litterId))
  check('1-FreshRead', 'The litter itself is still deleted (only the puppy is preserved)', !litterGone.exists())
}

// =========================================================================
// SECTION 2 — delete-litter.js: a puppy linked AFTER the litter was first
// loaded but BEFORE the delete request runs must still be picked up, and
// a direct client litters delete is denied outright (Codex round 4,
// Blocker 3).
// =========================================================================
{
  await as('breeder')
  const damId = `dam2_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam2', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter2_${R}`
  const pupIdA = `pupA2_${R}`
  await setDoc(doc(db, 'dogs', pupIdA), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'PupA2', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter2', notes: '', actualBirthDate: '2026-01-01', puppyIds: [pupIdA],
  })
  const pupIdB = `pupB2_${R}`
  await setDoc(doc(db, 'dogs', pupIdB), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'PupB2', sex: 'female', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('litters').doc(litterId).update({ puppyIds: AdminFieldValue.arrayUnion(pupIdB) })

  let clientDeleteDenied = false
  try { await deleteDoc(doc(db, 'litters', litterId)) } catch (err) { clientDeleteDenied = isDenied(err) }
  check('2-NoOrphan', 'A direct client litters delete is denied outright', clientDeleteDenied)

  const outcome = await deleteLitterServer(litterId, breederUid)
  check('2-NoOrphan', 'Both the original and newly-linked puppy were deleted together with the litter (no orphan left behind)', outcome.deletedCount === 2)
  const pupAGone = await safeGetDoc(doc(db, 'dogs', pupIdA))
  const pupBGone = await safeGetDoc(doc(db, 'dogs', pupIdB))
  check('2-NoOrphan', 'Neither puppy survives as an orphan referencing a deleted litter', !pupAGone.exists() && !pupBGone.exists())
}

// =========================================================================
// SECTION 3 — create-litter-puppy.js idempotency matrix (Codex round 4,
// Blocker 4): an existing dogId alone is never trusted as proof of a
// valid retry; every one of the listed mismatch cases fails WITH NO
// WRITES, and a genuinely matching retry (including a same-request
// "concurrent" retry) resolves idempotently.
// =========================================================================
{
  await as('breeder')
  const damId = `dam3_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam3', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter3_${R}`
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter3', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
  })
  const otherLitterId = `litter3other_${R}`
  await adminDb.collection('litters').doc(otherLitterId).set({
    tenantId: breederUid, damId, name: 'Litter3Other', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
  })

  const payload = { name: 'RetryPup', breed: 'Poodle', sex: 'male', dateOfBirth: '2026-01-01', colour: '', microchip: '', ankc: '', notes: '' }
  const opId = `op3_${R}`
  const pupId = `pup3_${R}`

  const first = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
  check('3-Idempotent', 'First creation reports ok + alreadyExisted: false', first.ok === true && first.alreadyExisted === false)

  // Genuine matching retry — same operationId, dogId, litterId, payload.
  const retry = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
  check('3-Idempotent', 'Retry with everything matching reports alreadyExisted: true (no duplicate created)', retry.ok === true && retry.alreadyExisted === true)
  const litterSnap = await getDoc(doc(db, 'litters', litterId))
  check('3-Idempotent', 'The litter\'s puppyIds contains the dog exactly once, not twice', (litterSnap.data().puppyIds || []).filter(id => id === pupId).length === 1)

  // "Concurrent" retry — a second call with the identical request,
  // simulating two near-simultaneous submissions of the same operation.
  const concurrentRetry = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
  check('3-Idempotent', 'A concurrent/repeated retry of the exact same operation also resolves idempotently', concurrentRetry.ok === true && concurrentRetry.alreadyExisted === true)

  // Unrelated same-owner Dog: a dogId that already exists (created via a
  // completely different, unrelated operation) with NO matching
  // operation record for THIS operationId must never be silently reused.
  const unrelatedDogId = `pup3unrelated_${R}`
  await setDoc(doc(db, 'dogs', unrelatedDogId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'UnrelatedDog', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
  })
  const collisionAttempt = await createLitterPuppyServer({ operationId: `op3_new_${R}`, litterId, dogId: unrelatedDogId, payload, requesterUid: breederUid })
  check('3-Idempotent', 'An existing dogId with no matching operation record fails closed (DOG_ID_COLLISION), never silently reused', collisionAttempt.ok === false && collisionAttempt.reason === 'DOG_ID_COLLISION')
  const unrelatedDogAfter = await getDoc(doc(db, 'dogs', unrelatedDogId))
  check('3-Idempotent', 'The unrelated dog was not mutated by the failed collision attempt', unrelatedDogAfter.data().litterId === undefined)

  // Conflicting litter: same operationId + dogId, but a different litterId.
  const conflictingLitter = await createLitterPuppyServer({ operationId: opId, litterId: otherLitterId, dogId: pupId, payload, requesterUid: breederUid })
  check('3-Idempotent', 'A retry claiming a different litterId for the same operation fails closed (OPERATION_LITTER_MISMATCH)', conflictingLitter.ok === false && conflictingLitter.reason === 'OPERATION_LITTER_MISMATCH')

  // Payload mismatch: same operationId + dogId + litterId, different payload.
  const payloadMismatch = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload: { ...payload, name: 'DifferentName' }, requesterUid: breederUid })
  check('3-Idempotent', 'A retry with a mutated payload fails closed (OPERATION_PAYLOAD_MISMATCH)', payloadMismatch.ok === false && payloadMismatch.reason === 'OPERATION_PAYLOAD_MISMATCH')

  // Passport mismatch: the real Dog's passportId reservation is deleted/
  // reassigned to a different creator — the retry must fail closed
  // rather than trust the Dog document alone.
  const dogSnapForPassport = await getDoc(doc(db, 'dogs', pupId))
  const realPassportId = dogSnapForPassport.data().passportId
  await adminDb.collection('passportReservations').doc(realPassportId).delete()
  const otherUid = await newUser('otherforpassport')
  await as('breeder') // newUser() signs out after creating — re-sign-in before any further client reads
  await adminDb.collection('passportReservations').doc(realPassportId).set({ createdAt: new Date().toISOString(), createdBy: otherUid })
  const passportMismatch = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
  check('3-Idempotent', 'A retry whose Dog\'s passport reservation no longer matches this uid fails closed (RESERVATION_MISMATCH)', passportMismatch.ok === false && passportMismatch.reason === 'RESERVATION_MISMATCH')

  // A genuinely different dogId (a separate, concurrent puppy
  // submission) must still succeed and coexist correctly.
  const pupId2 = `pup3b_${R}`
  const opId2 = `op3b_${R}`
  const second = await createLitterPuppyServer({ operationId: opId2, litterId, dogId: pupId2, payload: { ...payload, name: 'SecondPup', sex: 'female' }, requesterUid: breederUid })
  check('3-Idempotent', 'A genuinely different concurrent puppy submission succeeds independently', second.ok === true && second.alreadyExisted === false)
  const litterSnap2 = await getDoc(doc(db, 'litters', litterId))
  check('3-Idempotent', 'Both distinct puppies end up linked', (litterSnap2.data().puppyIds || []).includes(pupId) && litterSnap2.data().puppyIds.includes(pupId2))

  // Wrong tenant: a different user's uid attempting to resume someone
  // else's operation record fails closed.
  const strangerUid = await newUser('stranger3')
  const tenantMismatch = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: strangerUid })
  check('3-Idempotent', 'A different tenant attempting to resume this operation fails closed (OPERATION_TENANT_MISMATCH)', tenantMismatch.ok === false && tenantMismatch.reason === 'OPERATION_TENANT_MISMATCH')
}

// =========================================================================
// SECTION 4 — update-litter.js: DOB-clear blocked while puppies exist,
// DOB-change propagates only to still-eligible puppies, and a direct
// client litters update is denied outright (Codex round 4, Blocker 3).
// =========================================================================
{
  await as('breeder')
  const damId = `dam4_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam4', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter4u_${R}`
  const ownedPupId = `pup4owned_${R}`
  const transferredPupId = `pup4transferred_${R}`
  await setDoc(doc(db, 'dogs', ownedPupId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'OwnedPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  const buyerUid4 = await newUser('buyer4')
  await as('breeder') // newUser() signs out after creating — re-sign-in before any further client operations
  // currentOwnerId != the signed-in client user, so this fixture must be
  // written via the Admin SDK (client dogs.create rule requires
  // currentOwnerId == request.auth.uid, which a real transfer flow never
  // violates — this is a fixture-setup constraint, not a product one).
  await adminDb.collection('dogs').doc(transferredPupId).set({
    tenantId: breederUid, currentOwnerId: buyerUid4, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'TransferredPup', sex: 'female', status: 'transferred', dateOfBirth: '2026-01-01', litterId,
    buyerEmail: 'buyer4@example.com',
  })
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter4', notes: '', actualBirthDate: '2026-01-01', puppyIds: [ownedPupId, transferredPupId],
  })

  const clearAttempt = await updateLitterServer(litterId, { actualBirthDate: '' }, breederUid)
  check('4-UpdateLitter', 'Clearing actualBirthDate while puppies exist fails closed', clearAttempt.ok === false && clearAttempt.reason === 'CANNOT_CLEAR_WITH_PUPPIES')

  const changeAttempt = await updateLitterServer(litterId, { actualBirthDate: '2026-02-01' }, breederUid)
  check('4-UpdateLitter', 'Changing actualBirthDate succeeds', changeAttempt.ok === true)
  check('4-UpdateLitter', 'Exactly one still-owned puppy had its DOB propagated', changeAttempt.updatedPuppyCount === 1)
  const ownedAfter = await getDoc(doc(db, 'dogs', ownedPupId))
  const transferredAfter = await getDoc(doc(db, 'dogs', transferredPupId))
  check('4-UpdateLitter', 'The still-owned puppy\'s DOB was updated', ownedAfter.data().dateOfBirth === '2026-02-01')
  check('4-UpdateLitter', 'The transferred puppy\'s DOB was NOT touched', transferredAfter.data().dateOfBirth === '2026-01-01')

  let clientUpdateDenied = false
  try { await updateDoc(doc(db, 'litters', litterId), { name: 'Hacked directly' }) } catch (err) { clientUpdateDenied = isDenied(err) }
  check('4-UpdateLitter', 'A direct client litters update is denied outright, even a harmless field', clientUpdateDenied)
}

// =========================================================================
// SECTION 5 — remove-litter-puppy.js: confirmed membership required, and
// a direct client puppyIds mutation is denied outright (Codex round 4,
// Blocker 3 — this is the exact bypass named in the task: "directly
// changing puppyIds").
// =========================================================================
{
  await as('breeder')
  const damId = `dam5_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam5', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter5_${R}`
  const memberPupId = `pup5member_${R}`
  await setDoc(doc(db, 'dogs', memberPupId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'MemberPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  // A dog that is NOT actually a confirmed member of this litter (its
  // own litterId disagrees), even though someone could try to pass its
  // id to this endpoint.
  const otherLitterId5 = `litter5other_${R}`
  const nonMemberPupId = `pup5nonmember_${R}`
  await setDoc(doc(db, 'dogs', nonMemberPupId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'NonMemberPup', sex: 'female', status: 'active', dateOfBirth: '2026-01-01', litterId: otherLitterId5,
  })
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter5', notes: '', actualBirthDate: '2026-01-01', puppyIds: [memberPupId, nonMemberPupId],
  })

  const nonMemberAttempt = await removeLitterPuppyServer(litterId, nonMemberPupId, breederUid)
  check('5-RemovePuppy', 'Removing a dog whose own litterId disagrees fails closed (NOT_CONFIRMED_MEMBER)', nonMemberAttempt.ok === false && nonMemberAttempt.reason === 'NOT_CONFIRMED_MEMBER')

  const memberAttempt = await removeLitterPuppyServer(litterId, memberPupId, breederUid)
  check('5-RemovePuppy', 'Removing a confirmed member succeeds', memberAttempt.ok === true)
  const litterAfter = await getDoc(doc(db, 'litters', litterId))
  check('5-RemovePuppy', 'The confirmed member is unlinked from puppyIds', !(litterAfter.data().puppyIds || []).includes(memberPupId))
  check('5-RemovePuppy', 'The unlinked puppy Dog document itself still exists (unlink, not delete)', (await getDoc(doc(db, 'dogs', memberPupId))).exists())

  let clientMutationDenied = false
  try { await updateDoc(doc(db, 'litters', litterId), { puppyIds: [] }) } catch (err) { clientMutationDenied = isDenied(err) }
  check('5-RemovePuppy', 'A direct client puppyIds mutation is denied outright', clientMutationDenied)
}

// =========================================================================
// SECTION 6 — previousOwnerId / transferredAt / claimedAt / claimedBy
// WITHOUT buyerEmail each independently block litter-delete eligibility —
// not "buyerEmail is the one signal that matters" (Codex round 4,
// Blocker 5). claimedBy ALONE (no claimedAt) must also block.
// =========================================================================
{
  await as('breeder')
  const damId = `dam6_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam6', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter6_${R}`

  const prevOwnerOnlyId = `prevowneronly_${R}`
  const transferredAtOnlyId = `transferredatonly_${R}`
  const claimedAtOnlyId = `claimedatonly_${R}`
  const claimedByOnlyId = `claimedbyonly_${R}`
  for (const [id, extra] of [
    [prevOwnerOnlyId, { previousOwnerId: 'some-former-owner-uid' }],
    [transferredAtOnlyId, { transferredAt: '2026-01-01T00:00:00.000Z' }],
    [claimedAtOnlyId, { claimedAt: '2026-01-02T00:00:00.000Z' }],
    [claimedByOnlyId, { claimedBy: 'some-buyer-uid' }],
  ]) {
    await setDoc(doc(db, 'dogs', id), {
      tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
      sourceType: 'BREEDER_ISSUED', name: id, sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
      ...extra,
    })
  }
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter6', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [prevOwnerOnlyId, transferredAtOnlyId, claimedAtOnlyId, claimedByOnlyId],
  })

  const litterSnap = await getDoc(doc(db, 'litters', litterId))
  const candidateSnaps = await Promise.all((litterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const fetched = candidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { eligible, preserved } = partitionLitterCandidates(litterId, fetched, breederUid)
  check('6-HistorySignals', 'previousOwnerId alone (no buyerEmail) blocks eligibility', !eligible.some(d => d.id === prevOwnerOnlyId))
  check('6-HistorySignals', 'transferredAt alone (no buyerEmail) blocks eligibility', !eligible.some(d => d.id === transferredAtOnlyId))
  check('6-HistorySignals', 'claimedAt alone (no buyerEmail) blocks eligibility', !eligible.some(d => d.id === claimedAtOnlyId))
  check('6-HistorySignals', 'claimedBy ALONE (no claimedAt, no buyerEmail) blocks eligibility', !eligible.some(d => d.id === claimedByOnlyId))
  check('6-HistorySignals', 'All four are counted as preserved', preserved === 4)

  // The same signals, run through the REAL delete-litter.js mirror end
  // to end, confirm the litter deletes but every history-bearing puppy
  // survives.
  const outcome = await deleteLitterServer(litterId, breederUid)
  check('6-HistorySignals', 'delete-litter.js preserves all four history-bearing puppies', outcome.deletedCount === 0 && outcome.preservedCount === 4)
}

// =========================================================================
// SECTION 7 — history-field immutability: once set, buyerEmail/
// previousOwnerId/transferredAt/claimedAt/claimedBy can never be cleared
// or changed by a client update (dogs update rule) — the FIRST write
// (setting them) remains allowed.
// =========================================================================
{
  await as('breeder')
  const dogId = `historyimmutable_${R}`
  await setDoc(doc(db, 'dogs', dogId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'HistoryImmutable', sex: 'male', status: 'active', dateOfBirth: '2020-01-01',
  })

  let firstWriteOk = true
  try {
    await updateDoc(doc(db, 'dogs', dogId), {
      status: 'transferred', transferStatus: 'pendingClaim',
      buyerEmail: 'buyer@example.com', buyerName: 'Buyer', transferredAt: '2026-01-01T00:00:00.000Z', previousOwnerId: breederUid,
    })
  } catch { firstWriteOk = false }
  check('7-HistoryImmutable', 'The FIRST write of history fields (a real transfer) is allowed', firstWriteOk)

  let clearBuyerEmailDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { buyerEmail: 'different@example.com' }) } catch (err) { clearBuyerEmailDenied = isDenied(err) }
  check('7-HistoryImmutable', 'Changing an already-set buyerEmail is denied', clearBuyerEmailDenied)

  let clearTransferredAtDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { transferredAt: '2099-01-01T00:00:00.000Z' }) } catch (err) { clearTransferredAtDenied = isDenied(err) }
  check('7-HistoryImmutable', 'Changing an already-set transferredAt is denied', clearTransferredAtDenied)

  let clearPreviousOwnerDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { previousOwnerId: 'someone-else' }) } catch (err) { clearPreviousOwnerDenied = isDenied(err) }
  check('7-HistoryImmutable', 'Changing an already-set previousOwnerId is denied', clearPreviousOwnerDenied)
}

// =========================================================================
// SECTION 8 — direct deletion of a history-bearing Dog is denied outright
// (Codex round 4, Blocker 5) — not just a dog currently mid-transfer.
// Each of the five history fields, alone, must independently block a
// direct client dogs.delete, even when currentOwnerId/status/
// transferStatus all look "clean".
// =========================================================================
{
  await as('breeder')
  const cases = [
    ['buyerEmail', { buyerEmail: 'buyer8@example.com' }],
    ['previousOwnerId', { previousOwnerId: 'former-owner-uid' }],
    ['transferredAt', { transferredAt: '2026-01-01T00:00:00.000Z' }],
    ['claimedAt', { claimedAt: '2026-01-02T00:00:00.000Z' }],
    ['claimedBy', { claimedBy: 'buyer-uid-8' }],
  ]
  for (const [label, extra] of cases) {
    const dogId = `historydelete_${label}_${R}`
    await setDoc(doc(db, 'dogs', dogId), {
      tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
      sourceType: 'BREEDER_ISSUED', name: dogId, sex: 'male', status: 'active', dateOfBirth: '2020-01-01',
      ...extra,
    })
    let deleteDenied = false
    try { await deleteDoc(doc(db, 'dogs', dogId)) } catch (err) { deleteDenied = isDenied(err) }
    check('8-HistoryDeleteDenied', `A dog with ONLY ${label} set (status/currentOwnerId otherwise clean) cannot be deleted directly`, deleteDenied)
  }

  // Sanity check: a dog with ZERO history fields (the common case) still
  // deletes exactly as before — this hardening must not be overbroad.
  const cleanDogId = `historydelete_clean_${R}`
  await setDoc(doc(db, 'dogs', cleanDogId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'CleanDog', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  let cleanDeleteOk = true
  try { await deleteDoc(doc(db, 'dogs', cleanDogId)) } catch { cleanDeleteOk = false }
  check('8-HistoryDeleteDenied', 'A dog with no ownership history at all still deletes normally', cleanDeleteOk)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
