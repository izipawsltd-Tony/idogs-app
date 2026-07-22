// Emulator-only regression test for litter-delete puppy-cleanup safety
// (fix/sire-heat-cycle, Codex re-review v2 — "Safe litter deletion").
//
// Root cause history: handleDeleteLitter() in LittersPage.tsx used to
// only deleteDoc() the litters/{id} document itself. Then it deleted
// eligible puppies too but trusted litter.puppyIds alone (a legacy dog
// with no litterId was assumed to be a member). This version tightens
// that: a dog only counts as a CONFIRMED member of a litter if its own
// litterId explicitly agrees — a legacy dog with no litterId at all is
// AMBIGUOUS and left completely untouched, never assumed eligible on
// the strength of the litter's forward reference alone. A confirmed
// member is only eligible for deletion if it's still exclusively
// breeder-controlled: currentOwnerId matches the requester, it isn't
// mid-transfer (covers both the current transferStatus='pendingClaim'
// marking and the legacy status-only marking), and it has never been
// through a transfer at all (buyerEmail is permanent ownership-history
// provenance). firestore.rules independently denies deleting any dog
// that's mid-transfer, regardless of what client logic decides.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-litter-delete-cleanup.mjs

import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
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

// Mirrors api/_lib/litter-eligibility.js's partitionLitterCandidatesServer
// exact candidate-filtering logic against already-fetched snapshots.
// Codex round 3, Blocker 4 / round 4, Blocker 5: history is checked
// across ALL of buyerEmail/previousOwnerId/transferredAt/claimedAt/
// claimedBy — not buyerEmail alone.
function computeEligible(freshLitterId, fetched, requesterUid) {
  const confirmedMembers = fetched.filter(d => d.litterId === freshLitterId)
  const ambiguousCount = fetched.length - confirmedMembers.length
  const eligible = confirmedMembers.filter(d =>
    d.currentOwnerId === requesterUid &&
    d.status !== 'transferred' && d.transferStatus !== 'pendingClaim' &&
    !d.buyerEmail && !d.previousOwnerId && !d.transferredAt && !d.claimedAt && !d.claimedBy
  )
  const preserved = confirmedMembers.length - eligible.length
  return { confirmedMembers, ambiguousCount, eligible, preserved }
}

// Codex round 4, Blocker 3: litters delete moved entirely server-side —
// firestore.rules denies a direct client delete unconditionally, so
// every "delete this litter" call in this file below now goes through
// this Admin SDK mirror of api/delete-litter.js's own transaction
// (bypasses Rules exactly as the real endpoint does) instead of a client
// writeBatch. The endpoint always decides its OWN eligible set from
// litter.puppyIds via computeEligible — it never trusts a client-
// supplied list of "which dogs to delete", which is what makes
// Section 2 below ("a batch with an unauthorized dog") structurally
// impossible to construct through the real endpoint any more (see that
// section's own updated comment).
async function deleteLitterServer(litterId, requesterUid) {
  const litterRef = adminDb.collection('litters').doc(litterId)
  return adminDb.runTransaction(async (tx) => {
    const litterSnap = await tx.get(litterRef)
    if (!litterSnap.exists) return { deletedCount: 0, notFound: true }
    const litter = litterSnap.data()
    if (litter.tenantId !== requesterUid) throw new Error('NOT_YOUR_LITTER')
    const puppyIds = litter.puppyIds || []
    const candidateSnaps = await Promise.all(puppyIds.map(id => tx.get(adminDb.collection('dogs').doc(id))))
    const fetched = candidateSnaps.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }))
    const { eligible, preserved } = computeEligible(litterId, fetched, requesterUid)
    tx.delete(litterRef)
    for (const puppy of eligible) tx.delete(adminDb.collection('dogs').doc(puppy.id))
    return { deletedCount: eligible.length, preservedCount: preserved }
  })
}

const breederUid = await newUser('breeder')
const buyerUid = await newUser('buyer')
const strangerUid = await newUser('stranger')

// =========================================================================
// SECTION 1 — Delete litter removes exact-match eligible puppies,
// preserves a transferred one, leaves an unrelated dog untouched
// =========================================================================
{
  await as('breeder')
  const damId = `dam_${R}`
  await setDoc(doc(db, 'dogs', damId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId = `litter_${R}`
  await adminDb.collection('litters').doc(litterId).set({
    tenantId: breederUid, damId, name: 'Test Litter', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [`p1_${R}`, `p2_${R}`, `p3_${R}`],
  })
  // p1, p2: confirmed members, still fully breeder-controlled
  await setDoc(doc(db, 'dogs', `p1_${R}`), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Pup1', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  await setDoc(doc(db, 'dogs', `p2_${R}`), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Pup2', sex: 'female', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  // p3: confirmed member, but transferred to a buyer — must be preserved
  await setDoc(doc(db, 'dogs', `p3_${R}`), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Pup3', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId,
  })
  await adminDb.collection('dogs').doc(`p3_${R}`).update({ currentOwnerId: buyerUid, status: 'active' })
  // Unrelated dog — never part of this litter
  const unrelatedId = `unrelated_${R}`
  await setDoc(doc(db, 'dogs', unrelatedId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Unrelated', sex: 'male', status: 'active', dateOfBirth: '2020-01-01',
  })

  // p3 is NOT passed here — delete-litter.js decides its own eligible
  // set from litter.puppyIds + computeEligible, it never trusts a
  // caller-supplied list, so it correctly excludes p3 (transferred) on
  // its own.
  let deleteOk = true
  try { await deleteLitterServer(litterId, breederUid) } catch (err) { deleteOk = false }
  check('1-Delete', 'Litter delete (litter + 2 eligible puppies, p3 correctly self-excluded) succeeds', deleteOk)

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
// SECTION 2 — Self-computed eligibility: Codex round 4, Blocker 3 moved
// litter deletion server-side, where the endpoint ALWAYS derives its own
// eligible set from litter.puppyIds + computeEligible — it never accepts
// a caller-supplied list of "which dogs to delete" the way a client
// writeBatch could. This makes the round-3 "a batch with an unauthorized
// dog wrongly included" scenario structurally impossible to construct
// through the real endpoint any more: even if a litter's puppyIds
// erroneously lists a stranger's dog (a data-corruption scenario), the
// endpoint's own currentOwnerId check excludes it automatically, and the
// litter + the genuinely-eligible puppy still delete correctly — a
// false-positive entry in puppyIds can never block or corrupt the rest
// of the operation.
// =========================================================================
{
  await as('breeder')
  const damId2 = `dam2_${R}`
  await setDoc(doc(db, 'dogs', damId2), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam2', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId2 = `litter2_${R}`
  await setDoc(doc(db, 'dogs', `ap1_${R}`), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'AtomicPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId: litterId2,
  })
  // A stranger's dog, erroneously listed in this litter's puppyIds
  // (simulates a data-corruption bug — e.g. a stale puppyIds entry
  // pointing at a dog that was never actually this breeder's own).
  await as('stranger')
  const strangerDogId = `strangerdog_${R}`
  await setDoc(doc(db, 'dogs', strangerDogId), {
    tenantId: strangerUid, currentOwnerId: strangerUid, createdByUserId: strangerUid,
    sourceType: 'BREEDER_ISSUED', name: 'StrangerDog', sex: 'male', status: 'active', dateOfBirth: '2020-01-01',
  })

  await as('breeder')
  await adminDb.collection('litters').doc(litterId2).set({
    tenantId: breederUid, damId: damId2, name: 'Atomicity Litter', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [`ap1_${R}`, strangerDogId],
  })

  let deleteOk = true
  let outcome
  try { outcome = await deleteLitterServer(litterId2, breederUid) } catch (err) { deleteOk = false }
  check('2-Atomicity', 'The litter still deletes successfully despite the corrupted puppyIds entry', deleteOk)
  check('2-Atomicity', 'Exactly the one genuinely-eligible puppy was deleted (the stranger\'s dog was never counted)', outcome?.deletedCount === 1)

  const litterGone = await safeGetDoc(doc(db, 'litters', litterId2))
  check('2-Atomicity', 'The litter document is deleted', !litterGone.exists())
  const puppyGone = await safeGetDoc(doc(db, 'dogs', `ap1_${R}`))
  check('2-Atomicity', 'The genuinely-eligible puppy is deleted', !puppyGone.exists())
  // Codex round 6 fix: the caller is signed in as 'breeder' here, and
  // firestore.rules correctly denies a breeder reading a stranger's own
  // dog directly — safeGetDoc's permission-denied fallback previously
  // made this assert "gone" for the WRONG reason (an access denial, not
  // a genuine deletion check). Use the Admin SDK (bypasses Rules) to
  // verify existence directly — what this check actually cares about is
  // whether the DOCUMENT survives, not who's allowed to read it.
  const strangerDogSnap = await adminDb.collection('dogs').doc(strangerDogId).get()
  check('2-Atomicity', "The stranger's own dog was never touched, despite being listed in puppyIds", strangerDogSnap.exists)
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
  await adminDb.collection('litters').doc(litterId3).set({
    tenantId: breederUid, damId: damId3, name: 'Empty Litter', notes: '', puppyIds: [],
  })
  let ok = true
  try { await deleteLitterServer(litterId3, breederUid) } catch { ok = false }
  check('3-EmptyLitter', 'A planned litter with zero puppies deletes cleanly', ok)
}

// =========================================================================
// SECTION 4 — litterId cross-check: a dog erroneously listed in this
// litter's puppyIds (a data-corruption scenario) but whose OWN litterId
// back-reference points at a DIFFERENT litter must be preserved, never
// deleted and never counted as eligible ("same owner but different
// litter remains untouched").
// =========================================================================
{
  await as('breeder')
  const damId4 = `dam4_${R}`
  await setDoc(doc(db, 'dogs', damId4), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam4', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const otherLitterId = `otherlitter_${R}`
  const thisLitterId = `thislitter_${R}`
  const crossLinkedPupId = `crosslinked_${R}`
  // This puppy genuinely belongs to otherLitterId (its own litterId says so)
  await setDoc(doc(db, 'dogs', crossLinkedPupId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'CrossLinkedPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
    litterId: otherLitterId,
  })
  // ...but thisLitterId's own puppyIds array ALSO (erroneously) lists it
  await adminDb.collection('litters').doc(thisLitterId).set({
    tenantId: breederUid, damId: damId4, name: 'This Litter', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [crossLinkedPupId],
  })

  const litterSnap = await getDoc(doc(db, 'litters', thisLitterId))
  const candidateSnaps = await Promise.all((litterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const fetched = candidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { confirmedMembers, eligible } = computeEligible(thisLitterId, fetched, breederUid)
  check('4-CrossLinkGuard', 'A dog whose litterId points elsewhere is excluded from litter membership entirely', confirmedMembers.length === 0)
  check('4-CrossLinkGuard', 'A dog whose litterId points elsewhere is never in the eligible-for-deletion set', eligible.length === 0)

  await deleteLitterServer(thisLitterId, breederUid)
  const pupStillThere = await safeGetDoc(doc(db, 'dogs', crossLinkedPupId))
  check('4-CrossLinkGuard', 'The cross-linked puppy (belongs to a different litter) survives the delete untouched', pupStillThere.exists() && pupStillThere.data().litterId === otherLitterId)
}

// =========================================================================
// SECTION 5 — ambiguous legacy dogs (no litterId at all) are NEVER
// assumed eligible, even when genuinely listed in puppyIds — "preserve
// ambiguous legacy dogs." Also covers a plain same-tenant standalone dog
// (no litterId, not listed anywhere) staying untouched.
// =========================================================================
{
  await as('breeder')
  const damId5 = `dam5b_${R}`
  await setDoc(doc(db, 'dogs', damId5), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam5b', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const legacyPupId = `legacypup5_${R}`
  // A legacy puppy: genuinely listed in this litter's puppyIds, but
  // predates the litterId field — no way to CONFIRM membership from its
  // own record.
  await setDoc(doc(db, 'dogs', legacyPupId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'LegacyPup', sex: 'male', status: 'active', dateOfBirth: '2020-06-01',
    // no litterId field at all
  })
  const litterId5 = `litter5b_${R}`
  await adminDb.collection('litters').doc(litterId5).set({
    tenantId: breederUid, damId: damId5, name: 'Litter5b', notes: '', actualBirthDate: '2020-06-01', puppyIds: [legacyPupId],
  })

  const litterSnap = await getDoc(doc(db, 'litters', litterId5))
  const candidateSnaps = await Promise.all((litterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const fetched = candidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { confirmedMembers, ambiguousCount, eligible } = computeEligible(litterId5, fetched, breederUid)
  check('5-AmbiguousLegacy', 'A puppy with no litterId is NOT a confirmed member even though genuinely listed in puppyIds', confirmedMembers.length === 0)
  check('5-AmbiguousLegacy', 'It is counted as ambiguous, not silently dropped or silently included', ambiguousCount === 1)
  check('5-AmbiguousLegacy', 'It is never in the eligible-for-deletion set', eligible.length === 0)

  await deleteLitterServer(litterId5, breederUid)
  const legacyPupStillThere = await safeGetDoc(doc(db, 'dogs', legacyPupId))
  check('5-AmbiguousLegacy', 'The ambiguous legacy puppy survives the litter delete completely untouched', legacyPupStillThere.exists())

  // Plain standalone dog, same tenant, no litterId, never listed
  // anywhere — must also stay untouched (distinct from the ambiguous
  // case above: this one was never even a candidate).
  const litterId5b = `litter5c_${R}`
  await adminDb.collection('litters').doc(litterId5b).set({
    tenantId: breederUid, damId: damId5, name: 'Litter5c', notes: '', puppyIds: [],
  })
  const standaloneDogId = `standalone5_${R}`
  await setDoc(doc(db, 'dogs', standaloneDogId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Standalone', sex: 'male', status: 'active', dateOfBirth: '2018-01-01',
  })
  await deleteLitterServer(litterId5b, breederUid)
  const standaloneStillThere = await safeGetDoc(doc(db, 'dogs', standaloneDogId))
  check('5-AmbiguousLegacy', 'A same-tenant standalone dog with no litterId and no puppyIds membership is untouched', standaloneStillThere.exists())
}

// =========================================================================
// SECTION 6 — concurrent change: a puppy is transferred AFTER the
// component's stale local state would have considered it eligible, but
// BEFORE the fresh re-read handleDeleteLitter now does immediately
// before deciding anything. Proves the fresh-read fix actually closes
// the staleness window, not just in theory.
// =========================================================================
{
  await as('breeder')
  const damId6 = `dam6_${R}`
  await setDoc(doc(db, 'dogs', damId6), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam6', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId6 = `litter6_${R}`
  const racePupId = `racepup_${R}`
  await setDoc(doc(db, 'dogs', racePupId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'RacePup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
    litterId: litterId6,
  })
  await adminDb.collection('litters').doc(litterId6).set({
    tenantId: breederUid, damId: damId6, name: 'Litter6', notes: '', actualBirthDate: '2026-01-01', puppyIds: [racePupId],
  })

  // Simulate "stale local component state": at page-mount time this
  // puppy looked eligible (currentOwnerId === breeder).
  const staleSnapshot = { currentOwnerId: breederUid, litterId: litterId6, status: 'active' }
  const staleEligible = computeEligible(litterId6, [{ id: racePupId, ...staleSnapshot }], breederUid).eligible
  check('6-ConcurrentChange', 'Stale snapshot alone would have considered the puppy eligible (sets up the race)', staleEligible.length === 1)

  // Now the puppy actually gets transferred (a concurrent tab/process)
  const buyerUid6 = await newUser('buyer6')
  await as('breeder')
  await adminDb.collection('dogs').doc(racePupId).update({ currentOwnerId: buyerUid6, status: 'active' })

  // handleDeleteLitter's fresh re-read happens AFTER the transfer
  const freshLitterSnap = await getDoc(doc(db, 'litters', litterId6))
  const freshCandidateSnaps = await Promise.all((freshLitterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const freshFetched = freshCandidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { eligible: freshEligible, preserved: freshPreserved } = computeEligible(litterId6, freshFetched, breederUid)
  check('6-ConcurrentChange', 'Fresh re-read correctly excludes the just-transferred puppy from eligible', freshEligible.length === 0)
  check('6-ConcurrentChange', 'Fresh re-read correctly counts it as preserved instead', freshPreserved === 1)

  // The actual delete (litter only, since eligible is empty) must leave
  // the transferred puppy fully intact
  await deleteLitterServer(litterId6, breederUid)
  const racePupStillThere = await safeGetDoc(doc(db, 'dogs', racePupId))
  check('6-ConcurrentChange', 'The concurrently-transferred puppy survives with its new owner intact', racePupStillThere.exists() && racePupStillThere.data().currentOwnerId === buyerUid6)
}

// =========================================================================
// SECTION 7 — affected-count accuracy: the eligible/preserved counts
// computed for the confirmation message must exactly match what the
// batch actually deletes/preserves — no drift between what's promised
// and what happens.
// =========================================================================
{
  await as('breeder')
  const damId7 = `dam7_${R}`
  await setDoc(doc(db, 'dogs', damId7), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam7', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId7 = `litter7_${R}`
  const pupIds = [`p7a_${R}`, `p7b_${R}`, `p7c_${R}`, `p7d_${R}`]
  for (const id of pupIds) {
    await setDoc(doc(db, 'dogs', id), {
      tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
      sourceType: 'BREEDER_ISSUED', name: id, sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId: litterId7,
    })
  }
  await adminDb.collection('litters').doc(litterId7).set({
    tenantId: breederUid, damId: damId7, name: 'Litter7', notes: '', actualBirthDate: '2026-01-01', puppyIds: pupIds,
  })
  // Transfer 1 of the 4 away — expect 3 eligible, 1 preserved
  const buyerUid7 = await newUser('buyer7')
  await as('breeder')
  await adminDb.collection('dogs').doc(pupIds[0]).update({ currentOwnerId: buyerUid7, status: 'active' })

  const freshLitterSnap = await getDoc(doc(db, 'litters', litterId7))
  const freshCandidateSnaps = await Promise.all((freshLitterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const freshFetched = freshCandidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { eligible, preserved } = computeEligible(litterId7, freshFetched, breederUid)
  check('7-AffectedCount', 'Computed eligible count is exactly 3', eligible.length === 3)
  check('7-AffectedCount', 'Computed preserved count is exactly 1', preserved === 1)

  await deleteLitterServer(litterId7, breederUid)

  let actuallyDeleted = 0, actuallyPreserved = 0
  for (const id of pupIds) {
    const snap = await safeGetDoc(doc(db, 'dogs', id))
    if (snap.exists()) actuallyPreserved++
    else actuallyDeleted++
  }
  check('7-AffectedCount', 'Actual deleted count matches the computed eligible count (3)', actuallyDeleted === 3)
  check('7-AffectedCount', 'Actual preserved count matches the computed preserved count (1)', actuallyPreserved === 1)
}

// =========================================================================
// SECTION 8 — retry idempotency: committing the same delete batch a
// second time (simulating a client retry after e.g. a network blip on
// the response, even though the first commit actually succeeded) must
// not error and must not affect any other data.
// =========================================================================
{
  await as('breeder')
  const damId8 = `dam8_${R}`
  await setDoc(doc(db, 'dogs', damId8), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam8', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId8 = `litter8_${R}`
  const pupId8 = `p8_${R}`
  await setDoc(doc(db, 'dogs', pupId8), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Pup8', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId: litterId8,
  })
  await adminDb.collection('litters').doc(litterId8).set({
    tenantId: breederUid, damId: damId8, name: 'Litter8', notes: '', actualBirthDate: '2026-01-01', puppyIds: [pupId8],
  })

  let firstOk = true
  try { await deleteLitterServer(litterId8, breederUid) } catch { firstOk = false }
  check('8-RetryIdempotent', 'First delete succeeds', firstOk)

  // Retry — same litterId, already deleted (the litter document no
  // longer exists) — deleteLitterServer's own not-found branch handles
  // this without throwing.
  let retryOk = true
  try { await deleteLitterServer(litterId8, breederUid) } catch { retryOk = false }
  check('8-RetryIdempotent', 'Retrying the delete on an already-deleted litter does not error', retryOk)

  const litterGone = await safeGetDoc(doc(db, 'litters', litterId8))
  const pupGone = await safeGetDoc(doc(db, 'dogs', pupId8))
  check('8-RetryIdempotent', 'Litter remains deleted after retry (no resurrection, no error state)', !litterGone.exists())
  check('8-RetryIdempotent', 'Puppy remains deleted after retry', !pupGone.exists())
}

// =========================================================================
// SECTION 9 — pending-claim preservation: a puppy the breeder has
// already marked as transferred (transferStatus='pendingClaim') but the
// buyer hasn't actually claimed yet — currentOwnerId is STILL the
// breeder's — must be excluded from eligible and preserved. This is the
// scenario the old currentOwnerId-only check (post round-2 fix) missed:
// pending-claim dogs pass a bare currentOwnerId check because ownership
// hasn't legally moved yet, even though a real deal may be in progress.
// =========================================================================
{
  await as('breeder')
  const damId9 = `dam9_${R}`
  await setDoc(doc(db, 'dogs', damId9), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam9', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId9 = `litter9_${R}`
  const pendingPupId = `pendingpup9_${R}`
  await setDoc(doc(db, 'dogs', pendingPupId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'PendingPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01', litterId: litterId9,
  })
  await adminDb.collection('litters').doc(litterId9).set({
    tenantId: breederUid, damId: damId9, name: 'Litter9', notes: '', actualBirthDate: '2026-01-01', puppyIds: [pendingPupId],
  })
  // Breeder marks the puppy as pending-claim (currentOwnerId untouched —
  // matches transferDogOwnership()'s REAL full write shape, src/lib/db.ts:
  // status, transferStatus, previousOwnerId, buyerName, buyerEmail,
  // transferredAt all set together — the Hotfix rule now requires this
  // exact shape for a status-changing write, not just the buyer fields
  // alone).
  await updateDoc(doc(db, 'dogs', pendingPupId), {
    status: 'transferred', transferStatus: 'pendingClaim',
    previousOwnerId: breederUid,
    buyerEmail: 'buyer9@example.com', buyerName: 'Buyer Nine',
    transferredAt: new Date().toISOString(),
  })

  const litterSnap = await getDoc(doc(db, 'litters', litterId9))
  const candidateSnaps = await Promise.all((litterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const fetched = candidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { confirmedMembers, eligible, preserved } = computeEligible(litterId9, fetched, breederUid)
  check('9-PendingClaim', 'Pending-claim puppy is a confirmed member (litterId matches)', confirmedMembers.length === 1)
  check('9-PendingClaim', 'Pending-claim puppy (currentOwnerId unchanged, but transferStatus=pendingClaim) is excluded from eligible', eligible.length === 0)
  check('9-PendingClaim', 'Pending-claim puppy is counted as preserved', preserved === 1)

  // The rules layer independently denies deleting it too, regardless of
  // what client logic decides — a direct single-document delete attempt
  // (not via the litter-delete batch at all) must also fail.
  let directDeleteDenied = false
  try { await deleteDoc(doc(db, 'dogs', pendingPupId)) } catch (err) { directDeleteDenied = isDenied(err) }
  check('9-PendingClaim', 'firestore.rules independently denies deleting a pending-claim dog directly (not just via client eligibility filtering)', directDeleteDenied)

  await deleteLitterServer(litterId9, breederUid)
  const pendingPupStillThere = await safeGetDoc(doc(db, 'dogs', pendingPupId))
  check('9-PendingClaim', 'Pending-claim puppy survives the litter delete completely untouched', pendingPupStillThere.exists())
}

// =========================================================================
// SECTION 10 — ownership-history protection: a puppy that WAS
// transferred and has since been fully claimed (currentOwnerId moved to
// the buyer) obviously fails the currentOwnerId check already, but
// buyerEmail (permanent provenance) is checked independently so even a
// hypothetical future state where status/transferStatus look "clean"
// again can never let a formerly-transferred dog be swept up.
// =========================================================================
{
  await as('breeder')
  const damId10 = `dam10_${R}`
  await setDoc(doc(db, 'dogs', damId10), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam10', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId10 = `litter10_${R}`
  const historyPupId = `historypup10_${R}`
  // currentOwnerId is (unusually) back to the breeder AND status/
  // transferStatus look clean, but buyerEmail proves this dog has
  // ownership history — must still be preserved.
  await setDoc(doc(db, 'dogs', historyPupId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'HistoryPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01',
    litterId: litterId10, buyerEmail: 'past-buyer@example.com',
  })
  await adminDb.collection('litters').doc(litterId10).set({
    tenantId: breederUid, damId: damId10, name: 'Litter10', notes: '', actualBirthDate: '2026-01-01', puppyIds: [historyPupId],
  })

  const litterSnap = await getDoc(doc(db, 'litters', litterId10))
  const candidateSnaps = await Promise.all((litterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const fetched = candidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { eligible, preserved } = computeEligible(litterId10, fetched, breederUid)
  check('10-OwnershipHistory', 'A dog with buyerEmail set is excluded from eligible even with a clean currentOwnerId/status', eligible.length === 0)
  check('10-OwnershipHistory', 'It is counted as preserved', preserved === 1)
}

await summary()
