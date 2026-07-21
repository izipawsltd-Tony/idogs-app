// scripts/test-auditlogs-claimed-dog-scope.mjs — Round 20 follow-up
// regression coverage for the auditLogs read fix in DogDetailPage.tsx.
//
// CONFIRMED ISSUE this exists for: DogDetailPage's main loader and
// retryTimeline() both used to call getAuditLogs(dog.tenantId, dogId) —
// the dog's PERMANENT original-breeder provenance — instead of the
// authenticated viewer's own uid. Once a dog is transferred and claimed,
// tenantId never changes to the new owner (confirmed unchanged by
// scripts/test-claim-transferred-dogs.mjs's "tenantId (original breeder)
// unchanged" assertion), so a query filtered on it was a cross-tenant
// read the auditLogs `list` rule (resource.data.tenantId ==
// request.auth.uid, firestore.rules match /auditLogs/{id}) correctly and
// permanently denies — surfacing as a permanent Timeline
// permission-denied for every claimed dog's new owner, not something
// specific to any one dog's data shape. The fix queries by the viewer's
// own uid instead (matching the existing, already-correct pattern in
// AuditPage.tsx and DashboardPage.tsx).
//
// This file behaviorally proves, against the real emulator rules (not a
// source-pattern check — see test-round16-dogdetail-subordinate-reads.mjs
// SECTION 8 for that companion check that DogDetailPage.tsx's source
// actually calls getAuditLogs with the right argument):
//   1. a transferred+claimed dog's tenantId remains the original breeder's
//      uid (the precondition that makes the old call site always fail);
//   2. the new owner querying with that breeder tenantId is denied
//      (reproducing the exact bug, so a regression back to dog.tenantId
//      would be caught here);
//   3. the new owner querying with their OWN uid succeeds cleanly, with
//      no permission-denied — the fix;
//   4. the breeder's private pre-transfer audit history is never returned
//      by the new owner's own-uid query — the privacy boundary the
//      original design intentionally protects stays intact under the fix,
//      it does not get worked around;
//   5. a life-stage event recorded AFTER the claim (correctly tagged with
//      the new owner's own uid) DOES come back — proving the fix isn't
//      just "always returns nothing", it retrieves real, legitimate data;
//   6. the breeder's own read of their own tenantId-scoped history is
//      unaffected (no regression for the non-claimed, common case);
//   7. an unrelated stranger is denied both ways (tenant isolation,
//      unchanged).
//
// Every fixture here is seeded via the Admin SDK (bypasses rules) since
// seeding a breeder-tenanted auditLogs doc while acting as anyone else is
// exactly what the `create` rule is supposed to prevent — matching the
// established pattern in test-dog-update-legacy-rules.mjs.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-auditlogs-claimed-dog-scope.mjs
//
// If the emulator cannot be started in this environment (e.g. no Java
// runtime), this file cannot be executed and its assertions must not be
// treated as verified.

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, collection, query, where, getDocs } from 'firebase/firestore'
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

import { makeChecker } from './_lib/test-check.mjs'
const { check, summary } = makeChecker()
function isDenied(err) {
  return err && (err.code === 'permission-denied' || /permission/i.test(err.message))
}

const PW = 'tam12345*'
const R = Date.now()
const email = n => `auditscope.${n}.${R}@emulator.local`

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

const dogId = `claimedDog_${R}`

// =========================================================================
// SECTION 1 — seed the exact post-claim shape: tenantId stays the
// breeder's, currentOwnerId is the buyer (mirrors what
// api/claim-transferred-dogs.js actually leaves behind)
// =========================================================================
await adminDb.collection('dogs').doc(dogId).set({
  name: 'Claimed Dog', breed: 'Labrador Retriever', status: 'active',
  dateOfBirth: '2020-01-01',
  tenantId: breederUid, currentOwnerId: buyerUid,
  createdByUserId: breederUid, sourceType: 'BREEDER_ISSUED',
  previousOwnerId: breederUid,
})
{
  const dogAfter = (await adminDb.collection('dogs').doc(dogId).get()).data()
  check('1-Precondition', "Claimed dog's tenantId remains the original breeder's uid", dogAfter.tenantId === breederUid)
  check('1-Precondition', "Claimed dog's currentOwnerId is the new owner (buyer), not the breeder", dogAfter.currentOwnerId === buyerUid)
}

// Pre-transfer audit history — tagged with the BREEDER's tenantId, written
// before the dog was ever transferred. This is exactly what must stay
// private from the new owner.
await adminDb.collection('auditLogs').add({
  tenantId: breederUid, dogId, action: 'life_stage_changed',
  details: 'Puppy -> Adult (pre-transfer, breeder-owned)',
  performedBy: breederUid, createdAt: new Date().toISOString(),
})

// Post-claim audit entry — correctly tagged with the NEW owner's own uid,
// as any write made through the app's own logAudit() would be once the
// buyer is acting as tenant.
await adminDb.collection('auditLogs').add({
  tenantId: buyerUid, dogId, action: 'life_stage_changed',
  details: 'Adult -> Senior (post-claim, new-owner-owned)',
  performedBy: buyerUid, createdAt: new Date().toISOString(),
})

// =========================================================================
// SECTION 2 — the exact bug: new owner querying with the dog's (breeder)
// tenantId is denied. Reproduces what the OLD getAuditLogs(dog.tenantId,
// dogId) call site actually hit in production.
// =========================================================================
await as('buyer')
{
  let denied = false
  try {
    await getDocs(query(collection(db, 'auditLogs'), where('tenantId', '==', breederUid), where('dogId', '==', dogId)))
  } catch (err) { denied = isDenied(err) }
  check('2-OldCallSiteShape', 'New owner querying auditLogs with the BREEDER\'s tenantId (the old dog.tenantId call site) is denied', denied)
}

// =========================================================================
// SECTION 3 — the fix: new owner querying with their OWN uid succeeds,
// with no permission-denied, and returns exactly the post-claim entry —
// never the breeder's pre-transfer one.
// =========================================================================
{
  let snap
  let threw = false
  try {
    snap = await getDocs(query(collection(db, 'auditLogs'), where('tenantId', '==', buyerUid), where('dogId', '==', dogId)))
  } catch { threw = true }
  check('3-Fix', "New owner querying auditLogs with their OWN uid succeeds (no permission-denied)", !threw)
  const docs = threw ? [] : snap.docs.map(d => d.data())
  check('3-Fix', 'Exactly one entry returned (the post-claim one)', docs.length === 1, `got ${docs.length}`)
  check('4-Privacy', "Breeder's pre-transfer entry is NOT included in the new owner's own-uid query", !docs.some(d => d.tenantId === breederUid))
  check('5-RealData', "The returned entry is the genuine post-claim life-stage event, not an empty/fabricated result",
    docs.length === 1 && docs[0].details === 'Adult -> Senior (post-claim, new-owner-owned)')
}

// =========================================================================
// SECTION 6 — breeder's own read of their own tenantId-scoped history is
// unaffected — this fix must not regress the common, non-claimed case.
// =========================================================================
await as('breeder')
{
  let snap
  let threw = false
  try {
    snap = await getDocs(query(collection(db, 'auditLogs'), where('tenantId', '==', breederUid), where('dogId', '==', dogId)))
  } catch { threw = true }
  check('6-BreederUnaffected', 'Breeder querying auditLogs with their own tenantId still succeeds', !threw)
  const docs = threw ? [] : snap.docs.map(d => d.data())
  check('6-BreederUnaffected', 'Breeder sees exactly their own pre-transfer entry', docs.length === 1 && docs[0].tenantId === breederUid)
}

// =========================================================================
// SECTION 7 — unrelated stranger is denied both ways (tenant isolation
// unchanged by this fix)
// =========================================================================
await as('stranger')
{
  let deniedBreederTenant = false
  try {
    await getDocs(query(collection(db, 'auditLogs'), where('tenantId', '==', breederUid), where('dogId', '==', dogId)))
  } catch (err) { deniedBreederTenant = isDenied(err) }
  check('7-StrangerDenied', "Stranger querying with the breeder's tenantId is denied", deniedBreederTenant)

  let deniedOwnUid = false
  try {
    const snap = await getDocs(query(collection(db, 'auditLogs'), where('tenantId', '==', strangerUid), where('dogId', '==', dogId)))
    // Not denied, but must return nothing — the stranger has no auditLogs of their own for this dog.
    deniedOwnUid = snap.size === 0
  } catch (err) { deniedOwnUid = isDenied(err) }
  check('7-StrangerDenied', "Stranger querying with their own uid returns nothing for this dog (no access, no leak)", deniedOwnUid)
}

await summary()
