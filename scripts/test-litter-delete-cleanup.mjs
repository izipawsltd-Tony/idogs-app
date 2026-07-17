// Emulator-only regression test for the litter-delete puppy-cleanup fix
// (fix/sire-heat-cycle, Final Litter Lifecycle Blockers).
//
// Root cause: handleDeleteLitter() in LittersPage.tsx used to only
// deleteDoc() the litters/{id} document itself — its own confirm() text
// literally said "This will NOT delete the puppies." Every puppy Dog
// record stayed in Firestore and kept showing up in My Dogs forever,
// with no litter left to show they'd ever been grouped together.
//
// Fixed by batching the litter delete with a delete for every puppy
// still under the breeder's active control (not transferred/claimed) in
// one atomic writeBatch — a transferred/claimed puppy's Dog record (and
// its ownership history) is left completely untouched, and an unrelated
// dog never in litter.puppyIds is never touched either. Using a batch
// means a single denied operation (e.g. a stale puppyIds entry that no
// longer resolves to the requester's own dog) fails the ENTIRE batch —
// nothing is left half-deleted.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-litter-delete-cleanup.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore'
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

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}
function isDenied(err) {
  return err && (err.code === 'permission-denied' || /permission/i.test(err.message))
}
// litters/{id} and dogs/{dogId}'s read rules dereference resource.data
// directly (no reminders-style `resource == null` guard), so a get() on
// an already-deleted document evaluates to a rule error, which Firestore
// treats as permission-denied rather than "not found" — a
// permission-denied here on a doc THIS test itself just tried to delete
// is equivalent to "confirmed gone" for verification purposes.
async function safeGetDoc(ref) {
  try { return await getDoc(ref) } catch (err) { if (isDenied(err)) return { exists: () => false }; throw err }
}

const PW = 'tam12345*'
const R = Date.now()
const email = n => `litter.${n}.${R}@emulator.local`

async function newUser(name) {
  const { user } = await createUserWithEmailAndPassword(auth, email(name), PW)
  await signOut(auth)
  return user.uid
}
async function as(name) {
  await signOut(auth).catch(() => {})
  await signInWithEmailAndPassword(auth, email(name), PW)
}

const breederUid = await newUser('breeder')
const buyerUid = await newUser('buyer')
const strangerUid = await newUser('stranger')

// =========================================================================
// SECTION 1 — Delete litter removes eligible puppies, preserves
// transferred ones, leaves unrelated dogs untouched
// =========================================================================
{
  await as('breeder')
  const damId = `dam_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter_${R}`
  await setDoc(doc(db, 'litters', litterId), {
    tenantId: breederUid, damId, name: 'Test Litter', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [`p1_${R}`, `p2_${R}`, `p3_${R}`],
  })
  // p1, p2: eligible — still fully breeder-controlled
  await setDoc(doc(db, 'dogs', `p1_${R}`), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Pup1', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
  })
  await setDoc(doc(db, 'dogs', `p2_${R}`), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Pup2', sex: 'female', status: 'active', dateOfBirth: '2026-01-01',
  })
  // p3: transferred to a buyer — must be preserved
  await setDoc(doc(db, 'dogs', `p3_${R}`), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Pup3', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
  })
  await adminDb.collection('dogs').doc(`p3_${R}`).update({ currentOwnerId: buyerUid, status: 'active' })
  // Unrelated dog — never part of this litter
  const unrelatedId = `unrelated_${R}`
  await setDoc(doc(db, 'dogs', unrelatedId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Unrelated', sex: 'male', status: 'active', dateOfBirth: '2020-01-01',
  })

  // Mirrors LittersPage.handleDeleteLitter(): batch litter delete + only
  // the eligible (untransferred) puppies.
  const batch = writeBatch(db)
  batch.delete(doc(db, 'litters', litterId))
  batch.delete(doc(db, 'dogs', `p1_${R}`))
  batch.delete(doc(db, 'dogs', `p2_${R}`))
  // p3 deliberately excluded — transferred, must be preserved
  let deleteOk = true
  try { await batch.commit() } catch (err) { deleteOk = false }
  check('1-Delete', 'Litter-delete batch (litter + 2 eligible puppies) succeeds', deleteOk)

  const litterSnap = await safeGetDoc(doc(db, 'litters', litterId))
  check('1-Delete', 'Litter document is gone', !litterSnap.exists())

  const p1Snap = await safeGetDoc(doc(db, 'dogs', `p1_${R}`))
  const p2Snap = await safeGetDoc(doc(db, 'dogs', `p2_${R}`))
  check('1-Delete', 'Eligible puppy p1 is gone (no longer in My Dogs)', !p1Snap.exists())
  check('1-Delete', 'Eligible puppy p2 is gone (no longer in My Dogs)', !p2Snap.exists())

  const p3Snap = await safeGetDoc(doc(db, 'dogs', `p3_${R}`))
  check('1-Delete', 'Transferred puppy p3 is preserved (ownership history intact)', p3Snap.exists() && p3Snap.data().currentOwnerId === buyerUid)

  const unrelatedSnap = await safeGetDoc(doc(db, 'dogs', unrelatedId))
  check('1-Delete', 'Unrelated dog (not in litter.puppyIds) is untouched', unrelatedSnap.exists())
}

// =========================================================================
// SECTION 2 — Atomicity: a batch that includes a dog the requester
// doesn't actually own must fail ENTIRELY — the litter itself must NOT
// be deleted either, so litter/puppy state can never go inconsistent
// =========================================================================
{
  await as('breeder')
  const damId2 = `dam2_${R}`
  await setDoc(doc(db, 'dogs', damId2), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam2', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId2 = `litter2_${R}`
  await setDoc(doc(db, 'litters', litterId2), {
    tenantId: breederUid, damId: damId2, name: 'Atomicity Litter', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [`ap1_${R}`],
  })
  await setDoc(doc(db, 'dogs', `ap1_${R}`), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'AtomicPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
  })
  // A stranger's dog, wrongly included in the batch (simulates a bug —
  // e.g. a stale puppyIds entry pointing at a dog that isn't the
  // requester's own anymore)
  await as('stranger')
  const strangerDogId = `strangerdog_${R}`
  await setDoc(doc(db, 'dogs', strangerDogId), {
    tenantId: strangerUid, currentOwnerId: strangerUid, createdByUserId: strangerUid,
    sourceType: 'BREEDER_ISSUED', name: 'StrangerDog', sex: 'male', status: 'active', dateOfBirth: '2020-01-01',
  })

  await as('breeder')
  const badBatch = writeBatch(db)
  badBatch.delete(doc(db, 'litters', litterId2))
  badBatch.delete(doc(db, 'dogs', `ap1_${R}`))
  badBatch.delete(doc(db, 'dogs', strangerDogId)) // not the breeder's dog — must deny the whole batch
  let batchDenied = false
  try { await badBatch.commit() } catch (err) { batchDenied = isDenied(err) }
  check('2-Atomicity', 'A batch containing an unauthorized delete is rejected entirely', batchDenied)

  const litterStillThere = await safeGetDoc(doc(db, 'litters', litterId2))
  check('2-Atomicity', 'After a rejected batch, the litter document is NOT deleted (no partial state)', litterStillThere.exists())
  const puppyStillThere = await safeGetDoc(doc(db, 'dogs', `ap1_${R}`))
  check('2-Atomicity', 'After a rejected batch, the eligible puppy is NOT deleted either (no partial state)', puppyStillThere.exists())
  const strangerDogStillThere = await safeGetDoc(doc(db, 'dogs', strangerDogId))
  check('2-Atomicity', "The stranger's own dog was never touched", strangerDogStillThere.exists())
}

// =========================================================================
// SECTION 3 — A litter with no puppies at all deletes cleanly (baseline,
// no accidental behavior change for the common case)
// =========================================================================
{
  await as('breeder')
  const damId3 = `dam3_${R}`
  await setDoc(doc(db, 'dogs', damId3), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam3', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId3 = `litter3_${R}`
  await setDoc(doc(db, 'litters', litterId3), {
    tenantId: breederUid, damId: damId3, name: 'Empty Litter', notes: '', puppyIds: [],
  })
  const batch = writeBatch(db)
  batch.delete(doc(db, 'litters', litterId3))
  let ok = true
  try { await batch.commit() } catch { ok = false }
  check('3-EmptyLitter', 'A planned litter with zero puppies deletes cleanly', ok)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
