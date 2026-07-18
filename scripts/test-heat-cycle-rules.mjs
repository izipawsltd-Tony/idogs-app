// Emulator-only regression test for the heatCycles/{id} firestore.rules
// (fix/sire-heat-cycle). Read/delete access control only — see history
// below for why create/update aren't tested here anymore.
//
// History: heatCycles originally had NO rule at all (every read/write
// fell through to the default deny). Then create/update grew Sire/Dam
// eligibility checks in Rules (isEligibleBreedingDog etc). Codex round 3
// established that Firestore Rules cannot verify "meets actual minimum
// breeding maturity" (no date-arithmetic functions), so full Dam/Sire
// eligibility now lives in api/_lib/parent-eligibility.js, exercised by
// api/save-heat-cycle.js — see scripts/test-parent-eligibility.mjs for
// that coverage (both the pure validation logic AND confirmation that a
// direct client create/update is denied unconditionally, which this
// file no longer needs to re-test). heatCycles create/update are now
// `if false` for the client SDK — every fixture here is seeded via the
// Admin SDK (simulating what the trusted endpoint would have written),
// and only read/delete are exercised as real client-SDK operations.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-heat-cycle-rules.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where } from 'firebase/firestore'
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

// Codex round 6: this file's check() calls pass check(sectionLabel,
// description, condition) — fixed via call-shape detection. Codex round
// 7, Blocker 1: now uses the shared, self-tested
// scripts/_lib/test-check.mjs, which keeps that same shape detection AND
// throws loudly instead of silently passing when given an unawaited
// Promise/thenable as the condition.
import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()
function isDenied(err) {
  return err && (err.code === 'permission-denied' || /permission/i.test(err.message))
}

const PW = 'tam12345*'
const R = Date.now()
const email = n => `heat.${n}.${R}@emulator.local`

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
const strangerUid = await newUser('stranger')

// =========================================================================
// SECTION 1 — read/delete access control for the record's own owner
// =========================================================================
{
  const damId = `dam_${R}`
  await as('breeder')
  await adminDb.collection('dogs').doc(damId).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Luna', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const cycleId = `cycle_${R}`
  await adminDb.collection('heatCycles').doc(cycleId).set({
    dogId: damId, tenantId: breederUid, heatNumber: 1, heatStartDate: '2026-01-01', notes: 'first heat', createdAt: '2026-01-01',
  })

  let readOk = true, size = 0
  try {
    const snap = await getDocs(query(collection(db, 'heatCycles'), where('dogId', '==', damId)))
    size = snap.size
  } catch (err) { readOk = false }
  check('1-Dam', 'Breeder can read their own Heat Cycle record', readOk && size === 1, `size=${size}`)

  let deleteOk = true
  try { await deleteDoc(doc(db, 'heatCycles', cycleId)) } catch (err) { deleteOk = false }
  check('1-Dam', 'Breeder can delete their own Heat Cycle record', deleteOk)
}

// =========================================================================
// SECTION 2 — a direct client create/update is denied outright,
// regardless of how eligible the payload looks (full logic coverage is
// in test-parent-eligibility.mjs; this just confirms the rule shape
// locally too)
// =========================================================================
{
  await as('breeder')
  const damId2 = `dam2_${R}`
  await adminDb.collection('dogs').doc(damId2).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Luna2', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  let createDenied = false
  try {
    const { setDoc } = await import('firebase/firestore')
    await setDoc(doc(db, 'heatCycles', `cyc_denied_${R}`), {
      dogId: damId2, tenantId: breederUid, heatNumber: 1, heatStartDate: '2026-01-01',
    })
  } catch (err) { createDenied = isDenied(err) }
  check('2-ServerOnly', 'A direct client heatCycles create is denied even for a fully eligible Dam', createDenied)

  const existingCycleId = `cyc_existing_${R}`
  await adminDb.collection('heatCycles').doc(existingCycleId).set({
    dogId: damId2, tenantId: breederUid, heatNumber: 1, heatStartDate: '2026-01-01',
  })
  let updateDenied = false
  try { await updateDoc(doc(db, 'heatCycles', existingCycleId), { notes: 'edited' }) } catch (err) { updateDenied = isDenied(err) }
  check('2-ServerOnly', 'A direct client heatCycles update is denied too (even a notes-only edit)', updateDenied)
}

// =========================================================================
// SECTION 3 — unrelated-tenant dog: read/delete denied
// =========================================================================
{
  const strangerDamId = `strangerdam_${R}`
  await as('stranger')
  await adminDb.collection('dogs').doc(strangerDamId).set({
    tenantId: strangerUid, currentOwnerId: strangerUid, createdByUserId: strangerUid,
    sourceType: 'BREEDER_ISSUED', name: 'Bella', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const strangerCycleId = `strangercycle_${R}`
  await adminDb.collection('heatCycles').doc(strangerCycleId).set({
    dogId: strangerDamId, tenantId: strangerUid, heatNumber: 1, heatStartDate: '2026-01-01',
  })

  await as('breeder')
  let readDenied = false
  try { await getDoc(doc(db, 'heatCycles', strangerCycleId)) } catch (err) { readDenied = isDenied(err) }
  check('3-UnrelatedTenant', 'A breeder cannot read another tenant\'s Heat Cycle record', readDenied)

  let deleteDenied = false
  try { await deleteDoc(doc(db, 'heatCycles', strangerCycleId)) } catch (err) { deleteDenied = isDenied(err) }
  check('3-UnrelatedTenant', 'A breeder cannot delete another tenant\'s Heat Cycle record', deleteDenied)
}

// =========================================================================
// SECTION 4 — legacy record compatibility: a record written before this
// rule existed (arbitrary field shape) remains readable and deletable —
// but no longer directly EDITABLE by the client (that now requires the
// server endpoint, same as any other heat cycle record).
// =========================================================================
{
  const legacyDamId = `legacydam_${R}`
  await as('breeder')
  await adminDb.collection('dogs').doc(legacyDamId).set({
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Legacy Dam', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const legacyCycleId = `legacycycle_${R}`
  // Minimal legacy shape: no tenantId field on the record itself.
  await adminDb.collection('heatCycles').doc(legacyCycleId).set({ dogId: legacyDamId, heatNumber: 1, heatStartDate: '2020-01-01' })

  let readOk = true
  try { await getDoc(doc(db, 'heatCycles', legacyCycleId)) } catch (err) { readOk = false }
  check('4-Legacy', 'Legacy heat cycle record (no tenantId field) remains readable', readOk)

  let updateDenied = false
  try { await updateDoc(doc(db, 'heatCycles', legacyCycleId), { notes: 'backfilled' }) } catch (err) { updateDenied = isDenied(err) }
  check('4-Legacy', 'Legacy heat cycle record can no longer be edited directly by the client (server endpoint required)', updateDenied)

  let deleteOk = true
  try { await deleteDoc(doc(db, 'heatCycles', legacyCycleId)) } catch { deleteOk = false }
  check('4-Legacy', 'Legacy heat cycle record remains deletable', deleteOk)
}

await summary()
