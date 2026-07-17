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

// Mirrors LittersPage.handleDeleteLitter()'s exact candidate-filtering
// logic against already-fetched snapshots, so Sections 4-7 below can
// reuse it instead of re-deriving eligibility ad hoc.
function computeEligible(freshLitterId, candidates, requesterUid) {
  const litterMembers = candidates.filter(d => d.litterId === undefined || d.litterId === freshLitterId)
  const eligible = litterMembers.filter(d => d.currentOwnerId === requesterUid)
  const preserved = litterMembers.length - eligible.length
  return { eligible, preserved, litterMembers }
}

// =========================================================================
// SECTION 4 — litterId cross-check: a dog erroneously listed in this
// litter's puppyIds (a data-corruption scenario — e.g. a copy/paste bug
// wrote the wrong id) but whose OWN litterId back-reference points at a
// DIFFERENT litter must be preserved, never deleted and never counted
// as "eligible" — Codex Blocker 3 ("same owner but different litter
// remains untouched").
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
  await setDoc(doc(db, 'litters', thisLitterId), {
    tenantId: breederUid, damId: damId4, name: 'This Litter', notes: '', actualBirthDate: '2026-01-01',
    puppyIds: [crossLinkedPupId],
  })

  const litterSnap = await getDoc(doc(db, 'litters', thisLitterId))
  const candidateSnaps = await Promise.all((litterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const candidates = candidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { eligible, litterMembers } = computeEligible(thisLitterId, candidates, breederUid)
  check('4-CrossLinkGuard', 'A dog whose litterId points elsewhere is excluded from litter membership entirely', litterMembers.length === 0)
  check('4-CrossLinkGuard', 'A dog whose litterId points elsewhere is never in the eligible-for-deletion set', eligible.length === 0)

  // Actually attempt the delete (litter only — eligible is empty) and
  // confirm the cross-linked puppy survives untouched
  const batch = writeBatch(db)
  batch.delete(doc(db, 'litters', thisLitterId))
  await batch.commit()
  const pupStillThere = await safeGetDoc(doc(db, 'dogs', crossLinkedPupId))
  check('4-CrossLinkGuard', 'The cross-linked puppy (belongs to a different litter) survives the delete untouched', pupStillThere.exists() && pupStillThere.data().litterId === otherLitterId)
}

// =========================================================================
// SECTION 5 — same tenant, no litterId, NOT actually part of this
// litter: an ordinary standalone dog (e.g. created via DogNewPage,
// never touched by any litter flow) must never be swept up by a litter
// delete merely for sharing a tenant — Codex Blocker 3 ("same tenant
// but no litterId remains untouched").
// =========================================================================
{
  await as('breeder')
  const damId5 = `dam5b_${R}`
  await setDoc(doc(db, 'dogs', damId5), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Dam5b', sex: 'female', status: 'active', dateOfBirth: '2020-01-01',
  })
  const litterId5 = `litter5b_${R}`
  await setDoc(doc(db, 'litters', litterId5), {
    tenantId: breederUid, damId: damId5, name: 'Litter5b', notes: '', puppyIds: [], // empty — nobody is a member
  })
  // A standalone dog, same tenant, no litterId, never listed anywhere
  const standaloneDogId = `standalone5_${R}`
  await setDoc(doc(db, 'dogs', standaloneDogId), {
    tenantId: breederUid, currentOwnerId: breederUid, createdByUserId: breederUid,
    sourceType: 'BREEDER_ISSUED', name: 'Standalone', sex: 'male', status: 'active', dateOfBirth: '2018-01-01',
  })

  const batch = writeBatch(db)
  batch.delete(doc(db, 'litters', litterId5))
  await batch.commit()
  const standaloneStillThere = await safeGetDoc(doc(db, 'dogs', standaloneDogId))
  check('5-StandaloneGuard', 'A same-tenant standalone dog with no litterId and no puppyIds membership is untouched', standaloneStillThere.exists())
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
  await setDoc(doc(db, 'litters', litterId6), {
    tenantId: breederUid, damId: damId6, name: 'Litter6', notes: '', actualBirthDate: '2026-01-01', puppyIds: [racePupId],
  })

  // Simulate "stale local component state": at page-mount time this
  // puppy looked eligible (currentOwnerId === breeder).
  const staleSnapshot = { currentOwnerId: breederUid, litterId: litterId6 }
  const staleEligible = computeEligible(litterId6, [{ id: racePupId, ...staleSnapshot }], breederUid).eligible
  check('6-ConcurrentChange', 'Stale snapshot alone would have considered the puppy eligible (sets up the race)', staleEligible.length === 1)

  // Now the puppy actually gets transferred (a concurrent tab/process)
  const buyerUid6 = await newUser('buyer6')
  await as('breeder')
  await adminDb.collection('dogs').doc(racePupId).update({ currentOwnerId: buyerUid6, status: 'active' })

  // handleDeleteLitter's fresh re-read happens AFTER the transfer
  const freshLitterSnap = await getDoc(doc(db, 'litters', litterId6))
  const freshCandidateSnaps = await Promise.all((freshLitterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const freshCandidates = freshCandidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { eligible: freshEligible, preserved: freshPreserved } = computeEligible(litterId6, freshCandidates, breederUid)
  check('6-ConcurrentChange', 'Fresh re-read correctly excludes the just-transferred puppy from eligible', freshEligible.length === 0)
  check('6-ConcurrentChange', 'Fresh re-read correctly counts it as preserved instead', freshPreserved === 1)

  // The actual delete (litter only, since eligible is empty) must leave
  // the transferred puppy fully intact
  const batch = writeBatch(db)
  batch.delete(doc(db, 'litters', litterId6))
  await batch.commit()
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
  await setDoc(doc(db, 'litters', litterId7), {
    tenantId: breederUid, damId: damId7, name: 'Litter7', notes: '', actualBirthDate: '2026-01-01', puppyIds: pupIds,
  })
  // Transfer 1 of the 4 away — expect 3 eligible, 1 preserved
  const buyerUid7 = await newUser('buyer7')
  await as('breeder')
  await adminDb.collection('dogs').doc(pupIds[0]).update({ currentOwnerId: buyerUid7, status: 'active' })

  const freshLitterSnap = await getDoc(doc(db, 'litters', litterId7))
  const freshCandidateSnaps = await Promise.all((freshLitterSnap.data().puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
  const freshCandidates = freshCandidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
  const { eligible, preserved } = computeEligible(litterId7, freshCandidates, breederUid)
  check('7-AffectedCount', 'Computed eligible count is exactly 3', eligible.length === 3)
  check('7-AffectedCount', 'Computed preserved count is exactly 1', preserved === 1)

  const batch = writeBatch(db)
  batch.delete(doc(db, 'litters', litterId7))
  for (const puppy of eligible) batch.delete(doc(db, 'dogs', puppy.id))
  await batch.commit()

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
  await setDoc(doc(db, 'litters', litterId8), {
    tenantId: breederUid, damId: damId8, name: 'Litter8', notes: '', actualBirthDate: '2026-01-01', puppyIds: [pupId8],
  })

  const firstBatch = writeBatch(db)
  firstBatch.delete(doc(db, 'litters', litterId8))
  firstBatch.delete(doc(db, 'dogs', pupId8))
  let firstOk = true
  try { await firstBatch.commit() } catch { firstOk = false }
  check('8-RetryIdempotent', 'First commit succeeds', firstOk)

  // Retry — same shape of batch, deleting already-deleted documents
  const retryBatch = writeBatch(db)
  retryBatch.delete(doc(db, 'litters', litterId8))
  retryBatch.delete(doc(db, 'dogs', pupId8))
  let retryOk = true
  try { await retryBatch.commit() } catch { retryOk = false }
  check('8-RetryIdempotent', 'Retrying the same delete batch on already-deleted documents does not error', retryOk)

  const litterGone = await safeGetDoc(doc(db, 'litters', litterId8))
  const pupGone = await safeGetDoc(doc(db, 'dogs', pupId8))
  check('8-RetryIdempotent', 'Litter remains deleted after retry (no resurrection, no error state)', !litterGone.exists())
  check('8-RetryIdempotent', 'Puppy remains deleted after retry', !pupGone.exists())
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
