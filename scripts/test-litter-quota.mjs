// scripts/test-litter-quota.mjs — tests for api/_lib/litter-quota.js
// (iDogs Pricing v1.1 §3.4/§4.1, LOCKED) against the in-memory Firestore
// fake. Exercises the real exported functions.
//
// Usage: node scripts/test-litter-quota.mjs

import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import {
  isWithinRollingWindow,
  hasLitterWithinRollingWindow,
  hasOtherUndatedPlannedLitter,
  writeLitterQuotaLedgerEntry,
} from '../api/_lib/litter-quota.js'

const { check, checkAsync, summary } = makeChecker()

// ── isWithinRollingWindow — symmetric, bidirectional (Codex H6) ──────

check('a date exactly on the new date is within the window (0 days apart)', isWithinRollingWindow('2026-07-24', '2026-07-24'))
check('364 days before is within the window', isWithinRollingWindow('2025-07-25', '2026-07-24'))
check('exactly 365 days before is within the window (inclusive boundary)', isWithinRollingWindow('2025-07-24', '2026-07-24'))
check('366 days before is OUTSIDE the window', !isWithinRollingWindow('2025-07-23', '2026-07-24'))

// Codex H6 regression: the existing entry being chronologically AFTER
// the new date must conflict just as much as the reverse — backdating a
// litter must not evade the check by exploiting direction.
check('a date 8 days AFTER the new date conflicts (H6: symmetric, not just "preceding")', isWithinRollingWindow('2026-08-01', '2026-07-24'))
check('364 days AFTER the new date conflicts', isWithinRollingWindow('2027-07-23', '2026-07-24'))
check('exactly 365 days AFTER the new date conflicts (inclusive boundary, both directions)', isWithinRollingWindow('2027-07-24', '2026-07-24'))
check('366 days AFTER the new date is OUTSIDE the window', !isWithinRollingWindow('2027-07-25', '2026-07-24'))

// ── hasLitterWithinRollingWindow — reads litterQuotaLedger only ──────

await checkAsync('no ledger entries -> no block', async () => {
  const db = createFakeFirestore({})
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-07-24'))
  return blocked === false
})

await checkAsync('a ledger entry 200 days earlier blocks a new litter (within the rolling window)', async () => {
  const db = createFakeFirestore({
    litterQuotaLedger: { e1: { tenantId: 'tenant-1', litterId: 'litter-old', whelpingDate: '2026-01-01' } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-07-24'))
  return blocked === true
})

await checkAsync('a ledger entry 400 days earlier does NOT block (outside the rolling window)', async () => {
  const db = createFakeFirestore({
    litterQuotaLedger: { e1: { tenantId: 'tenant-1', litterId: 'litter-old', whelpingDate: '2024-06-01' } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-07-24'))
  return blocked === false
})

await checkAsync('Codex H6 regression: BACKDATING — a litter recorded with a LATER date first still blocks a subsequently-added EARLIER date within 365 days, regardless of creation order', async () => {
  const db = createFakeFirestore({
    // The ledger entry's whelpingDate (2027-03-01) is chronologically
    // AFTER the new litter being checked (2027-01-10) — exactly the
    // direction the pre-fix one-directional check missed.
    litterQuotaLedger: { e1: { tenantId: 'tenant-1', litterId: 'litter-later', whelpingDate: '2027-03-01' } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2027-01-10'))
  return blocked === true
})

await checkAsync('a ledger entry belonging to a DIFFERENT tenant never blocks (tenant isolation)', async () => {
  const db = createFakeFirestore({
    litterQuotaLedger: { e1: { tenantId: 'someone-else', litterId: 'litter-x', whelpingDate: '2026-07-01' } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-07-24'))
  return blocked === false
})

// ── Tombstone: a ledger entry survives its litter being hard-deleted —
// the whole point of decoupling quota from the live litters collection.
await checkAsync('deleting the underlying litter document does not remove its ledger entry — quota still enforced (tombstone)', async () => {
  const db = createFakeFirestore({})
  await db.runTransaction(async tx => {
    writeLitterQuotaLedgerEntry(tx, db, { tenantId: 'tenant-1', litterId: 'litter-1', whelpingDate: '2026-06-01' })
  })
  // Simulate api/delete-litter.js hard-deleting the litter document — the
  // ledger is a SEPARATE collection this fake never had a litters/litter-1
  // doc in to begin with, so this proves the ledger check works with no
  // dependency on the litter document existing at all.
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-08-01'))
  return blocked === true
})

// ── Codex H7: pre-ledger historical litters must still count ─────────

await checkAsync('a HISTORICAL litter (dated, live document, NO ledger entry — created before this quota system existed) blocks a new litter within its window', async () => {
  const db = createFakeFirestore({
    litters: { legacyLitter: { tenantId: 'tenant-1', actualBirthDate: '2026-06-01', archived: false } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-08-01'))
  return blocked === true
})

await checkAsync('an ARCHIVED historical litter (no ledger entry) still counts — archiving must not restore quota, even for pre-ledger records', async () => {
  const db = createFakeFirestore({
    litters: { legacyArchived: { tenantId: 'tenant-1', actualBirthDate: '2026-06-01', archived: true } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-08-01'))
  return blocked === true
})

await checkAsync('a historical litter outside the window (400 days) does not block', async () => {
  const db = createFakeFirestore({
    litters: { legacyOld: { tenantId: 'tenant-1', actualBirthDate: '2024-06-01', archived: false } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-07-24'))
  return blocked === false
})

await checkAsync('a historical litter belonging to a different tenant never blocks', async () => {
  const db = createFakeFirestore({
    litters: { otherTenant: { tenantId: 'someone-else', actualBirthDate: '2026-06-01', archived: false } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-08-01'))
  return blocked === false
})

await checkAsync('excludeLitterId excludes a litter from the live-collection fallback scan too (self-check during activation)', async () => {
  const db = createFakeFirestore({
    litters: { self: { tenantId: 'tenant-1', actualBirthDate: '2026-06-01', archived: false } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-08-01', 'self'))
  return blocked === false
})

await checkAsync('a ledger-backed litter is not double-scanned into a false negative — still blocks correctly when also present live', async () => {
  const db = createFakeFirestore({
    litterQuotaLedger: { e1: { tenantId: 'tenant-1', litterId: 'litter-1', whelpingDate: '2026-06-01' } },
    litters: { 'litter-1': { tenantId: 'tenant-1', actualBirthDate: '2026-06-01', archived: false } },
  })
  const blocked = await db.runTransaction(tx => hasLitterWithinRollingWindow(tx, db, 'tenant-1', '2026-08-01'))
  return blocked === true
})

// ── hasOtherUndatedPlannedLitter — §4.1, live `litters` collection ────

await checkAsync('one un-dated planned litter blocks a second planned litter for the same tenant', async () => {
  const db = createFakeFirestore({
    litters: { planned1: { tenantId: 'tenant-1', actualBirthDate: '' } },
  })
  const hasPlanned = await db.runTransaction(tx => hasOtherUndatedPlannedLitter(tx, db, 'tenant-1'))
  return hasPlanned === true
})

await checkAsync('an ACTIVATED litter (actualBirthDate set) does not count as a "planned" duplicate', async () => {
  const db = createFakeFirestore({
    litters: { dated1: { tenantId: 'tenant-1', actualBirthDate: '2026-01-01' } },
  })
  const hasPlanned = await db.runTransaction(tx => hasOtherUndatedPlannedLitter(tx, db, 'tenant-1'))
  return hasPlanned === false
})

await checkAsync('an ARCHIVED un-dated litter does not block a new planned litter', async () => {
  const db = createFakeFirestore({
    litters: { archivedPlanned: { tenantId: 'tenant-1', actualBirthDate: '', archived: true } },
  })
  const hasPlanned = await db.runTransaction(tx => hasOtherUndatedPlannedLitter(tx, db, 'tenant-1'))
  return hasPlanned === false
})

await checkAsync('excludeLitterId lets a litter re-check itself without self-blocking', async () => {
  const db = createFakeFirestore({
    litters: { self: { tenantId: 'tenant-1', actualBirthDate: '' } },
  })
  const hasPlanned = await db.runTransaction(tx => hasOtherUndatedPlannedLitter(tx, db, 'tenant-1', 'self'))
  return hasPlanned === false
})

await summary()
