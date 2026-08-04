// scripts/test-dog-cap.mjs — tests for api/_lib/dog-cap.js (iDogs
// Pricing v1.1 §3.2/§3.3, LOCKED) against the in-memory Firestore fake
// (scripts/test-helpers/fake-firestore.mjs) — exercises the REAL
// exported functions, not a reimplementation.
//
// Usage: node scripts/test-dog-cap.mjs

import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import {
  DOG_CAP,
  capForPlan,
  isEligibleForCap,
  getOwnedActiveDogsSorted,
  reconcileDogCapTx,
  reactivateUpToCapTx,
} from '../api/_lib/dog-cap.js'

const { check, checkAsync, summary } = makeChecker()

check('DOG_CAP matches the locked pricing record — Free 2, Plus 5', DOG_CAP.free === 2 && DOG_CAP.plus === 5)
check('capForPlan resolves plus/free correctly, and anything else defaults to free (safe default)', capForPlan('plus') === 5 && capForPlan('free') === 2 && capForPlan('bogus') === 2)

function dog(id, overrides = {}) {
  return { currentOwnerId: 'owner-1', status: 'active', isDeceased: false, createdAt: '2026-01-01T00:00:00Z', ...overrides, id }
}

// Mimics a real firebase-admin Timestamp read back from a serverTimestamp()
// write — createDog() (client SDK, the main "+ Add dog" UI flow) writes
// createdAt this way, never as a plain string. Found via live staging QA
// (2026-07-24): the fix below is a direct regression test for that bug.
function fakeTimestamp(isoString) {
  const d = new Date(isoString)
  return { toDate: () => d, _seconds: Math.floor(d.getTime() / 1000) }
}

await checkAsync('getOwnedActiveDogsSorted excludes another owner\'s dogs, transferred/restricted/archived dogs, and deceased dogs', async () => {
  const db = createFakeFirestore({
    dogs: {
      d1: dog('d1'),
      d2: dog('d2', { currentOwnerId: 'someone-else' }),
      d3: dog('d3', { status: 'transferred' }),
      d4: dog('d4', { status: 'restricted' }),
      d5: dog('d5', { status: 'archived' }),
      d6: dog('d6', { isDeceased: true }),
    },
  })
  const result = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  return result.length === 1 && result[0].id === 'd1'
})

await checkAsync('getOwnedActiveDogsSorted sorts oldest-created-first', async () => {
  const db = createFakeFirestore({
    dogs: {
      newer: dog('newer', { createdAt: '2026-03-01T00:00:00Z' }),
      oldest: dog('oldest', { createdAt: '2026-01-01T00:00:00Z' }),
      middle: dog('middle', { createdAt: '2026-02-01T00:00:00Z' }),
    },
  })
  const result = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  return result.map(d => d.id).join(',') === 'oldest,middle,newer'
})

await checkAsync('getOwnedActiveDogsSorted correctly orders dogs whose createdAt is a Firestore Timestamp object (serverTimestamp()), not just a string — regression test for the live QA bug', async () => {
  const db = createFakeFirestore({
    dogs: {
      newestTimestamp: dog('newestTimestamp', { createdAt: fakeTimestamp('2026-03-01T00:00:00Z') }),
      oldestTimestamp: dog('oldestTimestamp', { createdAt: fakeTimestamp('2026-01-01T00:00:00Z') }),
      middleString: dog('middleString', { createdAt: '2026-02-01T00:00:00Z' }),
    },
  })
  const result = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  return result.map(d => d.id).join(',') === 'oldestTimestamp,middleString,newestTimestamp'
})

await checkAsync('getOwnedActiveDogsSorted correctly orders a dog whose createdAt is a native Date instance (Codex Medium item), mixed with string/Timestamp shapes', async () => {
  const db = createFakeFirestore({
    dogs: {
      newestDate: dog('newestDate', { createdAt: new Date('2026-03-01T00:00:00Z') }),
      oldestString: dog('oldestString', { createdAt: '2026-01-01T00:00:00Z' }),
      middleTimestamp: dog('middleTimestamp', { createdAt: fakeTimestamp('2026-02-01T00:00:00Z') }),
    },
  })
  const result = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  return result.map(d => d.id).join(',') === 'oldestString,middleTimestamp,newestDate'
})

await checkAsync('getOwnedActiveDogsSorted breaks createdAt ties deterministically by dog id (Codex Medium item) — same result across repeated calls regardless of read order', async () => {
  const db = createFakeFirestore({
    dogs: {
      zulu: dog('zulu', { createdAt: '2026-01-01T00:00:00Z' }),
      alpha: dog('alpha', { createdAt: '2026-01-01T00:00:00Z' }),
      mike: dog('mike', { createdAt: '2026-01-01T00:00:00Z' }),
    },
  })
  const first = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  const second = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  const order = first.map(d => d.id).join(',')
  return order === 'alpha,mike,zulu' && second.map(d => d.id).join(',') === order
})

await checkAsync('reconcileDogCapTx keeps the TRUE earliest-created dogs active even when their createdAt is a Timestamp object, demoting a brand-new dog instead of an old one', async () => {
  const db = createFakeFirestore({
    dogs: {
      old1: dog('old1', { createdAt: fakeTimestamp('2026-01-01T00:00:00Z') }),
      old2: dog('old2', { createdAt: fakeTimestamp('2026-01-02T00:00:00Z') }),
      old3: dog('old3', { createdAt: fakeTimestamp('2026-01-03T00:00:00Z') }),
      brandNew: dog('brandNew', { createdAt: fakeTimestamp('2026-07-24T00:00:00Z') }),
    },
  })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'free'))
  const old1 = await db.collection('dogs').doc('old1').get()
  const brandNew = await db.collection('dogs').doc('brandNew').get()
  return result.demoted.sort().join(',') === 'brandNew,old3' &&
    old1.data().status === 'active' &&
    brandNew.data().status === 'restricted'
})

await checkAsync('reconcileDogCapTx is a no-op when already within cap', async () => {
  const db = createFakeFirestore({ dogs: { d1: dog('d1'), d2: dog('d2', { createdAt: '2026-01-02T00:00:00Z' }) } })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'free'))
  const after = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  return result.demoted.length === 0 && after.length === 2
})

await checkAsync('reconcileDogCapTx (downgrade to Free) demotes the newest dogs beyond the cap, keeping the 2 earliest active — never deletes anything', async () => {
  const db = createFakeFirestore({
    dogs: {
      d1: dog('d1', { createdAt: '2026-01-01T00:00:00Z', name: 'Oldest' }),
      d2: dog('d2', { createdAt: '2026-01-02T00:00:00Z', name: 'Second' }),
      d3: dog('d3', { createdAt: '2026-01-03T00:00:00Z', name: 'Third' }),
      d4: dog('d4', { createdAt: '2026-01-04T00:00:00Z', name: 'Newest' }),
    },
  })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'free'))
  const d1 = await db.collection('dogs').doc('d1').get()
  const d2 = await db.collection('dogs').doc('d2').get()
  const d3 = await db.collection('dogs').doc('d3').get()
  const d4 = await db.collection('dogs').doc('d4').get()
  return result.demoted.sort().join(',') === 'd3,d4' &&
    d1.data().status === 'active' &&
    d2.data().status === 'active' &&
    d3.data().status === 'restricted' &&
    d4.data().status === 'restricted'
})

await checkAsync('reconcileDogCapTx demotes nothing and errors nothing when the account has zero dogs', async () => {
  const db = createFakeFirestore({})
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'free'))
  return result.demoted.length === 0
})

await checkAsync('reactivateUpToCapTx (upgrade to Plus) reactivates restricted dogs earliest-first, up to the new cap of 5', async () => {
  const db = createFakeFirestore({
    dogs: {
      active1: dog('active1', { createdAt: '2026-01-01T00:00:00Z' }),
      active2: dog('active2', { createdAt: '2026-01-02T00:00:00Z' }),
      r1: dog('r1', { status: 'restricted', createdAt: '2026-01-03T00:00:00Z' }),
      r2: dog('r2', { status: 'restricted', createdAt: '2026-01-04T00:00:00Z' }),
      r3: dog('r3', { status: 'restricted', createdAt: '2026-01-05T00:00:00Z' }),
      r4: dog('r4', { status: 'restricted', createdAt: '2026-01-06T00:00:00Z' }), // 6th dog total — must stay restricted (cap is 5)
      archivedOne: dog('archivedOne', { status: 'archived' }), // must never auto-reactivate
    },
  })
  const result = await db.runTransaction(tx => reactivateUpToCapTx(tx, db, 'owner-1', 'plus'))
  const r1 = await db.collection('dogs').doc('r1').get()
  const r4 = await db.collection('dogs').doc('r4').get()
  const archived = await db.collection('dogs').doc('archivedOne').get()
  return result.reactivated.sort().join(',') === 'r1,r2,r3' &&
    result.remainingRestricted === 1 &&
    r1.data().status === 'active' &&
    r4.data().status === 'restricted' && // room was only for 3 more (2 active + 3 = 5)
    archived.data().status === 'archived' // archived dogs are never auto-reactivated
})

await checkAsync('reactivateUpToCapTx is a no-op (no room) when already at cap', async () => {
  const db = createFakeFirestore({
    dogs: Object.fromEntries(
      [1, 2, 3, 4, 5].map(n => [`a${n}`, dog(`a${n}`, { createdAt: `2026-01-0${n}T00:00:00Z` })])
    ),
  })
  const result = await db.runTransaction(tx => reactivateUpToCapTx(tx, db, 'owner-1', 'plus'))
  return result.reactivated.length === 0
})

// Anti-evasion: neither archive->restore nor restricted->activate may be
// used to exceed the cap. api/set-dog-status.js enforces this at the HTTP
// layer using capForPlan + getOwnedActiveDogsSorted directly (not
// reactivateUpToCapTx, which is the bulk-upgrade path) — verify the
// underlying primitive it relies on gives the right answer for that
// per-action check.
await checkAsync('the primitive set-dog-status.js uses (active count >= cap) correctly blocks a single activate/restore at cap', async () => {
  const db = createFakeFirestore({
    dogs: { a1: dog('a1'), a2: dog('a2', { createdAt: '2026-01-02T00:00:00Z' }) },
  })
  const activeDogs = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  const cap = capForPlan('free')
  return activeDogs.length >= cap // exactly the condition set-dog-status.js rejects on
})

// =========================================================================
// Pricing v1.2 — litter-managed puppies do not count toward the cap
// unless explicitly retained/promoted (api/_lib/dog-cap.js's
// isEligibleForCap(), the ONE central eligibility predicate).
// =========================================================================

// `puppy()` mirrors `dog()` but always sets tenantId === currentOwnerId
// ('owner-1') by default — the "still with the originating breeder"
// case isEligibleForCap() actually needs to see, since a real litter
// puppy document always has both fields set (create-litter-puppy.js
// writes both) and the existing `dog()` helper above never sets tenantId
// at all (irrelevant for every pre-v1.2 test, which never involves
// litterId).
function puppy(id, overrides = {}) {
  return dog(id, { tenantId: 'owner-1', litterId: 'litter-1', ...overrides })
}

// ── isEligibleForCap() pure unit tests ──
check('isEligibleForCap: a standalone dog (no litterId) counts, unchanged from v1.1', isEligibleForCap(dog('d1')))
check('isEligibleForCap: an unpromoted litter puppy, still with its breeder, does NOT count', !isEligibleForCap(puppy('p1')))
check('isEligibleForCap: a promoted (retainedByBreeder:true) litter puppy DOES count', isEligibleForCap(puppy('p1', { retainedByBreeder: true })))
check('isEligibleForCap: retainedByBreeder:false is treated exactly like absent — still excluded', !isEligibleForCap(puppy('p1', { retainedByBreeder: false })))
check('isEligibleForCap: a litter puppy TRANSFERRED away from its originating breeder (currentOwnerId !== tenantId) counts for its new owner, regardless of retainedByBreeder — preserves existing transfer/claim behavior',
  isEligibleForCap(puppy('p1', { tenantId: 'original-breeder', currentOwnerId: 'buyer-1' })))
check('isEligibleForCap: an unpromoted litter puppy that is restricted does not count (status gate still applies)', !isEligibleForCap(puppy('p1', { status: 'restricted' })))
check('isEligibleForCap: a promoted litter puppy that is restricted does not count either (status gate applies regardless of retention)', !isEligibleForCap(puppy('p1', { retainedByBreeder: true, status: 'restricted' })))
check('isEligibleForCap: a deceased litter puppy never counts, promoted or not', !isEligibleForCap(puppy('p1', { retainedByBreeder: true, isDeceased: true })))

// ── Required test: "5 counted adults + litter puppy => puppy eligible
// and cap remains 5" ──
await checkAsync('getOwnedActiveDogsSorted: 5 active adult dogs + 1 unpromoted litter puppy => only the 5 adults are eligible; the puppy is NOT counted and NOT restricted', async () => {
  const db = createFakeFirestore({
    dogs: {
      a1: dog('a1', { createdAt: '2026-01-01T00:00:00Z' }),
      a2: dog('a2', { createdAt: '2026-01-02T00:00:00Z' }),
      a3: dog('a3', { createdAt: '2026-01-03T00:00:00Z' }),
      a4: dog('a4', { createdAt: '2026-01-04T00:00:00Z' }),
      a5: dog('a5', { createdAt: '2026-01-05T00:00:00Z' }),
      p1: puppy('p1', { createdAt: '2026-01-06T00:00:00Z' }),
    },
  })
  const eligible = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  const p1 = await db.collection('dogs').doc('p1').get()
  return eligible.length === 5 &&
    !eligible.some(d => d.id === 'p1') &&
    p1.data().status === 'active' // still active — never restricted just for existing
})

// ── Required test: "multiple litter puppies => no adult slots consumed" ──
await checkAsync('getOwnedActiveDogsSorted: 5 active adults + MULTIPLE unpromoted litter puppies => still exactly 5 eligible, no puppy consumes a slot', async () => {
  const db = createFakeFirestore({
    dogs: {
      a1: dog('a1'), a2: dog('a2'), a3: dog('a3'), a4: dog('a4'), a5: dog('a5'),
      p1: puppy('p1'), p2: puppy('p2'), p3: puppy('p3'), p4: puppy('p4'),
    },
  })
  const eligible = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  return eligible.length === 5 && eligible.every(d => !d.litterId)
})

// ── Required test: "4 adults + promoted puppy => count becomes 5" ──
await checkAsync('getOwnedActiveDogsSorted: 4 active adults + 1 PROMOTED litter puppy => 5 eligible total (the promotion consumed the 5th slot)', async () => {
  const db = createFakeFirestore({
    dogs: {
      a1: dog('a1'), a2: dog('a2'), a3: dog('a3'), a4: dog('a4'),
      p1: puppy('p1', { retainedByBreeder: true }),
    },
  })
  const eligible = await db.runTransaction(tx => getOwnedActiveDogsSorted(tx, db, 'owner-1'))
  return eligible.length === 5 && eligible.some(d => d.id === 'p1')
})

// ── reconcileDogCapTx: never demotes an unpromoted litter puppy, even
// when the account is genuinely over cap on adults alone ──
await checkAsync('reconcileDogCapTx (downgrade to Free) demotes excess ADULTS only — an unpromoted litter puppy is never touched, since it was never in the eligible set to begin with', async () => {
  const db = createFakeFirestore({
    dogs: {
      a1: dog('a1', { createdAt: '2026-01-01T00:00:00Z' }),
      a2: dog('a2', { createdAt: '2026-01-02T00:00:00Z' }),
      a3: dog('a3', { createdAt: '2026-01-03T00:00:00Z' }),
      p1: puppy('p1', { createdAt: '2026-01-04T00:00:00Z' }),
    },
  })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'free'))
  const p1 = await db.collection('dogs').doc('p1').get()
  return result.demoted.join(',') === 'a3' && // free cap is 2 — a1/a2 (earliest 2) stay active, only a3 demoted
    p1.data().status === 'active' // untouched
})

// ── Codex fix-round (Finding 3): reconcileDogCapTx now only auto-
// reactivates a litter puppy whose restriction is PROVEN cap-driven
// (restrictionReason:'plan_cap_exceeded'), never one inferred from shape
// alone. reactivates a litter puppy mis-restricted under the OLD rule,
// WITHOUT reactivating a genuinely cap-restricted adult dog in the same
// account ──
await checkAsync('reconcileDogCapTx reactivates a CONFIRMED (restrictionReason:plan_cap_exceeded) cap-restricted litter puppy but leaves a genuinely-restricted adult dog restricted', async () => {
  const db = createFakeFirestore({
    dogs: {
      a1: dog('a1'),
      a2: dog('a2', { status: 'restricted', restrictionReason: 'plan_cap_exceeded' }), // genuinely over cap — must stay restricted
      p1: puppy('p1', { status: 'restricted', restrictionReason: 'plan_cap_exceeded' }), // confirmed cap-driven restriction
    },
  })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'plus'))
  const a2 = await db.collection('dogs').doc('a2').get()
  const p1 = await db.collection('dogs').doc('p1').get()
  return result.misrestrictedPuppiesReactivated.join(',') === 'p1' &&
    p1.data().status === 'active' &&
    p1.data().restrictionReason === undefined && // cleared on reactivation
    a2.data().status === 'restricted' // never reactivated by this pass — genuinely over cap, needs an explicit activate/upgrade
})

await checkAsync('reconcileDogCapTx: reactivating a confirmed mis-restricted puppy is idempotent — running it twice in a row changes nothing the second time', async () => {
  const db = createFakeFirestore({ dogs: { p1: puppy('p1', { status: 'restricted', restrictionReason: 'plan_cap_exceeded' }) } })
  const first = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'plus'))
  const second = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'plus'))
  return first.misrestrictedPuppiesReactivated.join(',') === 'p1' && second.misrestrictedPuppiesReactivated.length === 0
})

await checkAsync('reconcileDogCapTx never reactivates a PROMOTED puppy that is genuinely restricted (it counts toward the cap exactly like an adult once retained)', async () => {
  const db = createFakeFirestore({
    dogs: { p1: puppy('p1', { status: 'restricted', restrictionReason: 'plan_cap_exceeded', retainedByBreeder: true }) },
  })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'plus'))
  const p1 = await db.collection('dogs').doc('p1').get()
  return result.misrestrictedPuppiesReactivated.length === 0 && p1.data().status === 'restricted'
})

await checkAsync('reconcileDogCapTx never reactivates a litter puppy TRANSFERRED to a new owner, even if restricted (it is that owner\'s ordinary dog now, not a mis-restriction)', async () => {
  const db = createFakeFirestore({
    dogs: { p1: puppy('p1', { status: 'restricted', restrictionReason: 'plan_cap_exceeded', tenantId: 'original-breeder', currentOwnerId: 'owner-1' }) },
  })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'plus'))
  const p1 = await db.collection('dogs').doc('p1').get()
  return result.misrestrictedPuppiesReactivated.length === 0 && p1.data().status === 'restricted'
})

// ── Finding 3's actual point: shape alone is never enough. A restricted
// litter puppy with NO restrictionReason (a legacy record, from before
// this field existed — exactly Green Boy's real shape) must NOT be
// silently auto-reactivated by either automatic path, even though its
// shape is otherwise identical to a confirmed one. ──
await checkAsync('reconcileDogCapTx does NOT auto-reactivate a LEGACY restricted litter puppy with no restrictionReason recorded at all — ambiguous, left for the explicit reconcile-litter-puppy action instead', async () => {
  const db = createFakeFirestore({ dogs: { p1: puppy('p1', { status: 'restricted' }) } })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'plus'))
  const p1 = await db.collection('dogs').doc('p1').get()
  return result.misrestrictedPuppiesReactivated.length === 0 && p1.data().status === 'restricted'
})

await checkAsync('reconcileDogCapTx does NOT auto-reactivate a litter puppy that was MANUALLY restricted (restrictionReason:manual) — a deliberate, non-cap restriction must never be silently undone', async () => {
  const db = createFakeFirestore({ dogs: { p1: puppy('p1', { status: 'restricted', restrictionReason: 'manual' }) } })
  const result = await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'plus'))
  const p1 = await db.collection('dogs').doc('p1').get()
  return result.misrestrictedPuppiesReactivated.length === 0 && p1.data().status === 'restricted'
})

await checkAsync('demoteExcessToRestricted tags every demoted dog with restrictionReason:plan_cap_exceeded — the provable signal later reconciliation depends on', async () => {
  const db = createFakeFirestore({
    dogs: {
      a1: dog('a1', { createdAt: '2026-01-01T00:00:00Z' }),
      a2: dog('a2', { createdAt: '2026-01-02T00:00:00Z' }),
      a3: dog('a3', { createdAt: '2026-01-03T00:00:00Z' }), // free cap is 2 — a3 (newest) gets demoted
    },
  })
  await db.runTransaction(tx => reconcileDogCapTx(tx, db, 'owner-1', 'free'))
  const a3 = await db.collection('dogs').doc('a3').get()
  return a3.data().status === 'restricted' && a3.data().restrictionReason === 'plan_cap_exceeded'
})

// ── reactivateUpToCapTx: mis-restricted litter puppies reactivate
// unconditionally (never gated by room), genuinely-restricted adults
// still respect the cap exactly as before ──
await checkAsync('reactivateUpToCapTx (upgrade to Plus): a CONFIRMED cap-restricted litter puppy is reactivated WITHOUT consuming any of the 5-slot room genuinely-restricted adults compete for', async () => {
  const db = createFakeFirestore({
    dogs: {
      active1: dog('active1', { createdAt: '2026-01-01T00:00:00Z' }),
      active2: dog('active2', { createdAt: '2026-01-02T00:00:00Z' }),
      p1: puppy('p1', { status: 'restricted', restrictionReason: 'plan_cap_exceeded', createdAt: '2026-01-03T00:00:00Z' }),
      r1: dog('r1', { status: 'restricted', restrictionReason: 'plan_cap_exceeded', createdAt: '2026-01-04T00:00:00Z' }),
      r2: dog('r2', { status: 'restricted', restrictionReason: 'plan_cap_exceeded', createdAt: '2026-01-05T00:00:00Z' }),
      r3: dog('r3', { status: 'restricted', restrictionReason: 'plan_cap_exceeded', createdAt: '2026-01-06T00:00:00Z' }),
      r4: dog('r4', { status: 'restricted', restrictionReason: 'plan_cap_exceeded', createdAt: '2026-01-07T00:00:00Z' }), // room is only for 3 adults (2 active + 3 = 5) — r4 must stay restricted
    },
  })
  const result = await db.runTransaction(tx => reactivateUpToCapTx(tx, db, 'owner-1', 'plus'))
  const p1 = await db.collection('dogs').doc('p1').get()
  const r1 = await db.collection('dogs').doc('r1').get()
  const r4 = await db.collection('dogs').doc('r4').get()
  return result.misrestrictedPuppiesReactivated.join(',') === 'p1' &&
    result.reactivated.sort().join(',') === 'r1,r2,r3' &&
    p1.data().status === 'active' &&
    p1.data().restrictionReason === undefined &&
    r1.data().restrictionReason === undefined && // cleared on reactivation too
    r4.data().status === 'restricted' &&
    r4.data().restrictionReason === 'plan_cap_exceeded' // untouched, still tagged
})

// Codex fix-round (Finding 3): the actual safety boundary is that a
// LEGACY litter puppy (no restrictionReason) never gets the special
// FREE/room-exempt reactivation reserved for a CONFIRMED one — it falls
// through to the ordinary "restricted dogs compete for whatever room
// exists" bucket instead (pre-existing §3.3 upgrade behavior, applied
// uniformly to any restricted dog regardless of reason — not something
// this fix round changes or needs to prevent). This proves the
// distinction directly: with zero room, a CONFIRMED puppy still
// reactivates for free, while a LEGACY one — genuinely indistinguishable
// by shape alone — does not, because it has no proof it was ever
// cap-driven and so is never treated as cost-free.
await checkAsync('reactivateUpToCapTx: with zero room, a CONFIRMED cap-restricted puppy still reactivates for free, but a LEGACY (no-reason) puppy does not — proves the reason gate actually matters, not just the shape', async () => {
  const db = createFakeFirestore({
    dogs: {
      active1: dog('active1', { createdAt: '2026-01-01T00:00:00Z' }),
      active2: dog('active2', { createdAt: '2026-01-02T00:00:00Z' }),
      active3: dog('active3', { createdAt: '2026-01-03T00:00:00Z' }),
      active4: dog('active4', { createdAt: '2026-01-04T00:00:00Z' }),
      active5: dog('active5', { createdAt: '2026-01-05T00:00:00Z' }), // room is already 0 (5 active adults, cap 5)
      confirmed: puppy('confirmed', { status: 'restricted', restrictionReason: 'plan_cap_exceeded', createdAt: '2026-01-06T00:00:00Z' }),
      legacy: puppy('legacy', { status: 'restricted', createdAt: '2026-01-07T00:00:00Z' }), // no restrictionReason at all
    },
  })
  const result = await db.runTransaction(tx => reactivateUpToCapTx(tx, db, 'owner-1', 'plus'))
  const confirmed = await db.collection('dogs').doc('confirmed').get()
  const legacy = await db.collection('dogs').doc('legacy').get()
  return result.misrestrictedPuppiesReactivated.join(',') === 'confirmed' &&
    result.reactivated.length === 0 && // zero room — nothing from the ordinary bucket gets in, including legacy
    confirmed.data().status === 'active' &&
    legacy.data().status === 'restricted'
})

// ── Task 3: create-dog / set-dog-status forgery-resistance is proven at
// the API-endpoint level (test-litter-puppy-cap-v1.2.mjs, emulator
// section) — this file only proves the underlying predicate can't be
// fooled by a client-shaped payload that OMITS tenantId (the exact shape
// firestore.rules would see from a legacy/malformed document, or a
// caller that forgot to populate it): with tenantId absent, the "still
// with originating breeder" check can never spuriously match, so a
// malformed dog fails CLOSED (counts toward the cap) rather than
// silently granting a free cap exemption.
check('isEligibleForCap: a dog with litterId but NO tenantId at all (malformed/legacy shape) fails closed — counts toward the cap rather than being silently exempted',
  isEligibleForCap({ status: 'active', isDeceased: false, litterId: 'litter-1', currentOwnerId: 'owner-1' }))

await summary()
