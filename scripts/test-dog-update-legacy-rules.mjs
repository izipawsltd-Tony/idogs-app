// scripts/test-dog-update-legacy-rules.mjs — Round 20 regression coverage
// for the dogs/{dogId} `allow update` rule fix in firestore.rules
// (isEffectiveDogOwner / dogProtectedFieldsUnchanged).
//
// CONFIRMED PRODUCTION INCIDENT this exists for: a legacy dog document
// with tenantId + currentOwnerId present but createdByUserId AND
// sourceType genuinely missing (never written — pre-dates those fields)
// hit a Rules runtime error on the OLD rule, which did
// `request.resource.data.createdByUserId == resource.data.createdByUserId`
// — direct dot-access on a key that doesn't exist on either side throws,
// and Firestore treats a thrown rule as a deny. So Transfer Ownership
// failed on the very first client write, before any transfer field,
// email, or audit record was ever created. Section 4 below is the exact
// shape of that incident.
//
// Every fixture here is seeded via the Admin SDK (bypasses rules
// entirely) specifically so a genuinely legacy-shaped document — missing
// fields the CREATE rule would itself reject — can exist in the emulator
// at all, matching how these documents actually got into production:
// written before the fields/rules in question existed, not created
// through today's rules.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-dog-update-legacy-rules.mjs
//
// If the emulator cannot be started in this environment (e.g. no Java
// runtime), this file cannot be executed and its assertions must not be
// treated as verified — see the Round 20 report for the concrete error
// this repo's environment produced (`firebase emulators:start` fails
// with "Could not spawn `java -version`").

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, updateDoc, deleteField } from 'firebase/firestore'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const app = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

// Admin SDK client — genuinely bypasses security rules, used ONLY to seed
// fixtures (including legacy shapes the client CREATE rule would itself
// reject), matching the pattern in scripts/test-dog-ownership-matrix.mjs.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminApp = initAdminApp({ projectId: 'demo-idogs-qa' })
const adminDb = getAdminFirestore(adminApp)
async function seedDog(dogId, data) {
  await adminDb.collection('dogs').doc(dogId).set(data)
}

import { makeChecker } from './_lib/test-check.mjs'
const { check, summary } = makeChecker()
function isDenied(err) {
  return err && (err.code === 'permission-denied' || /permission/i.test(err.message))
}

const PW = 'tam12345*'
const R = Date.now()
const email = n => `legacy.${n}.${R}@emulator.local`

async function newUser(name) {
  const { user } = await createUserWithEmailAndPassword(auth, email(name), PW)
  await signOut(auth)
  return user.uid
}
async function as(name) {
  await signOut(auth).catch(() => {})
  await signInWithEmailAndPassword(auth, email(name), PW)
}

const ownerUid = await newUser('owner')
const buyerUid = await newUser('buyer')
const strangerUid = await newUser('stranger')
await newUser('buyeremailuser')

const baseFields = { name: 'TestDog', status: 'active', dateOfBirth: '2020-01-01' }

// =========================================================================
// SECTION 1 — modern complete dog: owner update allowed
// =========================================================================
{
  const dogId = `modern_${R}`
  await seedDog(dogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: ownerUid, createdByUserId: ownerUid, sourceType: 'BREEDER_ISSUED',
  })
  await as('owner')
  let ok = true
  try { await updateDoc(doc(db, 'dogs', dogId), { name: 'TestDog Updated' }) } catch { ok = false }
  check('1-Modern', 'Modern complete dog: owner update allowed', ok)
}

// =========================================================================
// SECTION 2 — missing createdByUserId: allowed when untouched
// =========================================================================
{
  const dogId = `noCreatedBy_${R}`
  await seedDog(dogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: ownerUid, sourceType: 'BREEDER_ISSUED',
    // createdByUserId intentionally absent
  })
  await as('owner')
  let ok = true
  try { await updateDoc(doc(db, 'dogs', dogId), { name: 'Updated' }) } catch { ok = false }
  check('2-MissingCreatedByUserId', 'Missing createdByUserId: allowed when untouched', ok)
}

// =========================================================================
// SECTION 3 — missing sourceType: allowed when untouched
// =========================================================================
{
  const dogId = `noSourceType_${R}`
  await seedDog(dogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: ownerUid, createdByUserId: ownerUid,
    // sourceType intentionally absent
  })
  await as('owner')
  let ok = true
  try { await updateDoc(doc(db, 'dogs', dogId), { name: 'Updated' }) } catch { ok = false }
  check('3-MissingSourceType', 'Missing sourceType: allowed when untouched', ok)
}

// =========================================================================
// SECTION 4 — missing BOTH provenance fields: allowed when untouched
// (exact shape of the confirmed production incident)
// =========================================================================
{
  const dogId = `noProvenance_${R}`
  await seedDog(dogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: ownerUid,
    // createdByUserId AND sourceType both intentionally absent
  })
  await as('owner')
  let ok = true
  try { await updateDoc(doc(db, 'dogs', dogId), { name: 'Updated' }) } catch { ok = false }
  check('4-MissingBothProvenance', 'Missing both createdByUserId+sourceType: allowed when untouched (confirmed incident shape)', ok)
}

// =========================================================================
// SECTION 5 — missing currentOwnerId with valid tenantId fallback: allowed
// =========================================================================
{
  const dogId = `noCurrentOwner_${R}`
  await seedDog(dogId, {
    ...baseFields,
    tenantId: ownerUid,
    // currentOwnerId intentionally absent — true legacy, pre-dates the field
  })
  await as('owner') // owner uid == tenantId
  let ok = true
  try { await updateDoc(doc(db, 'dogs', dogId), { name: 'Updated' }) } catch { ok = false }
  check('5-TenantIdFallback', 'Missing currentOwnerId with valid tenantId fallback: allowed', ok)
}

// =========================================================================
// SECTION 6 — missing BOTH ownership identifiers: denied
// =========================================================================
{
  const dogId = `noIdentifiers_${R}`
  await seedDog(dogId, {
    ...baseFields,
    // tenantId AND currentOwnerId both intentionally absent — no signal identifies anyone
  })
  await as('owner')
  let denied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { name: 'Updated' }) } catch (err) { denied = isDenied(err) }
  check('6-NoIdentifiers', 'Missing both ownership identifiers: denied', denied)
}

// =========================================================================
// SECTION 7 — cross-tenant and former owner: denied
// =========================================================================
{
  const dogId = `transferred_${R}`
  await seedDog(dogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: buyerUid, createdByUserId: ownerUid, sourceType: 'BREEDER_ISSUED',
  })

  // Former owner: tenantId still matches them, but currentOwnerId has
  // moved on — no fallback applies once currentOwnerId is present.
  await as('owner')
  let formerOwnerDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { name: 'Updated' }) } catch (err) { formerOwnerDenied = isDenied(err) }
  check('7-FormerOwner', 'Former owner (tenantId matches, currentOwnerId moved on): denied', formerOwnerDenied)

  // True cross-tenant stranger: matches neither field at all.
  await as('stranger')
  let strangerDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { name: 'Updated' }) } catch (err) { strangerDenied = isDenied(err) }
  check('7-CrossTenant', 'Cross-tenant stranger (matches neither field): denied', strangerDenied)
}

// =========================================================================
// SECTION 8 — change tenantId/currentOwnerId: denied
// =========================================================================
{
  const dogId = `protectCore_${R}`
  await seedDog(dogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: ownerUid, createdByUserId: ownerUid, sourceType: 'BREEDER_ISSUED',
  })
  await as('owner')

  let tenantIdDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { tenantId: strangerUid }) } catch (err) { tenantIdDenied = isDenied(err) }
  check('8-ProtectedCore', 'Legitimate owner changing tenantId: denied', tenantIdDenied)

  let currentOwnerIdDenied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { currentOwnerId: strangerUid }) } catch (err) { currentOwnerIdDenied = isDenied(err) }
  check('8-ProtectedCore', 'Legitimate owner changing currentOwnerId: denied', currentOwnerIdDenied)
}

// =========================================================================
// SECTION 9 — add/change/remove createdByUserId or sourceType: denied
// (the specific gap that made the old rule throw instead of deny cleanly)
// =========================================================================
{
  // 9a — ADD onto a legacy dog missing it (even to the owner's own correct
  // uid — adding a provenance field at all via a normal update is denied,
  // not just adding a WRONG value).
  const addDogId = `addProvenance_${R}`
  await seedDog(addDogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: ownerUid, sourceType: 'BREEDER_ISSUED',
    // createdByUserId intentionally absent
  })
  await as('owner')
  let addDenied = false
  try { await updateDoc(doc(db, 'dogs', addDogId), { createdByUserId: ownerUid }) } catch (err) { addDenied = isDenied(err) }
  check('9-AddProvenance', 'Adding missing createdByUserId via normal client update: denied', addDenied)

  // 9b/9c — CHANGE an existing value
  const changeDogId = `changeProvenance_${R}`
  await seedDog(changeDogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: ownerUid, createdByUserId: ownerUid, sourceType: 'BREEDER_ISSUED',
  })
  await as('owner')
  let changeCreatedByDenied = false
  try { await updateDoc(doc(db, 'dogs', changeDogId), { createdByUserId: strangerUid }) } catch (err) { changeCreatedByDenied = isDenied(err) }
  check('9-ChangeProvenance', 'Changing existing createdByUserId: denied', changeCreatedByDenied)

  let changeSourceTypeDenied = false
  try { await updateDoc(doc(db, 'dogs', changeDogId), { sourceType: 'OWNER_CREATED' }) } catch (err) { changeSourceTypeDenied = isDenied(err) }
  check('9-ChangeProvenance', 'Changing existing sourceType: denied', changeSourceTypeDenied)

  // 9d/9e — REMOVE an existing value via the deleteField() sentinel
  let removeCreatedByDenied = false
  try { await updateDoc(doc(db, 'dogs', changeDogId), { createdByUserId: deleteField() }) } catch (err) { removeCreatedByDenied = isDenied(err) }
  check('9-RemoveProvenance', 'Removing existing createdByUserId (deleteField): denied', removeCreatedByDenied)

  let removeSourceTypeDenied = false
  try { await updateDoc(doc(db, 'dogs', changeDogId), { sourceType: deleteField() }) } catch (err) { removeSourceTypeDenied = isDenied(err) }
  check('9-RemoveProvenance', 'Removing existing sourceType (deleteField): denied', removeSourceTypeDenied)
}

// =========================================================================
// SECTION 10 — ordinary unrelated owner update: allowed
// =========================================================================
{
  const dogId = `ordinaryUpdate_${R}`
  await seedDog(dogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: ownerUid, createdByUserId: ownerUid, sourceType: 'BREEDER_ISSUED',
  })
  await as('owner')
  let ok = true
  try { await updateDoc(doc(db, 'dogs', dogId), { notes: 'a normal edit', weight: 12.5 }) } catch { ok = false }
  check('10-OrdinaryUpdate', 'Ordinary unrelated-field owner update still succeeds', ok)
}

// =========================================================================
// SECTION 11 — buyer email alone grants no write access
// =========================================================================
{
  const dogId = `buyerEmailOnly_${R}`
  await seedDog(dogId, {
    ...baseFields,
    tenantId: ownerUid, currentOwnerId: ownerUid, createdByUserId: ownerUid, sourceType: 'BREEDER_ISSUED',
    status: 'transferred', transferStatus: 'pendingClaim',
    buyerEmail: email('buyeremailuser'),
    buyerName: 'Buyer Email User',
  })
  // Signed in as the user whose OWN account email is IDENTICAL to this
  // dog's buyerEmail field — but whose uid is neither tenantId nor
  // currentOwnerId. Authorization must come from currentOwnerId/tenantId
  // uid matches only, never from an email-string coincidence.
  await as('buyeremailuser')
  let denied = false
  try { await updateDoc(doc(db, 'dogs', dogId), { notes: 'trying as buyer before claim' }) } catch (err) { denied = isDenied(err) }
  check('11-BuyerEmailAlone', 'Matching buyerEmail alone (not yet claimed) grants no write access', denied)
}

await summary()
