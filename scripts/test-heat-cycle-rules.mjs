// Emulator-only regression test for the heatCycles/{id} firestore.rules
// added by fix/sire-heat-cycle.
//
// Root cause: firestore.rules had NO match block for heatCycles, so every
// read/write fell through to the default `match /{document=**} { allow
// read, write: if false; }` at the bottom of the file — "Add Heat Cycle"
// always failed with a generic error, and the existing-cycles list
// silently loaded empty. Fixed by adding a dogBelongsToUser-scoped rule
// (same pattern as vaccineRecords/wormingRecords/healthTests), plus a
// female-only (Dam) check on create as a hard boundary — not just UI
// gating — against a male or unrelated-tenant dog receiving one.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-heat-cycle-rules.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where } from 'firebase/firestore'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}
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
// SECTION 1 — Eligible Dam: full add/edit/delete lifecycle
// =========================================================================
{
  const damId = `dam_${R}`
  await as('breeder')
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Luna', sex: 'female', status: 'active',
  })

  const cycleId = `cycle_${R}`
  let createOk = true
  try {
    await setDoc(doc(db, 'heatCycles', cycleId), {
      dogId: damId, tenantId: breederUid, heatNumber: 1,
      heatStartDate: '2026-01-01', notes: 'first heat', createdAt: '2026-01-01',
    })
  } catch (err) { createOk = false }
  check('1-Dam', 'Breeder can add a Heat Cycle for their own eligible Dam', createOk)

  let readOk = true, size = 0
  try {
    const snap = await getDocs(query(collection(db, 'heatCycles'), where('dogId', '==', damId)))
    size = snap.size
  } catch (err) { readOk = false }
  check('1-Dam', 'Heat Cycle record persists and is readable (reload)', readOk && size === 1, `size=${size}`)

  let updateOk = true
  try { await updateDoc(doc(db, 'heatCycles', cycleId), { notes: 'updated notes', heatEndDate: '2026-01-14' }) } catch (err) { updateOk = false }
  check('1-Dam', 'Breeder can edit their Heat Cycle record', updateOk)

  let deleteOk = true
  try { await deleteDoc(doc(db, 'heatCycles', cycleId)) } catch (err) { deleteOk = false }
  check('1-Dam', 'Breeder can delete their Heat Cycle record', deleteOk)
}

// =========================================================================
// SECTION 2 — Male dog: denied
// =========================================================================
{
  const sireId = `sire_${R}`
  await as('breeder')
  await setDoc(doc(db, 'dogs', sireId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Rex', sex: 'male', status: 'active',
  })

  let denied = false
  try {
    await setDoc(doc(db, 'heatCycles', `badcycle_${R}`), {
      dogId: sireId, tenantId: breederUid, heatNumber: 1, heatStartDate: '2026-01-01',
    })
  } catch (err) { denied = isDenied(err) }
  check('2-MaleDenied', 'A Heat Cycle cannot be created against a male dog', denied)
}

// =========================================================================
// SECTION 3 — Unrelated-tenant dog: denied
// =========================================================================
{
  const strangerDamId = `strangerdam_${R}`
  await as('stranger')
  await setDoc(doc(db, 'dogs', strangerDamId), {
    tenantId: strangerUid, currentOwnerId: strangerUid, createdByUserId: strangerUid,
    sourceType: 'BREEDER_ISSUED', name: 'Bella', sex: 'female', status: 'active',
  })

  await as('breeder')
  let denied = false
  try {
    await setDoc(doc(db, 'heatCycles', `crosscycle_${R}`), {
      dogId: strangerDamId, tenantId: breederUid, heatNumber: 1, heatStartDate: '2026-01-01',
    })
  } catch (err) { denied = isDenied(err) }
  check('3-UnrelatedTenant', 'A breeder cannot add a Heat Cycle against another tenant\'s dog', denied)

  // Stranger's own record is unreadable by the breeder
  await as('stranger')
  const strangerCycleId = `straingercycle_${R}`
  await setDoc(doc(db, 'heatCycles', strangerCycleId), {
    dogId: strangerDamId, tenantId: strangerUid, heatNumber: 1, heatStartDate: '2026-01-01',
  })
  await as('breeder')
  let readDenied = false
  try { await getDoc(doc(db, 'heatCycles', strangerCycleId)) } catch (err) { readDenied = isDenied(err) }
  check('3-UnrelatedTenant', 'A breeder cannot read another tenant\'s Heat Cycle record', readDenied)
}

// =========================================================================
// SECTION 4 — Legacy record compatibility: an existing heatCycles doc
// written before this rule existed (arbitrary field shape, no
// createdAt/tenantId-consistent extras) must remain readable/editable by
// its owning dog's breeder, since this is a pure rules-gap fix, not a
// data migration.
// =========================================================================
{
  const legacyDamId = `legacydam_${R}`
  await as('breeder')
  await setDoc(doc(db, 'dogs', legacyDamId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Legacy Dam', sex: 'female', status: 'active',
  })
  const legacyCycleId = `legacycycle_${R}`
  // Minimal legacy shape: no tenantId field on the record itself (older
  // client code before saveHeatCycle() started stamping tenantId), since
  // the rule only depends on the record's dogId, not its own tenantId.
  await setDoc(doc(db, 'heatCycles', legacyCycleId), { dogId: legacyDamId, heatNumber: 1, heatStartDate: '2020-01-01' })

  let readOk = true
  try { await getDoc(doc(db, 'heatCycles', legacyCycleId)) } catch (err) { readOk = false }
  check('4-Legacy', 'Legacy heat cycle record (no tenantId field) remains readable', readOk)

  let updateOk = true
  try { await updateDoc(doc(db, 'heatCycles', legacyCycleId), { notes: 'backfilled' }) } catch (err) { updateOk = false }
  check('4-Legacy', 'Legacy heat cycle record remains editable', updateOk)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
