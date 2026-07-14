// Phase 4 — Firestore Security Access Matrix.
//
// Emulator-only regression test for dog ownership access across the full
// lifecycle: breeder-issued (pre/post transfer/claim), owner-created, and
// related records (documents/vaccines/health/timeline). Verifies both what
// IS allowed (legitimate app flows keep working) and what must be DENIED
// (tenant isolation, immutable provenance fields).
//
// Model under test (ADR-001):
//   tenantId          = immutable issuing context
//   currentOwnerId     = current holder (changed only by the server-side
//                        claim route, which uses the Admin SDK and bypasses
//                        these rules entirely — not exercised here)
//   sourceType         = BREEDER_ISSUED | OWNER_CREATED | IMPORTED
//   createdByUserId    = immutable creator
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-dog-ownership-matrix.mjs

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

// Admin SDK client — genuinely bypasses security rules (matches
// api/claim-transferred-dogs.js's real production behavior), used ONLY to
// simulate the server-side claim reassignment as a test fixture.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' })
const adminDb = getAdminFirestore(adminApp)
async function simulateAdminClaim(dogId, newCurrentOwnerId) {
  await adminDb.collection('dogs').doc(dogId).update({
    currentOwnerId: newCurrentOwnerId,
    status: 'active',
  })
}

let pass = 0, fail = 0
const results = []
function check(section, label, cond, extra = '') {
  const status = cond ? 'PASS' : 'FAIL'
  results.push({ section, label, status })
  console.log(`${status} [${section}] ${label}${extra ? ' — ' + extra : ''}`)
  cond ? pass++ : fail++
}
function isDenied(err) {
  return err && (err.code === 'permission-denied' || /permission/i.test(err.message))
}

const PW = 'tam12345*'
const R = Date.now() // unique per run
const email = n => `matrix.${n}.${R}@emulator.local`

async function newUser(name) {
  const { user } = await createUserWithEmailAndPassword(auth, email(name), PW)
  await signOut(auth)
  return user.uid
}
async function as(name) {
  await signOut(auth).catch(() => {})
  await signInWithEmailAndPassword(auth, email(name), PW)
}

// ── Actors ──
const breederUid = await newUser('breeder')
const newOwnerUid = await newUser('newowner')
const formerOwnerUid = breederUid // alias for readability in the transfer section
const strangerUid = await newUser('stranger')
const ownerCreatorUid = await newUser('ownercreator')
const otherOwnerUid = await newUser('otherowner')

// =========================================================================
// SECTION 1 — Breeder-issued dog (pre-transfer)
// =========================================================================
{
  const dogId = `biDog_${R}`
  await as('breeder')

  // Breeder create
  let createOk = true
  try {
    await setDoc(doc(db, 'dogs', dogId), {
      tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
      sourceType: 'BREEDER_ISSUED', name: 'Rex', status: 'active',
    })
  } catch (err) { createOk = false }
  check('1-BreederIssued', 'Breeder can create a breeder-issued dog', createOk)

  // Breeder read before transfer
  let readOk = true
  try { await getDoc(doc(db, 'dogs', dogId)) } catch (err) { readOk = false }
  check('1-BreederIssued', 'Breeder can read before transfer', readOk)

  // Unrelated user denied read
  await as('stranger')
  let strangerDenied = false
  try { await getDoc(doc(db, 'dogs', dogId)) } catch (err) { strangerDenied = isDenied(err) }
  check('1-BreederIssued', 'Unrelated user denied read', strangerDenied)

  // Unrelated user denied write
  let strangerWriteDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { name: 'Hacked' }) } catch (err) { strangerWriteDenied = isDenied(err) }
  check('1-BreederIssued', 'Unrelated user denied write', strangerWriteDenied)

  // Simulate transfer: breeder marks pendingClaim (currentOwnerId untouched — matches transferDogOwnership())
  await as('breeder')
  let transferMarkOk = true
  try {
    await updateDoc(doc(db, 'dogs', dogId), {
      status: 'transferred', transferStatus: 'pendingClaim',
      buyerEmail: email('newowner'), buyerName: 'New Owner',
    })
  } catch (err) { transferMarkOk = false }
  check('1-BreederIssued', 'Breeder can mark dog pendingClaim (transferDogOwnership shape)', transferMarkOk)

  // Pending recipient (not yet claimed) has NO ownership access yet
  await as('newowner')
  let pendingRecipientDenied = false
  try { await getDoc(doc(db, 'dogs', dogId)) } catch (err) { pendingRecipientDenied = isDenied(err) }
  check('1-BreederIssued', 'Pending recipient gets no premature ownership access', pendingRecipientDenied)

  // Simulate claim exactly as api/claim-transferred-dogs.js does: a
  // server-side Admin SDK write, which genuinely bypasses these rules (real
  // production behavior, not a client update subject to the rules above).
  let claimOk = true
  try { await simulateAdminClaim(dogId, newOwnerUid) } catch (err) { claimOk = false }
  check('1-BreederIssued', 'Test fixture: simulated Admin SDK claim write succeeds', claimOk)

  // Intended current owner can now access
  await as('newowner')
  let newOwnerReadOk = true
  try { await getDoc(doc(db, 'dogs', dogId)) } catch (err) { newOwnerReadOk = false }
  check('1-BreederIssued', 'Intended current owner can access after claim', newOwnerReadOk)

  // Former breeder (no longer currentOwnerId) still has tenantId-based access
  // (by design — tenantId is permanent provenance; getDogs() overrides
  // status to 'transferred' for display, but the read rule itself still
  // allows it since tenantId access was never revoked)
  await as('breeder')
  let formerBreederReadOk = true
  try { await getDoc(doc(db, 'dogs', dogId)) } catch (err) { formerBreederReadOk = false }
  check('1-BreederIssued', 'Former breeder retains tenantId-based read (provenance, by design)', formerBreederReadOk)

  // Former breeder (tenantId only, no longer currentOwnerId) CANNOT perform
  // current-owner-only writes post-claim — tenantId is permanent provenance
  // for read, not an ongoing management right.
  let formerBreederWriteDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { notes: 'former breeder edit' }) } catch (err) { formerBreederWriteDenied = isDenied(err) }
  check('1-BreederIssued', 'Former owner cannot perform current-owner-only writes', formerBreederWriteDenied)
}

// =========================================================================
// SECTION 2 — Owner-created dog
// =========================================================================
{
  const dogId = `ocDog_${R}`
  await as('ownercreator')

  let createOk = true
  try {
    await setDoc(doc(db, 'dogs', dogId), {
      tenantId: ownerCreatorUid, currentOwnerId: ownerCreatorUid, createdByUserId: ownerCreatorUid,
      sourceType: 'OWNER_CREATED', name: 'Bella', status: 'active',
    })
  } catch (err) { createOk = false }
  check('2-OwnerCreated', 'Owner can create their own dog', createOk)

  let readOk = true
  try { await getDoc(doc(db, 'dogs', dogId)) } catch (err) { readOk = false }
  check('2-OwnerCreated', 'Owner can read their own dog', readOk)

  // Client cannot assign arbitrary currentOwnerId at creation
  let arbitraryOwnerDenied = false
  try {
    await setDoc(doc(db, 'dogs', `ocDog_bad1_${R}`), {
      tenantId: ownerCreatorUid, currentOwnerId: strangerUid, createdByUserId: ownerCreatorUid,
      sourceType: 'OWNER_CREATED', name: 'Bad',
    })
  } catch (err) { arbitraryOwnerDenied = isDenied(err) }
  check('2-OwnerCreated', 'Client cannot assign arbitrary currentOwnerId at create', arbitraryOwnerDenied)

  // Client cannot assign arbitrary createdByUserId at creation
  let arbitraryCreatorDenied = false
  try {
    await setDoc(doc(db, 'dogs', `ocDog_bad2_${R}`), {
      tenantId: ownerCreatorUid, currentOwnerId: ownerCreatorUid, createdByUserId: strangerUid,
      sourceType: 'OWNER_CREATED', name: 'Bad',
    })
  } catch (err) { arbitraryCreatorDenied = isDenied(err) }
  check('2-OwnerCreated', 'Client cannot assign arbitrary createdByUserId at create', arbitraryCreatorDenied)

  // Client cannot assign arbitrary tenantId at creation
  let arbitraryTenantDenied = false
  try {
    await setDoc(doc(db, 'dogs', `ocDog_bad3_${R}`), {
      tenantId: strangerUid, currentOwnerId: ownerCreatorUid, createdByUserId: ownerCreatorUid,
      sourceType: 'OWNER_CREATED', name: 'Bad',
    })
  } catch (err) { arbitraryTenantDenied = isDenied(err) }
  check('2-OwnerCreated', 'Client cannot assign arbitrary tenantId at create', arbitraryTenantDenied)

  // Other owners denied
  await as('otherowner')
  let otherOwnerDenied = false
  try { await getDoc(doc(db, 'dogs', dogId)) } catch (err) { otherOwnerDenied = isDenied(err) }
  check('2-OwnerCreated', 'Other owners denied access', otherOwnerDenied)

  // Breeder role alone grants no access (breeder here = the Section 1 breeder actor)
  await as('breeder')
  let breederRoleDenied = false
  try { await getDoc(doc(db, 'dogs', dogId)) } catch (err) { breederRoleDenied = isDenied(err) }
  check('2-OwnerCreated', 'Breeder role alone grants no access to an unrelated owner-created dog', breederRoleDenied)

  // Post-creation: client cannot change tenantId/currentOwnerId/createdByUserId/sourceType via update
  await as('ownercreator')
  let tenantIdImmutable = false
  try { await updateDoc(doc(db, 'dogs', dogId), { tenantId: strangerUid }) } catch (err) { tenantIdImmutable = isDenied(err) }
  check('2-OwnerCreated', 'tenantId immutable via client update', tenantIdImmutable)

  let currentOwnerIdImmutable = false
  try { await updateDoc(doc(db, 'dogs', dogId), { currentOwnerId: strangerUid }) } catch (err) { currentOwnerIdImmutable = isDenied(err) }
  check('2-OwnerCreated', 'currentOwnerId immutable via client update', currentOwnerIdImmutable)

  let createdByImmutable = false
  try { await updateDoc(doc(db, 'dogs', dogId), { createdByUserId: strangerUid }) } catch (err) { createdByImmutable = isDenied(err) }
  check('2-OwnerCreated', 'createdByUserId immutable via client update', createdByImmutable)

  let sourceTypeImmutable = false
  try { await updateDoc(doc(db, 'dogs', dogId), { sourceType: 'BREEDER_ISSUED' }) } catch (err) { sourceTypeImmutable = isDenied(err) }
  check('2-OwnerCreated', 'sourceType immutable via client update', sourceTypeImmutable)

  // Legitimate field update (not touching provenance fields) still works
  let legitUpdateOk = true
  try { await updateDoc(doc(db, 'dogs', dogId), { notes: 'a normal edit' }) } catch (err) { legitUpdateOk = false }
  check('2-OwnerCreated', 'Legitimate non-provenance field update still succeeds', legitUpdateOk)
}

// =========================================================================
// SECTION 3 — Transfer/claim invariants
// =========================================================================
{
  // Client (even the current breeder/owner) cannot directly reassign
  // currentOwnerId themselves — this MUST go through the server-side
  // Admin SDK claim route (api/claim-transferred-dogs.js).
  const dogId = `claimDog_${R}`
  await as('breeder')
  await setDoc(doc(db, 'dogs', dogId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Claimable', status: 'active',
  })

  let breederCannotReassign = false
  try { await updateDoc(doc(db, 'dogs', dogId), { currentOwnerId: newOwnerUid }) } catch (err) { breederCannotReassign = isDenied(err) }
  check('3-Transfer', 'Breeder (current owner) cannot directly reassign currentOwnerId via client', breederCannotReassign)

  // Unrelated user cannot claim (no access to the doc at all pre-claim)
  await as('stranger')
  let strangerCannotClaim = false
  try { await updateDoc(doc(db, 'dogs', dogId), { currentOwnerId: strangerUid }) } catch (err) { strangerCannotClaim = isDenied(err) }
  check('3-Transfer', 'Unrelated user cannot claim/write', strangerCannotClaim)
}

// =========================================================================
// SECTION 4 — Related records (documents/vaccines/health/timeline)
// =========================================================================
{
  const dogId = `relDog_${R}`
  await as('breeder')
  await setDoc(doc(db, 'dogs', dogId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'RecordsDog', status: 'active',
  })

  // documents — created as if by the breeder (matches api/upload-document.js: tenantId = verified uploader)
  await setDoc(doc(db, 'documents', `doc_${R}`), { dogId, tenantId: breederUid, documentType: 'vaccine_card' })
  await setDoc(doc(db, 'vaccineRecords', `vac_${R}`), { dogId, name: 'C5', dateGiven: '2026-01-01' })
  await setDoc(doc(db, 'healthTests', `health_${R}`), { dogId, testType: 'hips' })
  await setDoc(doc(db, 'activityNotes', `note_${R}`), { dogId, note: 'timeline entry', createdBy: breederUid })

  // Breeder (still currentOwnerId) can list all four via the dogId-only
  // query shape the app actually uses (getDogDocuments/getVaccineRecords/
  // getHealthTests/getActivityNotes)
  for (const [col, label] of [['documents', 'documents'], ['vaccineRecords', 'vaccineRecords'], ['healthTests', 'healthTests'], ['activityNotes', 'activityNotes']]) {
    let ok = true, size = 0
    try {
      const snap = await getDocs(query(collection(db, col), where('dogId', '==', dogId)))
      size = snap.size
    } catch (err) { ok = false }
    check('4-RelatedRecords', `Breeder dogId-only list query on ${label} succeeds (app's actual query shape)`, ok && size === 1, `size=${size}`)
  }

  // Simulate claim to newOwner via the Admin SDK (bypasses rules, matching real production behavior)
  await simulateAdminClaim(dogId, newOwnerUid)

  // Claimed current owner can now see the SAME pre-transfer related records
  // (continuity — this is the point of documents now using dogBelongsToUser)
  await as('newowner')
  for (const [col, label] of [['documents', 'documents'], ['vaccineRecords', 'vaccineRecords'], ['healthTests', 'healthTests'], ['activityNotes', 'activityNotes']]) {
    let ok = true, size = 0
    try {
      const snap = await getDocs(query(collection(db, col), where('dogId', '==', dogId)))
      size = snap.size
    } catch (err) { ok = false }
    check('4-RelatedRecords', `New owner sees pre-transfer ${label} after claim (continuity)`, ok && size === 1, `size=${size}`)
  }

  // Unrelated user cannot list any of these
  await as('stranger')
  for (const [col, label] of [['documents', 'documents'], ['vaccineRecords', 'vaccineRecords'], ['healthTests', 'healthTests'], ['activityNotes', 'activityNotes']]) {
    let denied = false
    try {
      await getDocs(query(collection(db, col), where('dogId', '==', dogId)))
    } catch (err) { denied = isDenied(err) }
    check('4-RelatedRecords', `Unrelated user denied list on ${label}`, denied)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
