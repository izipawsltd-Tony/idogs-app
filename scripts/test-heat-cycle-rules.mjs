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
// Section 5 covers a follow-up bug: My Dogs showed 1 valid Sire while the
// Heat Cycle Sire dropdown showed 3, because the dropdown's data source
// used a raw tenantId-only query that sees a transferred dog's *stale*
// status field (api/claim-transferred-dogs.js resets status back to
// 'active' on claim). heatCycleSireValid()/isEligibleSire() in
// firestore.rules now independently re-validates sireId against live
// currentOwnerId at save time — the save path can no longer be tricked
// by a stale client-side dropdown regardless of what the UI filter does.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-heat-cycle-rules.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where } from 'firebase/firestore'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

// Admin SDK client — genuinely bypasses security rules, used ONLY to
// simulate the server-side claim reassignment (api/claim-transferred-
// dogs.js) as a test fixture, matching test-dog-ownership-matrix.mjs.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' })
const adminDb = getAdminFirestore(adminApp)
async function simulateAdminClaim(dogId, newCurrentOwnerId) {
  await adminDb.collection('dogs').doc(dogId).update({ currentOwnerId: newCurrentOwnerId, status: 'active' })
}

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

// =========================================================================
// SECTION 5 — sireId save-path validation (independent of the client's
// own dropdown filtering)
// =========================================================================
{
  const damId = `dam5_${R}`
  await as('breeder')
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam Five', sex: 'female', status: 'active',
  })

  // A currently-eligible sire
  const validSireId = `validsire_${R}`
  await setDoc(doc(db, 'dogs', validSireId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Valid Sire', sex: 'male', status: 'active',
  })
  let validSireOk = true
  try {
    await setDoc(doc(db, 'heatCycles', `cyc_valid_${R}`), {
      dogId: damId, tenantId: breederUid, heatNumber: 1, heatStartDate: '2026-01-01', sireId: validSireId,
    })
  } catch (err) { validSireOk = false }
  check('5-SireValidation', 'A Heat Cycle can be saved with a valid, currently-owned Sire', validSireOk)

  // A "stale"/transferred sire: tenantId still breeder (permanent
  // provenance) but currentOwnerId has moved to a buyer — exactly the
  // shape api/claim-transferred-dogs.js produces post-claim. A client can
  // never create a dog with someone else's currentOwnerId directly (see
  // dogs/{dogId}'s own create rule), so this is simulated via the Admin
  // SDK claim route exactly like production, not a direct client setDoc.
  const buyerUid = await newUser('buyer5')
  await as('breeder')
  const transferredSireId = `transferredsire_${R}`
  await setDoc(doc(db, 'dogs', transferredSireId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Transferred Sire', sex: 'male', status: 'active',
  })
  await simulateAdminClaim(transferredSireId, buyerUid)
  let transferredDenied = false
  try {
    await setDoc(doc(db, 'heatCycles', `cyc_transferred_${R}`), {
      dogId: damId, tenantId: breederUid, heatNumber: 2, heatStartDate: '2026-02-01', sireId: transferredSireId,
    })
  } catch (err) { transferredDenied = isDenied(err) }
  check('5-SireValidation', 'A transferred (stale currentOwnerId) Sire is rejected even though tenantId still matches', transferredDenied)

  // A wrong-tenant sire (never belonged to this breeder at all)
  const strangerSireId = `strangersire_${R}`
  await as('stranger')
  await setDoc(doc(db, 'dogs', strangerSireId), {
    tenantId: strangerUid, currentOwnerId: strangerUid, createdByUserId: strangerUid,
    sourceType: 'BREEDER_ISSUED', name: 'Stranger Sire', sex: 'male', status: 'active',
  })
  await as('breeder')
  let wrongTenantDenied = false
  try {
    await setDoc(doc(db, 'heatCycles', `cyc_wrongtenant_${R}`), {
      dogId: damId, tenantId: breederUid, heatNumber: 3, heatStartDate: '2026-03-01', sireId: strangerSireId,
    })
  } catch (err) { wrongTenantDenied = isDenied(err) }
  check('5-SireValidation', 'A wrong-tenant Sire is rejected', wrongTenantDenied)

  // A deceased sire (still owned by this breeder, but not breedable)
  const deceasedSireId = `deceasedsire_${R}`
  await setDoc(doc(db, 'dogs', deceasedSireId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Deceased Sire', sex: 'male', status: 'active', isDeceased: true,
  })
  let deceasedDenied = false
  try {
    await setDoc(doc(db, 'heatCycles', `cyc_deceased_${R}`), {
      dogId: damId, tenantId: breederUid, heatNumber: 4, heatStartDate: '2026-04-01', sireId: deceasedSireId,
    })
  } catch (err) { deceasedDenied = isDenied(err) }
  check('5-SireValidation', 'A deceased Sire is rejected', deceasedDenied)

  // A malformed/stale sireId — points at nothing
  let malformedDenied = false
  try {
    await setDoc(doc(db, 'heatCycles', `cyc_malformed_${R}`), {
      dogId: damId, tenantId: breederUid, heatNumber: 5, heatStartDate: '2026-05-01', sireId: `nonexistent_${R}`,
    })
  } catch (err) { malformedDenied = isDenied(err) }
  check('5-SireValidation', 'A malformed/stale sireId pointing at no document is rejected', malformedDenied)

  // Editing an existing (valid, sireId-less) Heat Cycle to attach a stale
  // sireId must be rejected on update too, not just create.
  const editableCycleId = `cyc_editable_${R}`
  await setDoc(doc(db, 'heatCycles', editableCycleId), {
    dogId: damId, tenantId: breederUid, heatNumber: 6, heatStartDate: '2026-06-01',
  })
  let updateStaleDenied = false
  try {
    await updateDoc(doc(db, 'heatCycles', editableCycleId), { sireId: transferredSireId })
  } catch (err) { updateStaleDenied = isDenied(err) }
  check('5-SireValidation', 'Updating an existing Heat Cycle to a stale Sire is rejected', updateStaleDenied)

  // A manually-entered external sire (no sireId at all) is unaffected —
  // sireId is optional and only validated when present.
  let externalSireOk = true
  try {
    await setDoc(doc(db, 'heatCycles', `cyc_external_${R}`), {
      dogId: damId, tenantId: breederUid, heatNumber: 7, heatStartDate: '2026-07-01',
      sireName: 'CH External Dog', sireReg: '2100999999',
    })
  } catch (err) { externalSireOk = false }
  check('5-SireValidation', 'A manually-entered external sire (no sireId) is unaffected by Sire validation', externalSireOk)
}

// =========================================================================
// SECTION 6 — litters.damId save-path validation (Create Litter Dam
// selector consistency follow-up)
// =========================================================================
{
  await as('breeder')

  // A currently-eligible dam
  const validDamId = `validdam_${R}`
  await setDoc(doc(db, 'dogs', validDamId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Valid Dam', sex: 'female', status: 'active',
  })
  let validDamOk = true
  try {
    await setDoc(doc(db, 'litters', `litter_valid_${R}`), { tenantId: breederUid, damId: validDamId, name: 'Litter A', puppyIds: [] })
  } catch (err) { validDamOk = false }
  check('6-DamValidation', 'A litter can be created with a valid, currently-owned Dam', validDamOk)

  // A transferred (stale currentOwnerId) dam — same post-claim shape as
  // the Sire case above.
  const buyerUid6 = await newUser('buyer6')
  await as('breeder')
  const transferredDamId = `transferreddam_${R}`
  await setDoc(doc(db, 'dogs', transferredDamId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Transferred Dam', sex: 'female', status: 'active',
  })
  await simulateAdminClaim(transferredDamId, buyerUid6)
  let transferredDamDenied = false
  try {
    await setDoc(doc(db, 'litters', `litter_transferred_${R}`), { tenantId: breederUid, damId: transferredDamId, name: 'Litter B', puppyIds: [] })
  } catch (err) { transferredDamDenied = isDenied(err) }
  check('6-DamValidation', 'A transferred (stale currentOwnerId) Dam is rejected even though tenantId still matches', transferredDamDenied)

  // A wrong-tenant dam
  const strangerDamId6 = `strangerdam6_${R}`
  await as('stranger')
  await setDoc(doc(db, 'dogs', strangerDamId6), {
    tenantId: strangerUid, currentOwnerId: strangerUid, createdByUserId: strangerUid,
    sourceType: 'BREEDER_ISSUED', name: 'Stranger Dam', sex: 'female', status: 'active',
  })
  await as('breeder')
  let wrongTenantDamDenied = false
  try {
    await setDoc(doc(db, 'litters', `litter_wrongtenant_${R}`), { tenantId: breederUid, damId: strangerDamId6, name: 'Litter C', puppyIds: [] })
  } catch (err) { wrongTenantDamDenied = isDenied(err) }
  check('6-DamValidation', 'A wrong-tenant Dam is rejected', wrongTenantDamDenied)

  // A male dog used as damId
  const maleAsDamId = `maleasdam_${R}`
  await setDoc(doc(db, 'dogs', maleAsDamId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Male Dog', sex: 'male', status: 'active',
  })
  let maleDamDenied = false
  try {
    await setDoc(doc(db, 'litters', `litter_male_${R}`), { tenantId: breederUid, damId: maleAsDamId, name: 'Litter D', puppyIds: [] })
  } catch (err) { maleDamDenied = isDenied(err) }
  check('6-DamValidation', 'A male dog cannot be submitted as damId', maleDamDenied)

  // A malformed/stale damId — points at nothing
  let malformedDamDenied = false
  try {
    await setDoc(doc(db, 'litters', `litter_malformed_${R}`), { tenantId: breederUid, damId: `nonexistent_${R}`, name: 'Litter E', puppyIds: [] })
  } catch (err) { malformedDamDenied = isDenied(err) }
  check('6-DamValidation', 'A malformed/stale damId pointing at no document is rejected', malformedDamDenied)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
