// Emulator-only regression test for the SERVER-SIDE (Admin SDK) litter
// lifecycle endpoints introduced/hardened in Codex rounds 4-5:
// api/delete-litter.js, api/create-litter-puppy.js, api/update-litter.js,
// api/remove-litter-puppy.js, plus the remaining Blocker 5 (ownership-
// history) checks not already covered in test-litter-delete-cleanup.mjs.
//
// Every mirror function below replicates the real endpoint's ADMIN SDK
// transaction logic (bypasses Rules, exactly as the real endpoint does),
// same testing approach test-parent-eligibility.mjs already established.
// The pure eligibility/membership functions (isDogSafeToDetach,
// resolveLitterMembership, partitionConfirmedMembers) are IMPORTED
// directly from api/_lib/litter-eligibility.js rather than re-mirrored —
// they have no Firebase dependency, so there's no reason to risk drift
// re-copying them.
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
import { isDogSafeToDetach, resolveLitterMembership, partitionConfirmedMembers } from '../api/_lib/litter-eligibility.js'
import { sanitizePuppyPayload, PuppyPayloadValidationError } from '../api/_lib/puppy-payload-schema.js'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' })
const adminDb = getAdminFirestore(adminApp)

let pass = 0, fail = 0
// Codex round 6 discovery (not one of the six assigned blockers, but
// found while updating this file's mirrors and fixed immediately —
// see the round-6 report's "additional finding" section): every call
// site in this file actually passes check(sectionLabel, description,
// condition) — a 3rd positional argument — but this function's
// signature was check(label, cond, extra), so `cond` was always bound
// to the DESCRIPTION STRING (permanently truthy for any non-empty
// text) and the REAL boolean was silently discarded into `extra`
// (only ever used in a FAIL message that could then never fire). Every
// check() in this file has therefore always reported PASS regardless
// of the actual condition, since this file was first written. Fixed by
// detecting the call shape at runtime — a string in the 2nd position
// with a 3rd argument present means the description+condition form;
// anything else falls back to the original 2-arg(+extra) form — rather
// than touching each of the 60 call sites individually.
function check(label, arg2, arg3, arg4) {
  let cond, extra
  if (typeof arg2 === 'string' && arg3 !== undefined) {
    label = `${label}: ${arg2}`
    cond = arg3
    extra = arg4 !== undefined ? arg4 : ''
  } else {
    cond = arg2
    extra = arg3 !== undefined ? arg3 : ''
  }
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

// Mirrors api/delete-litter.js's transaction exactly (Admin SDK).
// Codex round 5, Blocker 2: reads BOTH the forward (litter.puppyIds) and
// reverse (dogs where litterId==litterId) directions. Codex round 6,
// Blocker 1: hard-delete is now gated on BOTH preserved.length === 0
// AND reverseOnly.length === 0 — a reverse-only dog (found only via the
// litterId query, never touched) still needs the litter document to
// stay alive so its own litterId reference never dangles.
async function deleteLitterServer(litterId, requesterUid) {
  const litterRef = adminDb.collection('litters').doc(litterId)
  return adminDb.runTransaction(async (tx) => {
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists) return { deletedCount: 0, preservedCount: 0, ambiguousCount: 0, litterDeleted: false, litterArchived: false, notFound: true }
    const litter = litterSnap.data()
    if (litter.tenantId !== requesterUid) throw new Error('NOT_YOUR_LITTER')

    const puppyIds = litter.puppyIds || []
    const forwardSnaps = await Promise.all(puppyIds.map(id => tx.get(adminDb.collection('dogs').doc(id))))
    const forwardFetched = forwardSnaps.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }))
    const reverseQuerySnap = await tx.get(adminDb.collection('dogs').where('litterId', '==', litterId))
    const reverseFetched = reverseQuerySnap.docs.map(d => ({ id: d.id, ...d.data() }))

    const { confirmed, reverseOnly, ambiguousCount } = resolveLitterMembership(litterId, forwardFetched, reverseFetched)
    const { eligible, preserved } = partitionConfirmedMembers(confirmed, requesterUid)

    for (const puppy of eligible) tx.delete(adminDb.collection('dogs').doc(puppy.id))

    if (preserved.length === 0 && reverseOnly.length === 0) {
      tx.delete(litterRef)
      return { deletedCount: eligible.length, preservedCount: 0, ambiguousCount, litterDeleted: true, litterArchived: false }
    }
    tx.update(litterRef, { archived: true, archivedAt: new Date().toISOString(), puppyIds: preserved.map(d => d.id) })
    return { deletedCount: eligible.length, preservedCount: preserved.length, ambiguousCount, litterDeleted: false, litterArchived: true }
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
    if (litter.archived) return { ok: false, reason: 'LITTER_ARCHIVED' }
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
      const confirmedMembers = fetched.filter(d => d.litterId === litterId)
      const { eligible } = partitionConfirmedMembers(confirmedMembers, requesterUid)
      for (const puppy of eligible) tx.update(adminDb.collection('dogs').doc(puppy.id), { dateOfBirth: patch.actualBirthDate })
      updatedPuppyCount = eligible.length
    }
    tx.update(litterRef, patch)
    return { ok: true, updatedPuppyCount }
  })
}

// Mirrors api/remove-litter-puppy.js's transaction exactly (Admin SDK).
// Codex round 5, Blocker 1: rejects any Dog that isn't isDogSafeToDetach
// (transferred/pending-claim/claimed/history-bearing/not-controlled),
// and clears the Dog's own litterId in the SAME transaction as unlinking
// it from the litter (two-sided membership, never left one-sided).
// Codex round 6, Blocker 2: confirmed membership now requires BOTH
// dog.litterId === litterId (reverse) AND litter.puppyIds actually
// contains puppyId (forward) — reverse-only/forward-only/contradictory
// membership is rejected outright with zero writes.
async function removeLitterPuppyServer(litterId, puppyId, requesterUid) {
  const litterRef = adminDb.collection('litters').doc(litterId)
  const dogRef = adminDb.collection('dogs').doc(puppyId)
  return adminDb.runTransaction(async (tx) => {
    const litterSnap = await tx.get(litterRef)
    const dogSnap = await tx.get(dogRef)
    if (!litterSnap.exists) return { ok: false, reason: 'NOT_FOUND' }
    const litter = litterSnap.data()
    if (litter.tenantId !== requesterUid) return { ok: false, reason: 'NOT_YOURS' }
    if (litter.archived) return { ok: false, reason: 'LITTER_ARCHIVED' }
    if (!dogSnap.exists) {
      tx.update(litterRef, { puppyIds: AdminFieldValue.arrayRemove(puppyId) })
      return { ok: true }
    }
    const dog = dogSnap.data()
    const reverseConfirmed = dog.litterId === litterId
    const forwardConfirmed = (litter.puppyIds || []).includes(puppyId)
    if (!reverseConfirmed || !forwardConfirmed) return { ok: false, reason: 'NOT_CONFIRMED_MEMBER' }
    if (!isDogSafeToDetach(dog, requesterUid)) return { ok: false, reason: 'DOG_PROTECTED' }
    tx.update(litterRef, { puppyIds: AdminFieldValue.arrayRemove(puppyId) })
    tx.update(dogRef, { litterId: AdminFieldValue.delete() })
    return { ok: true }
  })
}

const PAYLOAD_FIELDS = ['name', 'breed', 'sex', 'dateOfBirth', 'colour', 'microchip', 'ankc', 'notes']
function fieldsMatch(a, b) {
  if (!a || !b) return false
  return PAYLOAD_FIELDS.every(f => String(a[f] ?? '') === String(b[f] ?? ''))
}

// Mirrors api/create-litter-puppy.js's transaction exactly (Admin SDK),
// minus the passport-id-collision retry loop (orthogonal to what these
// tests exercise). Codex round 5, Blocker 4: also compares the actual
// Dog document's CURRENT fields against the operation record (not just
// the record against the new request), and binds the Passport
// reservation to dogId+operationId, not just createdBy. Codex round 6,
// Blocker 4: `payload` is validated + normalized through the real
// sanitizePuppyPayload (imported directly, no re-mirroring — throws
// PuppyPayloadValidationError for a malformed/oversized/unknown-field
// payload, same as the real endpoint's 400). Codex round 6, Blocker 5:
// the retry path now REQUIRES the litter to exist / match tenant / not
// be archived, exactly as strictly as the fresh-creation path — a
// missing/wrong-tenant/archived litter fails closed with zero writes.
async function createLitterPuppyServer({ operationId, litterId, dogId, payload, requesterUid, passportIdOverride }) {
  const normalizedPayload = sanitizePuppyPayload(payload)
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
      if (!fieldsMatch(op.payload, normalizedPayload)) return { ok: false, reason: 'OPERATION_PAYLOAD_MISMATCH' }

      const dogSnap = await tx.get(dogRef)
      if (!dogSnap.exists) return { ok: false, reason: 'DOG_MISSING' }
      const dog = dogSnap.data()
      if (dog.litterId !== litterId || dog.tenantId !== requesterUid || dog.currentOwnerId !== requesterUid) {
        return { ok: false, reason: 'DOG_STATE_MISMATCH' }
      }
      if (!fieldsMatch(dog, op.payload)) return { ok: false, reason: 'DOG_FIELDS_MISMATCH' }
      const reservationSnap = await tx.get(adminDb.collection('passportReservations').doc(dog.passportId))
      if (!reservationSnap.exists) return { ok: false, reason: 'RESERVATION_MISMATCH' }
      const reservation = reservationSnap.data()
      if (reservation.createdBy !== requesterUid || reservation.dogId !== dogId || reservation.operationId !== operationId) {
        return { ok: false, reason: 'RESERVATION_MISMATCH' }
      }

      const litterSnap = await tx.get(litterRef)
      if (!litterSnap.exists) return { ok: false, reason: 'LITTER_NOT_FOUND' }
      const litter = litterSnap.data()
      if (litter.tenantId !== requesterUid) return { ok: false, reason: 'NOT_YOUR_LITTER' }
      if (litter.archived) return { ok: false, reason: 'LITTER_ARCHIVED' }
      if (!(litter.puppyIds || []).includes(dogId)) {
        tx.update(litterRef, { puppyIds: AdminFieldValue.arrayUnion(dogId) })
      }
      return { ok: true, alreadyExisted: true, dogId, passportId: dog.passportId }
    }

    const dogSnap = await tx.get(dogRef)
    if (dogSnap.exists) return { ok: false, reason: 'DOG_ID_COLLISION' }
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists) return { ok: false, reason: 'LITTER_NOT_FOUND' }
    if (litterSnap.data().tenantId !== requesterUid) return { ok: false, reason: 'NOT_YOUR_LITTER' }
    if (litterSnap.data().archived) return { ok: false, reason: 'LITTER_ARCHIVED' }
    const reservationSnap = await tx.get(reservationRef)
    if (reservationSnap.exists) return { ok: false, reason: 'PASSPORT_ID_TAKEN' }

    tx.set(reservationRef, { createdAt: new Date().toISOString(), createdBy: requesterUid, dogId, operationId })
    tx.set(dogRef, {
      ...normalizedPayload,
      tenantId: requesterUid, currentOwnerId: requesterUid, createdByUserId: requesterUid,
      sourceType: 'BREEDER_ISSUED', passportId: candidate, litterId, isDeceased: false, status: 'active',
    })
    tx.set(operationRef, {
      tenantId: requesterUid, litterId, dogId, sourceType: 'BREEDER_ISSUED',
      payload: normalizedPayload,
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
  // Codex round 5, Blocker 2: with a preserved dog still linked, the
  // litter is ARCHIVED (kept, so the dog's litterId still resolves),
  // never hard-deleted.
  const litterAfter = await safeGetDoc(doc(db, 'litters', litterId))
  check('1-FreshRead', 'The litter document is preserved (archived, not hard-deleted) because a linked dog is preserved', litterAfter.exists() && litterAfter.data().archived === true)
  check('1-FreshRead', 'The outcome correctly reports litterArchived, not litterDeleted', outcome.litterArchived === true && outcome.litterDeleted === false)
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
  check('2-NoOrphan', 'With nothing preserved, the litter is hard-deleted (not archived)', outcome.litterDeleted === true && outcome.litterArchived === false)
  const pupAGone = await safeGetDoc(doc(db, 'dogs', pupIdA))
  const pupBGone = await safeGetDoc(doc(db, 'dogs', pupIdB))
  check('2-NoOrphan', 'Neither puppy survives as an orphan referencing a deleted litter', !pupAGone.exists() && !pupBGone.exists())
  const litterGone = await safeGetDoc(doc(db, 'litters', litterId))
  check('2-NoOrphan', 'The litter document itself is gone', !litterGone.exists())
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
  const memberDogAfter = await getDoc(doc(db, 'dogs', memberPupId))
  check('5-RemovePuppy', 'The unlinked puppy Dog document itself still exists (unlink, not delete)', memberDogAfter.exists())
  // Codex round 5, Blocker 1: "never leave one-sided membership" — the
  // Dog's own litterId back-reference must also be cleared, not just
  // the litter's forward puppyIds entry.
  check('5-RemovePuppy', 'Two-sided membership: the Dog\'s own litterId back-reference was ALSO cleared (not just puppyIds)', memberDogAfter.data().litterId === undefined)

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
  const confirmedMembers = fetched.filter(d => d.litterId === litterId)
  const { eligible, preserved } = partitionConfirmedMembers(confirmedMembers, breederUid)
  check('6-HistorySignals', 'previousOwnerId alone (no buyerEmail) blocks eligibility', !eligible.some(d => d.id === prevOwnerOnlyId))
  check('6-HistorySignals', 'transferredAt alone (no buyerEmail) blocks eligibility', !eligible.some(d => d.id === transferredAtOnlyId))
  check('6-HistorySignals', 'claimedAt alone (no buyerEmail) blocks eligibility', !eligible.some(d => d.id === claimedAtOnlyId))
  check('6-HistorySignals', 'claimedBy ALONE (no claimedAt, no buyerEmail) blocks eligibility', !eligible.some(d => d.id === claimedByOnlyId))
  check('6-HistorySignals', 'All four are counted as preserved', preserved.length === 4)

  // The same signals, run through the REAL delete-litter.js mirror end
  // to end — the litter must be ARCHIVED (all 4 members preserved, none
  // eligible), never hard-deleted, so every history-bearing puppy's
  // lineage reference stays resolvable.
  const outcome = await deleteLitterServer(litterId, breederUid)
  check('6-HistorySignals', 'delete-litter.js preserves all four history-bearing puppies and archives the litter (never hard-deletes it)', outcome.deletedCount === 0 && outcome.preservedCount === 4 && outcome.litterArchived === true)
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

// =========================================================================
// SECTION 9 — remove-litter-puppy.js: the full protected-Dog rejection
// matrix (Codex round 5, Blocker 1) — transferred, pending-claim,
// claimed (claimedBy alone), history-bearing (buyerEmail present as an
// empty string — presence, not truthiness), and not-currently-controlled
// each independently block removal, and an archived litter blocks it too.
// =========================================================================
{
  await as('breeder')
  const damId = `dam9_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam9', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter9_${R}`

  const transferredId = `pup9transferred_${R}`
  const pendingClaimId = `pup9pending_${R}`
  const claimedByOnlyId = `pup9claimedby_${R}`
  const emptyBuyerEmailId = `pup9emptyemail_${R}`
  const notControlledId = `pup9notcontrolled_${R}`
  const strangerUid9 = await newUser('stranger9')
  await as('breeder')

  await adminDb.collection('dogs').doc(transferredId).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Transferred9', sex: 'male', status: 'transferred', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('dogs').doc(pendingClaimId).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Pending9', sex: 'male', status: 'active', transferStatus: 'pendingClaim', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('dogs').doc(claimedByOnlyId).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'ClaimedBy9', sex: 'male', status: 'active', claimedBy: 'some-buyer-uid', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('dogs').doc(emptyBuyerEmailId).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'EmptyEmail9', sex: 'male', status: 'active', buyerEmail: '', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('dogs').doc(notControlledId).set({
    tenantId: breederUid, currentOwnerId: strangerUid9, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'NotControlled9', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter9', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [transferredId, pendingClaimId, claimedByOnlyId, emptyBuyerEmailId, notControlledId],
  })

  const cases = [
    [transferredId, 'transferred'],
    [pendingClaimId, 'pending-claim'],
    [claimedByOnlyId, 'claimed (claimedBy alone)'],
    [emptyBuyerEmailId, 'history-bearing (buyerEmail present as empty string)'],
    [notControlledId, 'not currently controlled by requester'],
  ]
  for (const [puppyId, label] of cases) {
    const attempt = await removeLitterPuppyServer(litterId, puppyId, breederUid)
    check('9-ProtectedRemoval', `A ${label} dog cannot be removed from its litter (DOG_PROTECTED)`, attempt.ok === false && attempt.reason === 'DOG_PROTECTED')
    const dogAfter = await getDoc(doc(db, 'dogs', puppyId))
    check('9-ProtectedRemoval', `The ${label} dog's litterId was NOT cleared by the rejected attempt`, dogAfter.data().litterId === litterId)
  }
  const litterAfter9 = await getDoc(doc(db, 'litters', litterId))
  check('9-ProtectedRemoval', 'None of the protected dogs were removed from puppyIds by any rejected attempt', cases.every(([id]) => (litterAfter9.data().puppyIds || []).includes(id)))

  // An archived litter also blocks removal outright.
  const archivedLitterId = `litter9archived_${R}`
  const archivedPupId = `pup9archived_${R}`
  await adminDb.collection('dogs').doc(archivedPupId).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Archived9', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId: archivedLitterId,
  })
  await adminDb.collection('litters').doc(archivedLitterId).set({
    tenantId: breederUid, damId, name: 'ArchivedLitter9', notes: '', actualBirthDate: '2026-01-01', puppyIds: [archivedPupId], archived: true,
  })
  const archivedAttempt = await removeLitterPuppyServer(archivedLitterId, archivedPupId, breederUid)
  check('9-ProtectedRemoval', 'Removing a puppy from an ARCHIVED litter is rejected (LITTER_ARCHIVED)', archivedAttempt.ok === false && archivedAttempt.reason === 'LITTER_ARCHIVED')
}

// =========================================================================
// SECTION 10 — delete-litter.js: reverse-only and contradictory legacy
// membership are handled safely (Codex round 5, Blocker 2) — never
// crash, never incorrectly resolved as confirmed either way.
// =========================================================================
{
  await as('breeder')
  const damId = `dam10b_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam10b', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter10b_${R}`
  const otherLitterId = `litter10bOther_${R}`

  // Reverse-only: this dog's OWN litterId points at litterId, but it was
  // NEVER added to litterId's puppyIds (e.g. a partial write that
  // updated the Dog but not the Litter).
  const reverseOnlyId = `pup10breverseonly_${R}`
  await setDoc(doc(db, 'dogs', reverseOnlyId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'ReverseOnly10b', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })

  // Contradictory: this dog IS listed in litterId's puppyIds, but its
  // OWN litterId points at a DIFFERENT litter entirely.
  const contradictoryId = `pup10bcontradictory_${R}`
  await setDoc(doc(db, 'dogs', contradictoryId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Contradictory10b', sex: 'female', status: 'active', dateOfBirth: '2026-01-01', litterId: otherLitterId,
  })

  // A genuinely confirmed member too, so the litter still has something
  // eligible to actually delete.
  const confirmedId = `pup10bconfirmed_${R}`
  await setDoc(doc(db, 'dogs', confirmedId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Confirmed10b', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })

  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter10b', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [contradictoryId, confirmedId], // reverseOnlyId deliberately NOT listed here
  })

  const outcome = await deleteLitterServer(litterId, breederUid)
  check('10-ReverseContradictory', 'Exactly the one genuinely-confirmed member was deleted', outcome.deletedCount === 1)
  check('10-ReverseContradictory', 'Reverse-only + contradictory dogs are both counted as ambiguous', outcome.ambiguousCount === 2)
  // Codex round 6, Blocker 1: nothing CONFIRMED is preserved, but the
  // reverse-only dog's own litterId still points at this litter — the
  // litter must be ARCHIVED (never hard-deleted), or that dog's
  // reference would dangle. This assertion previously (incorrectly)
  // expected a hard delete here — the exact "broken dangling-reference"
  // expectation Codex round 6 flagged.
  check('10-ReverseContradictory', 'The reverse-only dog alone is enough to force an archive, not a hard delete', outcome.litterDeleted === false && outcome.litterArchived === true)

  const confirmedGone = await safeGetDoc(doc(db, 'dogs', confirmedId))
  check('10-ReverseContradictory', 'The confirmed member was actually deleted', !confirmedGone.exists())

  const reverseOnlyAfter = await getDoc(doc(db, 'dogs', reverseOnlyId))
  check('10-ReverseContradictory', 'The reverse-only dog (found via litterId query, never in puppyIds) survives completely untouched', reverseOnlyAfter.exists() && reverseOnlyAfter.data().litterId === litterId)

  const contradictoryAfter = await getDoc(doc(db, 'dogs', contradictoryId))
  check('10-ReverseContradictory', 'The contradictory dog (in puppyIds, but its own litterId points elsewhere) survives completely untouched, still pointing at its real litter', contradictoryAfter.exists() && contradictoryAfter.data().litterId === otherLitterId)

  const litterAfter10 = await safeGetDoc(doc(db, 'litters', litterId))
  check('10-ReverseContradictory', 'The litter document itself still exists (archived, not deleted) so the reverse-only dog\'s litterId never dangles', litterAfter10.exists() && litterAfter10.data().archived === true)
}

// =========================================================================
// SECTION 11 — create-litter-puppy.js: a modified Dog document fails a
// retry even when the operation record itself matches (Codex round 5,
// Blocker 4) — an operationId match is not proof the DOG document
// itself is still what this operation actually created.
// =========================================================================
{
  await as('breeder')
  const damId = `dam11_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam11', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter11_${R}`
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter11', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
  })
  const payload = { name: 'ModifiedPup', breed: 'Poodle', sex: 'male', dateOfBirth: '2026-01-01', colour: '', microchip: '', ankc: '', notes: '' }
  const opId = `op11_${R}`
  const pupId = `pup11_${R}`

  const first = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
  check('11-ModifiedDogRetry', 'First creation succeeds', first.ok === true)

  // Simulate the Dog being modified by something OTHER than this
  // operation after creation (e.g. an unrelated updateDog() call).
  await adminDb.collection('dogs').doc(pupId).update({ name: 'SomeoneChangedThisName' })

  const retryAfterModification = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
  check('11-ModifiedDogRetry', 'A retry against a Dog whose fields no longer match the operation record fails closed (DOG_FIELDS_MISMATCH)', retryAfterModification.ok === false && retryAfterModification.reason === 'DOG_FIELDS_MISMATCH')

  // No writes happened as a result of the failed retry — the dog's
  // modified name is untouched (not reverted, not further modified),
  // and the litter's puppyIds is unaffected by this specific call.
  const dogAfter = await getDoc(doc(db, 'dogs', pupId))
  check('11-ModifiedDogRetry', 'The failed retry made no writes — the (already-modified) dog is exactly as the tampering left it', dogAfter.data().name === 'SomeoneChangedThisName')
}

// =========================================================================
// SECTION 12 — create-litter-puppy.js: a substituted Passport reservation
// fails a retry even when created by the SAME uid (Codex round 5,
// Blocker 4) — bound to dogId+operationId, not just createdBy.
// =========================================================================
{
  await as('breeder')
  const damId = `dam12_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam12', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter12_${R}`
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter12', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
  })
  const payload = { name: 'ReservationPup', breed: 'Poodle', sex: 'female', dateOfBirth: '2026-01-01', colour: '', microchip: '', ankc: '', notes: '' }
  const opId = `op12_${R}`
  const pupId = `pup12_${R}`

  const first = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
  check('12-SubstitutedReservation', 'First creation succeeds', first.ok === true)

  // Substitute the Dog's passport reservation with one created by the
  // SAME uid, but for a totally different (unrelated) dogId/operationId
  // — simulates a reservation record being reassigned/corrupted rather
  // than a different user entirely, which round 4's createdBy-only check
  // would NOT have caught.
  const dogSnap = await getDoc(doc(db, 'dogs', pupId))
  const realPassportId = dogSnap.data().passportId
  await adminDb.collection('passportReservations').doc(realPassportId).set({
    createdAt: new Date().toISOString(), createdBy: breederUid, dogId: 'some-unrelated-dog-id', operationId: 'some-unrelated-operation-id',
  })

  const retryAfterSubstitution = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
  check('12-SubstitutedReservation', 'A retry whose reservation has the SAME createdBy but a substituted dogId/operationId fails closed (RESERVATION_MISMATCH)', retryAfterSubstitution.ok === false && retryAfterSubstitution.reason === 'RESERVATION_MISMATCH')
}

// =========================================================================
// SECTION 13 — remove-litter-puppy.js: reverse-only and forward-only
// membership are BOTH rejected (Codex round 6, Blocker 2) — confirmed
// membership now requires dog.litterId === litterId AND
// litter.puppyIds.includes(puppyId) together, never either alone.
// =========================================================================
{
  await as('breeder')
  const damId = `dam13_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam13', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter13_${R}`
  const otherLitterId = `litter13other_${R}`

  // Reverse-only: dog.litterId === litterId, but NEVER added to
  // litterId's puppyIds.
  const reverseOnlyId = `pup13reverseonly_${R}`
  await setDoc(doc(db, 'dogs', reverseOnlyId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'ReverseOnly13', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  // Forward-only: listed in litterId's puppyIds, but its own litterId
  // points at a DIFFERENT litter entirely.
  const forwardOnlyId = `pup13forwardonly_${R}`
  await setDoc(doc(db, 'dogs', forwardOnlyId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'ForwardOnly13', sex: 'female', status: 'active', dateOfBirth: '2026-01-01', litterId: otherLitterId,
  })
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter13', notes: '', actualBirthDate: '2026-01-01', puppyIds: [forwardOnlyId], // reverseOnlyId deliberately absent
  })

  const reverseOnlyAttempt = await removeLitterPuppyServer(litterId, reverseOnlyId, breederUid)
  check('13-TwoSidedMembership', 'A reverse-only dog (litterId matches, but never in puppyIds) is rejected (NOT_CONFIRMED_MEMBER)', reverseOnlyAttempt.ok === false && reverseOnlyAttempt.reason === 'NOT_CONFIRMED_MEMBER')
  const reverseOnlyAfter = await getDoc(doc(db, 'dogs', reverseOnlyId))
  check('13-TwoSidedMembership', 'The reverse-only dog\'s litterId was NOT cleared by the rejected attempt', reverseOnlyAfter.data().litterId === litterId)

  const forwardOnlyAttempt = await removeLitterPuppyServer(litterId, forwardOnlyId, breederUid)
  check('13-TwoSidedMembership', 'A forward-only dog (in puppyIds, but its own litterId points elsewhere) is rejected (NOT_CONFIRMED_MEMBER)', forwardOnlyAttempt.ok === false && forwardOnlyAttempt.reason === 'NOT_CONFIRMED_MEMBER')
  const forwardOnlyAfter = await getDoc(doc(db, 'dogs', forwardOnlyId))
  check('13-TwoSidedMembership', 'The forward-only dog\'s litterId was NOT changed by the rejected attempt (still points at its real litter)', forwardOnlyAfter.data().litterId === otherLitterId)

  const litterAfter13 = await getDoc(doc(db, 'litters', litterId))
  check('13-TwoSidedMembership', 'Neither rejected attempt mutated puppyIds at all', (litterAfter13.data().puppyIds || []).length === 1 && litterAfter13.data().puppyIds[0] === forwardOnlyId)
}

// =========================================================================
// SECTION 14 — create-litter-puppy.js: the RETRY path requires the
// litter to exist / match tenant / not be archived (Codex round 6,
// Blocker 5) — a missing or archived litter must fail closed with zero
// writes, never silently skip the re-link and report success anyway.
// =========================================================================
{
  await as('breeder')
  const damId = `dam14_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam14', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const payload = { name: 'RetryLitterStatePup', breed: 'Poodle', sex: 'male', dateOfBirth: '2026-01-01', colour: '', microchip: '', ankc: '', notes: '' }

  // --- Missing litter on retry ---
  {
    const litterId = `litter14missing_${R}`
    await adminDb.collection('litters').doc(litterId).set({
      tenantId: breederUid, damId, name: 'Litter14Missing', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
    })
    const opId = `op14missing_${R}`
    const pupId = `pup14missing_${R}`
    const first = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
    check('14-RetryLitterState', 'First creation succeeds', first.ok === true)

    // The litter is now deleted entirely (simulating it being removed
    // between the first attempt and a client retry).
    await adminDb.collection('litters').doc(litterId).delete()

    const retryAfterLitterGone = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
    check('14-RetryLitterState', 'A retry against a now-missing litter fails closed (LITTER_NOT_FOUND), never silently reports success', retryAfterLitterGone.ok === false && retryAfterLitterGone.reason === 'LITTER_NOT_FOUND')
  }

  // --- Archived litter on retry ---
  {
    const litterId = `litter14archived_${R}`
    await adminDb.collection('litters').doc(litterId).set({
      tenantId: breederUid, damId, name: 'Litter14Archived', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
    })
    const opId = `op14archived_${R}`
    const pupId = `pup14archived_${R}`
    const first = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
    check('14-RetryLitterState', 'First creation succeeds (archived case)', first.ok === true)

    // The litter gets archived (e.g. a concurrent delete-litter call
    // preserved it because some OTHER dog was still linked).
    await adminDb.collection('litters').doc(litterId).update({ archived: true, archivedAt: new Date().toISOString() })

    const retryAfterArchived = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
    check('14-RetryLitterState', 'A retry against a now-ARCHIVED litter fails closed (LITTER_ARCHIVED), never silently reports success', retryAfterArchived.ok === false && retryAfterArchived.reason === 'LITTER_ARCHIVED')

    // No writes happened as a result of the failed retry — the dog and
    // its litter link are exactly as the first (successful) attempt
    // left them, not further mutated by the rejected retry.
    const litterSnap = await getDoc(doc(db, 'litters', litterId))
    check('14-RetryLitterState', 'The archived litter\'s puppyIds is unaffected by the rejected retry', (litterSnap.data().puppyIds || []).includes(pupId))
  }

  // --- Wrong-tenant litter on retry ---
  {
    const litterId = `litter14wrongtenant_${R}`
    await adminDb.collection('litters').doc(litterId).set({
      tenantId: breederUid, damId, name: 'Litter14WrongTenant', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
    })
    const opId = `op14wrongtenant_${R}`
    const pupId = `pup14wrongtenant_${R}`
    const first = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
    check('14-RetryLitterState', 'First creation succeeds (wrong-tenant case)', first.ok === true)

    // The litter's tenantId is reassigned (a scenario that shouldn't
    // normally happen, but the retry path must still independently
    // verify tenant ownership rather than trusting the earlier check).
    await adminDb.collection('litters').doc(litterId).update({ tenantId: 'someone-else-entirely' })

    const retryAfterTenantChange = await createLitterPuppyServer({ operationId: opId, litterId, dogId: pupId, payload, requesterUid: breederUid })
    check('14-RetryLitterState', 'A retry against a litter that no longer matches tenant fails closed (NOT_YOUR_LITTER)', retryAfterTenantChange.ok === false && retryAfterTenantChange.reason === 'NOT_YOUR_LITTER')
  }
}

// =========================================================================
// SECTION 15 — explicit-null history fields fail closed, at BOTH the
// Rules layer (direct client dogs.delete) and the Admin endpoint layer
// (remove-litter-puppy.js) — Codex round 6, Blocker 3. Also confirms a
// genuinely CLEAN dog (all five fields entirely absent, the common case)
// still deletes/removes normally — this hardening must not be overbroad.
// =========================================================================
{
  await as('breeder')
  const damId = `dam15_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam15', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })

  // --- Rules layer: explicit null on each history field independently blocks direct delete ---
  const nullCases = [
    ['buyerEmail', { buyerEmail: null }],
    ['previousOwnerId', { previousOwnerId: null }],
    ['transferredAt', { transferredAt: null }],
    ['claimedAt', { claimedAt: null }],
    ['claimedBy', { claimedBy: null }],
  ]
  for (const [label, extra] of nullCases) {
    const dogId = `historynull_${label}_${R}`
    await adminDb.collection('dogs').doc(dogId).set({
      tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
      sourceType: 'BREEDER_ISSUED', name: dogId, sex: 'male', status: 'active', dateOfBirth: '2020-01-01',
      ...extra,
    })
    let deleteDenied = false
    try { await deleteDoc(doc(db, 'dogs', dogId)) } catch (err) { deleteDenied = isDenied(err) }
    check('15-NullHistory', `A dog with ${label} explicitly set to null (status/currentOwnerId otherwise clean) cannot be deleted directly — round 6: explicit null must fail closed, not collapse to "no history"`, deleteDenied)
  }

  // --- Admin endpoint layer: explicit null on a litter member blocks remove-litter-puppy too ---
  const litterId = `litter15_${R}`
  const nullHistoryPupId = `pup15nullhistory_${R}`
  await adminDb.collection('dogs').doc(nullHistoryPupId).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'NullHistoryPup15', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
    litterId, claimedBy: null,
  })
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter15', notes: '', actualBirthDate: '2026-01-01', puppyIds: [nullHistoryPupId],
  })
  const nullHistoryRemoveAttempt = await removeLitterPuppyServer(litterId, nullHistoryPupId, breederUid)
  check('15-NullHistory', 'remove-litter-puppy.js also rejects a dog whose claimedBy is explicitly null (DOG_PROTECTED), not just non-null values', nullHistoryRemoveAttempt.ok === false && nullHistoryRemoveAttempt.reason === 'DOG_PROTECTED')

  // --- Sanity: a genuinely clean dog (fields entirely absent) is unaffected ---
  const cleanDogId = `historynull_clean_${R}`
  await setDoc(doc(db, 'dogs', cleanDogId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'CleanDog15', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  let cleanDeleteOk = true
  try { await deleteDoc(doc(db, 'dogs', cleanDogId)) } catch { cleanDeleteOk = false }
  check('15-NullHistory', 'A dog with all five history fields genuinely absent (never written) still deletes normally — the hardening is not overbroad', cleanDeleteOk)

  const cleanLitterId = `litter15clean_${R}`
  const cleanPupId = `pup15clean_${R}`
  await adminDb.collection('dogs').doc(cleanPupId).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'CleanRemovablePup15', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId: cleanLitterId,
  })
  await adminDb.collection('litters').doc(cleanLitterId).set({
    tenantId: breederUid, damId, name: 'Litter15Clean', notes: '', actualBirthDate: '2026-01-01', puppyIds: [cleanPupId],
  })
  const cleanRemoveAttempt = await removeLitterPuppyServer(cleanLitterId, cleanPupId, breederUid)
  check('15-NullHistory', 'A genuinely clean, two-sided-confirmed puppy remains removable', cleanRemoveAttempt.ok === true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
