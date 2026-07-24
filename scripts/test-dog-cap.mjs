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

await summary()
