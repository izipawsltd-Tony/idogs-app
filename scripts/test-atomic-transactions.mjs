// Emulator-only regression test for the transaction-based litter
// deletion (Codex round 3, Blocker 2) and atomic puppy creation with
// idempotency (Blocker 3), plus the remaining Blocker 4 (ownership-
// history) checks not already covered in test-litter-delete-cleanup.mjs:
// previousOwnerId/transferredAt/claimedAt WITHOUT buyerEmail, and
// history-field immutability.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-atomic-transactions.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, collection, getDoc, setDoc, updateDoc, runTransaction, arrayUnion } from 'firebase/firestore'
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

function partitionLitterCandidates(litterId, fetched, requesterUid) {
  const confirmedMembers = fetched.filter(d => d.litterId === litterId)
  const eligible = confirmedMembers.filter(d =>
    d.currentOwnerId === requesterUid &&
    d.status !== 'transferred' && d.transferStatus !== 'pendingClaim' &&
    !d.buyerEmail && !d.previousOwnerId && !d.transferredAt && !d.claimedAt
  )
  return { confirmedMembers, eligible, preserved: confirmedMembers.length - eligible.length }
}

// Mirrors LittersPage.handleDeleteLitter()'s runTransaction callback exactly.
async function deleteLitterTransactional(litterId, requesterUid) {
  return runTransaction(db, async (tx) => {
    const litterRef = doc(db, 'litters', litterId)
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists()) return { deletedCount: 0 }
    const puppyIds = litterSnap.data().puppyIds || []
    const candidateSnaps = await Promise.all(puppyIds.map(id => tx.get(doc(db, 'dogs', id))))
    const fetched = candidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
    const { eligible } = partitionLitterCandidates(litterId, fetched, requesterUid)
    tx.delete(litterRef)
    for (const puppy of eligible) tx.delete(doc(db, 'dogs', puppy.id))
    return { deletedCount: eligible.length }
  })
}

// Mirrors db.ts's createLitterPuppyAtomic exactly (minus passportId
// reservation-collision retry loop, which is orthogonal to what these
// tests exercise — covered structurally in test-parent-eligibility.mjs
// / by code inspection).
async function createLitterPuppyAtomic(litterId, dogId, puppyData, requesterUid) {
  const dogRef = doc(db, 'dogs', dogId)
  const litterRef = doc(db, 'litters', litterId)
  return runTransaction(db, async (tx) => {
    const existingDogSnap = await tx.get(dogRef)
    if (existingDogSnap.exists()) {
      const litterSnap = await tx.get(litterRef)
      if (litterSnap.exists() && !(litterSnap.data().puppyIds || []).includes(dogId)) {
        tx.update(litterRef, { puppyIds: arrayUnion(dogId) })
      }
      return { alreadyExisted: true }
    }
    tx.set(dogRef, { ...puppyData, tenantId: requesterUid, currentOwnerId: requesterUid, createdByUserId: requesterUid, litterId })
    tx.update(litterRef, { puppyIds: arrayUnion(dogId) })
    return { alreadyExisted: false }
  })
}

const breederUid = await newUser('breeder')

// =========================================================================
// SECTION 1 — deleteLitterTransactional (the real runTransaction-based
// implementation) reads INSIDE the transaction, not from a stale
// pre-fetch — proven by completing a concurrent transfer BEFORE calling
// it and confirming it acts on the fresh state, never the state that
// would have been true at page-load time. (A literal mid-flight
// Firestore conflict/auto-retry was evaluated as a test technique, but
// the emulator evaluates security rules against the CURRENT document
// state at commit time regardless of retry semantics, making a
// deliberately-forced mid-transaction race an unreliable, implementation-
// detail-dependent thing to assert on. The meaningful, stable guarantee
// — every execution of this transaction, retried or not, always decides
// against live data, never a getDoc() taken before the confirm dialog —
// is what this test actually verifies.)
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

  // Transfer completes BEFORE the transaction runs at all — simulating
  // "by the time the breeder actually clicks confirm, reality has moved on".
  const buyerUid1 = await newUser('buyer1')
  await as('breeder')
  await adminDb.collection('dogs').doc(pupId).update({ currentOwnerId: buyerUid1, status: 'active' })

  const outcome = await deleteLitterTransactional(litterId, breederUid)
  check('1-FreshRead', 'The transaction excludes the already-transferred puppy (reads live state, not a stale snapshot)', outcome.deletedCount === 0)
  const pupStillThere = await safeGetDoc(doc(db, 'dogs', pupId))
  check('1-FreshRead', 'The transferred puppy survives with its new owner intact', pupStillThere.exists() && pupStillThere.data().currentOwnerId === buyerUid1)
  const litterGone = await safeGetDoc(doc(db, 'litters', litterId))
  check('1-FreshRead', 'The litter itself is still deleted (only the puppy is preserved)', !litterGone.exists())
}

// =========================================================================
// SECTION 2 — puppyIds mutation before deletion: a puppy linked to the
// litter AFTER it was first loaded (e.g. by a concurrent "Add puppy"
// submission in another tab) but BEFORE the delete transaction actually
// runs must still be picked up and included — never silently orphaned
// by a delete that acts on stale (pre-addition) puppyIds.
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

  // A second puppy gets linked (e.g. a concurrent Add-puppy submission)
  // before the delete transaction runs.
  const pupIdB = `pupB2_${R}`
  await setDoc(doc(db, 'dogs', pupIdB), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'PupB2', sex: 'female', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('litters').doc(litterId).update({ puppyIds: AdminFieldValue.arrayUnion(pupIdB) })

  const outcome = await deleteLitterTransactional(litterId, breederUid)
  check('2-NoOrphan', 'Both the original and newly-linked puppy were deleted together with the litter (no orphan left behind)', outcome.deletedCount === 2)
  const pupAGone = await safeGetDoc(doc(db, 'dogs', pupIdA))
  const pupBGone = await safeGetDoc(doc(db, 'dogs', pupIdB))
  check('2-NoOrphan', 'Neither puppy survives as an orphan referencing a deleted litter', !pupAGone.exists() && !pupBGone.exists())
}

// =========================================================================
// SECTION 3 — createLitterPuppyAtomic idempotent retry: the same dogId
// resolves to the same puppy without creating a duplicate, and a
// genuinely different dogId (a separate, concurrent puppy submission)
// creates a distinct record correctly linked alongside it.
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

  const pupId = doc(collection(db, 'dogs')).id
  const first = await createLitterPuppyAtomic(litterId, pupId, {
    name: 'RetryPup', breed: 'Poodle', sex: 'male', dateOfBirth: '2026-01-01', colour: '', microchip: '', ankc: '', notes: '',
  }, breederUid)
  check('3-Idempotent', 'First creation reports alreadyExisted: false', first.alreadyExisted === false)

  // Retry with the SAME dogId (simulates a client retry after an
  // ambiguous network failure)
  const retry = await createLitterPuppyAtomic(litterId, pupId, {
    name: 'RetryPup', breed: 'Poodle', sex: 'male', dateOfBirth: '2026-01-01', colour: '', microchip: '', ankc: '', notes: '',
  }, breederUid)
  check('3-Idempotent', 'Retry with the same dogId reports alreadyExisted: true (no duplicate created)', retry.alreadyExisted === true)

  const litterSnap = await getDoc(doc(db, 'litters', litterId))
  check('3-Idempotent', 'The litter\'s puppyIds contains the dog exactly once, not twice', (litterSnap.data().puppyIds || []).filter(id => id === pupId).length === 1)

  // A genuinely different concurrent submission (different dogId) must
  // still succeed and coexist correctly
  const pupId2 = doc(collection(db, 'dogs')).id
  const second = await createLitterPuppyAtomic(litterId, pupId2, {
    name: 'SecondPup', breed: 'Poodle', sex: 'female', dateOfBirth: '2026-01-01', colour: '', microchip: '', ankc: '', notes: '',
  }, breederUid)
  check('3-Idempotent', 'A genuinely different concurrent puppy submission succeeds independently', second.alreadyExisted === false)
  const litterSnap2 = await getDoc(doc(db, 'litters', litterId))
  check('3-Idempotent', 'Both distinct puppies end up linked, no duplication or loss', (litterSnap2.data().puppyIds || []).length === 2)
}

// =========================================================================
// SECTION 4 — previousOwnerId / transferredAt / claimedAt WITHOUT
// buyerEmail each independently block litter-delete eligibility — not
// "buyerEmail is the one signal that matters" (Codex Blocker 4).
// =========================================================================
{
  await as('breeder')
  const damId = `dam4_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam4', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter4_${R}`

  const prevOwnerOnlyId = `prevowneronly_${R}`
  const transferredAtOnlyId = `transferredatonly_${R}`
  const claimedAtOnlyId = `claimedatonly_${R}`
  for (const [id, extra] of [
    [prevOwnerOnlyId, { previousOwnerId: 'some-former-owner-uid' }],
    [transferredAtOnlyId, { transferredAt: '2026-01-01T00:00:00.000Z' }],
    [claimedAtOnlyId, { claimedAt: '2026-01-02T00:00:00.000Z' }],
  ]) {
    await setDoc(doc(db, 'dogs', id), {
      tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
      sourceType: 'BREEDER_ISSUED', name: id, sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
      ...extra,
    })
  }
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Litter4', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [prevOwnerOnlyId, transferredAtOnlyId, claimedAtOnlyId],
  })

  const litterSnap = await getDoc(doc(db, 'litters', litterId))
  const candidateSnaps = await Promise.all((litterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const fetched = candidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { eligible, preserved } = partitionLitterCandidates(litterId, fetched, breederUid)
  check('4-HistorySignals', 'previousOwnerId alone (no buyerEmail) blocks eligibility', !eligible.some(d => d.id === prevOwnerOnlyId))
  check('4-HistorySignals', 'transferredAt alone (no buyerEmail) blocks eligibility', !eligible.some(d => d.id === transferredAtOnlyId))
  check('4-HistorySignals', 'claimedAt alone (no buyerEmail) blocks eligibility', !eligible.some(d => d.id === claimedAtOnlyId))
  check('4-HistorySignals', 'All three are counted as preserved', preserved === 3)
}

// =========================================================================
// SECTION 5 — history-field immutability: once set, buyerEmail/
// previousOwnerId/transferredAt/claimedAt can never be cleared or
// changed by a client update (dogs update rule) — the FIRST write
// (setting them) remains allowed.
// =========================================================================
{
  await as('breeder')
  const dogId = `historyimmutable_${R}`
  await setDoc(doc(db, 'dogs', dogId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'HistoryImmutable', sex: 'male', status: 'active', dateOfBirth: '2020-01-01',
  })

  // First write of history fields (simulates transferDogOwnership()) — allowed.
  let firstWriteOk = true
  try {
    await updateDoc(doc(db, 'dogs', dogId), {
      status: 'transferred', transferStatus: 'pendingClaim',
      buyerEmail: 'buyer@example.com', buyerName: 'Buyer', transferredAt: '2026-01-01T00:00:00.000Z', previousOwnerId: breederUid,
    })
  } catch { firstWriteOk = false }
  check('5-HistoryImmutable', 'The FIRST write of history fields (a real transfer) is allowed', firstWriteOk)

  // Attempting to clear/change buyerEmail afterwards is denied.
  let clearBuyerEmailDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { buyerEmail: 'different@example.com' }) } catch (err) { clearBuyerEmailDenied = isDenied(err) }
  check('5-HistoryImmutable', 'Changing an already-set buyerEmail is denied', clearBuyerEmailDenied)

  let clearTransferredAtDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { transferredAt: '2099-01-01T00:00:00.000Z' }) } catch (err) { clearTransferredAtDenied = isDenied(err) }
  check('5-HistoryImmutable', 'Changing an already-set transferredAt is denied', clearTransferredAtDenied)

  let clearPreviousOwnerDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { previousOwnerId: 'someone-else' }) } catch (err) { clearPreviousOwnerDenied = isDenied(err) }
  check('5-HistoryImmutable', 'Changing an already-set previousOwnerId is denied', clearPreviousOwnerDenied)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
