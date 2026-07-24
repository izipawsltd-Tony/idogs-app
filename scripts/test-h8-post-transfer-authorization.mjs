// scripts/test-h8-post-transfer-authorization.mjs — Codex H8: a former
// breeder (tenantId) must not be able to create/update/delete the CURRENT
// owner's vaccine/worming/health-test/activity-note/document records
// merely because tenantId still points at them, post-transfer. Read
// (provenance/history) access is preserved for the former breeder.
//
// Emulator-only regression test — real firestore.rules evaluation, not a
// hand-simulation of the intended logic.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-h8
//   2. node scripts/test-h8-post-transfer-authorization.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { makeChecker } from './_lib/test-check.mjs'

const PROJECT_ID = 'demo-idogs-h8'
const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminApp = initAdminApp({ projectId: PROJECT_ID })
const adminDb = getAdminFirestore(adminApp)

const { check, checkAsync, summary } = makeChecker()

function isDenied(err) {
  return err && (err.code === 'permission-denied' || /permission/i.test(err.message))
}

const PW = 'tam12345*'
const R = Date.now()
const email = n => `h8.${n}.${R}@emulator.local`

async function newUser(name) {
  const { user } = await createUserWithEmailAndPassword(auth, email(name), PW)
  await signOut(auth)
  return user.uid
}
async function as(name) {
  await signOut(auth).catch(() => {})
  await signInWithEmailAndPassword(auth, email(name), PW)
}

const formerBreederUid = await newUser('former-breeder')
const currentOwnerUid = await newUser('current-owner')
const strangerUid = await newUser('stranger')

// ── Fixture: a dog that has been transferred and claimed. tenantId is
// permanently the former breeder; currentOwnerId is the new owner — the
// exact real-world shape transferDogOwnership() + claim-transferred-dogs.js
// produce. Seeded directly via Admin SDK (bypasses rules), matching the
// established pattern in this repo's other emulator test files.
const dogId = `dog_${R}`
await adminDb.collection('dogs').doc(dogId).set({
  tenantId: formerBreederUid,
  currentOwnerId: currentOwnerUid,
  createdByUserId: formerBreederUid,
  name: 'H8 Test Dog',
  breed: 'Labrador Retriever',
  sex: 'female',
  dateOfBirth: '2023-01-01',
  status: 'active',
  isDeceased: false,
  photos: [],
  buyerEmail: 'current-owner@example.com',
  buyerName: 'Current Owner',
  previousOwnerId: formerBreederUid,
  transferredAt: '2026-01-01T00:00:00.000Z',
  claimedAt: '2026-01-02T00:00:00.000Z',
  claimedBy: currentOwnerUid,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
})

// A pre-existing vaccine record on this dog, seeded by the CURRENT owner
// (the realistic post-claim scenario: the new owner has already added
// their own record).
const vaccineId = `vac_${R}`
await adminDb.collection('vaccineRecords').doc(vaccineId).set({
  dogId, name: 'Parvovirus', dateGiven: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z',
})
const documentId = `doc_${R}`
await adminDb.collection('documents').doc(documentId).set({
  dogId, category: 'vaccine_cert', name: 'Cert.pdf', fileType: 'application/pdf', fileSizeMb: 0.5, isPublic: false, createdAt: '2026-02-01T00:00:00.000Z',
})

// =========================================================================
// SECTION 1 — Former breeder (tenantId only, post-transfer): READ allowed
// (provenance), WRITE denied
// =========================================================================
await as('former-breeder')

await checkAsync('former breeder CAN read the current owner\'s vaccine record (provenance/history preserved)', async () => {
  const snap = await getDoc(doc(db, 'vaccineRecords', vaccineId))
  return snap.exists()
})

await checkAsync('former breeder CANNOT update the current owner\'s vaccine record', async () => {
  try {
    await updateDoc(doc(db, 'vaccineRecords', vaccineId), { name: 'Tampered' })
    return false
  } catch (err) {
    return isDenied(err)
  }
})

await checkAsync('former breeder CANNOT delete the current owner\'s vaccine record', async () => {
  try {
    await deleteDoc(doc(db, 'vaccineRecords', vaccineId))
    return false
  } catch (err) {
    return isDenied(err)
  }
})

await checkAsync('former breeder CANNOT create a NEW vaccine record on the dog they no longer own', async () => {
  try {
    await setDoc(doc(db, 'vaccineRecords', `vac2_${R}`), { dogId, name: 'Forged', dateGiven: '2026-03-01', createdAt: '2026-03-01T00:00:00.000Z' })
    return false
  } catch (err) {
    return isDenied(err)
  }
})

await checkAsync('former breeder CANNOT update the current owner\'s document record', async () => {
  try {
    await updateDoc(doc(db, 'documents', documentId), { name: 'Tampered.pdf' })
    return false
  } catch (err) {
    return isDenied(err)
  }
})

await checkAsync('former breeder CANNOT delete the current owner\'s document record', async () => {
  try {
    await deleteDoc(doc(db, 'documents', documentId))
    return false
  } catch (err) {
    return isDenied(err)
  }
})

// =========================================================================
// SECTION 2 — Effective current owner: full read/write access
// =========================================================================
await as('current-owner')

await checkAsync('current owner CAN read their own vaccine record', async () => {
  const snap = await getDoc(doc(db, 'vaccineRecords', vaccineId))
  return snap.exists()
})

await checkAsync('current owner CAN update their own vaccine record', async () => {
  await updateDoc(doc(db, 'vaccineRecords', vaccineId), { name: 'Parvovirus (booster)' })
  const snap = await getDoc(doc(db, 'vaccineRecords', vaccineId))
  return snap.data().name === 'Parvovirus (booster)'
})

await checkAsync('current owner CAN create a NEW vaccine record on their own dog', async () => {
  await setDoc(doc(db, 'vaccineRecords', `vac3_${R}`), { dogId, name: 'Rabies', dateGiven: '2026-03-01', createdAt: '2026-03-01T00:00:00.000Z' })
  const snap = await getDoc(doc(db, 'vaccineRecords', `vac3_${R}`))
  return snap.exists()
})

await checkAsync('current owner CAN update their own document record', async () => {
  await updateDoc(doc(db, 'documents', documentId), { name: 'Cert-renamed.pdf' })
  const snap = await getDoc(doc(db, 'documents', documentId))
  return snap.data().name === 'Cert-renamed.pdf'
})

await checkAsync('current owner CAN delete their own vaccine record', async () => {
  await deleteDoc(doc(db, 'vaccineRecords', `vac3_${R}`))
  const snap = await getDoc(doc(db, 'vaccineRecords', `vac3_${R}`))
  return !snap.exists()
})

// =========================================================================
// SECTION 3 — A stranger (neither tenantId nor currentOwnerId): denied
// everything, including read
// =========================================================================
await as('stranger')

await checkAsync('a stranger CANNOT read the vaccine record at all', async () => {
  try {
    const snap = await getDoc(doc(db, 'vaccineRecords', vaccineId))
    // getDoc on a denied doc resolves with exists()===false in some SDK
    // versions rather than throwing — treat that as denial too, but a
    // thrown permission error is the expected primary path.
    return !snap.exists()
  } catch (err) {
    return isDenied(err)
  }
})

await checkAsync('a stranger CANNOT update the vaccine record', async () => {
  try {
    await updateDoc(doc(db, 'vaccineRecords', vaccineId), { name: 'Hacked' })
    return false
  } catch (err) {
    return isDenied(err)
  }
})

// =========================================================================
// SECTION 4 — heatCycles delete follows the same current-owner-only rule
// =========================================================================
{
  const heatCycleId = `heat_${R}`
  await adminDb.collection('heatCycles').doc(heatCycleId).set({ dogId, heatNumber: 1, heatStartDate: '2026-01-15' })

  await as('former-breeder')
  await checkAsync('former breeder CANNOT delete a heat cycle record on the dog they no longer own', async () => {
    try {
      await deleteDoc(doc(db, 'heatCycles', heatCycleId))
      return false
    } catch (err) {
      return isDenied(err)
    }
  })

  await as('current-owner')
  await checkAsync('current owner CAN delete their own heat cycle record', async () => {
    await deleteDoc(doc(db, 'heatCycles', heatCycleId))
    const snap = await getDoc(doc(db, 'heatCycles', heatCycleId))
    return !snap.exists()
  })
}

// =========================================================================
// SECTION 5 — A dog NEVER transferred (tenantId === currentOwnerId, the
// common case) — the H8 fix must not regress ordinary single-owner access
// =========================================================================
{
  const soloUid = await newUser('solo-owner')
  const soloDogId = `solodog_${R}`
  await adminDb.collection('dogs').doc(soloDogId).set({
    tenantId: soloUid, currentOwnerId: soloUid, createdByUserId: soloUid,
    name: 'Solo Dog', breed: 'Poodle', sex: 'male', dateOfBirth: '2023-01-01',
    status: 'active', isDeceased: false, photos: [],
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  })
  await as('solo-owner')
  const soloVacId = `solovac_${R}`
  await checkAsync('an ordinary (never-transferred) owner can still create, update, and delete their own dog\'s vaccine record — H8 does not regress the common case', async () => {
    await setDoc(doc(db, 'vaccineRecords', soloVacId), { dogId: soloDogId, name: 'Distemper', dateGiven: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' })
    await updateDoc(doc(db, 'vaccineRecords', soloVacId), { name: 'Distemper (booster)' })
    await deleteDoc(doc(db, 'vaccineRecords', soloVacId))
    const snap = await getDoc(doc(db, 'vaccineRecords', soloVacId))
    return !snap.exists()
  })
}

await summary()
