// scripts/test-round15-aggregator-fail-closed.mjs — Codex round 15,
// Blocker 1: db.ts aggregate loaders (getAllDocumentsForUser, getReminders,
// getAllRemindersForUser, getAllPendingReminders) must never let a
// subordinate query's failure resolve as a normal partial/empty result.
//
// db.ts can't be imported directly in this plain-Node script (it
// transitively imports ./firebase, which needs live Firebase Web SDK
// config/env vars that don't exist here — same limitation documented in
// round 14's getDogs() test). Each aggregator's algorithm is mirrored
// exactly, with injectable per-source query functions so every subordinate
// failure combination can be exercised deterministically, combined with
// source-pattern checks against the real file so the mirror can't
// silently drift from what's actually shipped.
//
// Usage: node scripts/test-round15-aggregator-fail-closed.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, summary } = makeChecker()

class GetDocumentsErrorMirror extends Error {}
class GetRemindersErrorMirror extends Error {}

function fakeDoc(data) { return { id: data.id, data: () => data } }
function fakeSnap(docs) { return { docs: docs.map(fakeDoc) } }

// ── Mirror of getAllDocumentsForUser()'s actual current logic ──
async function getAllDocumentsForUserMirror(accessibleDogIds, getDogDocumentsImpl) {
  if (accessibleDogIds.length === 0) return []
  let perDog
  try {
    perDog = await Promise.all(accessibleDogIds.map(id => getDogDocumentsImpl(id)))
  } catch {
    throw new GetDocumentsErrorMirror()
  }
  return perDog.flat()
}

// ── Mirror of getAllPendingReminders()'s claimed-reminder handling ──
// (getReminders/getAllRemindersForUser share the identical
// permission-denied-is-expected / anything-else-rejects shape — see the
// matching comments in src/lib/db.ts.)
async function claimedReminderMergeMirror(tenantReminders, claimedDogIds, queryClaimedImpl, readCode) {
  let claimedReminders = []
  if (claimedDogIds.length > 0) {
    try {
      const snap = await queryClaimedImpl()
      claimedReminders = snap.docs.map(d => d.data())
    } catch (err) {
      const code = readCode(err)
      if (code !== 'permission-denied') {
        throw new GetRemindersErrorMirror()
      }
      // Expected deny — tenantReminders alone is the correct answer.
    }
  }
  const merged = new Map()
  for (const r of [...tenantReminders, ...claimedReminders]) merged.set(r.id, r)
  return Array.from(merged.values())
}

// =========================================================================
// SECTION 1 — getAllDocumentsForUser: one dog's document query failing
// must reject the WHOLE aggregate, never silently contribute [] for that
// dog while returning the rest as if the list were complete
// =========================================================================
await checkAsync('getAllDocumentsForUser mirror: all dogs succeed returns the full merged list',
  (async () => {
    const result = await getAllDocumentsForUserMirror(['d1', 'd2'], async (id) =>
      id === 'd1' ? [{ id: 'doc1' }] : [{ id: 'doc2' }, { id: 'doc3' }])
    return result.length === 3
  })())

await checkAsync('getAllDocumentsForUser mirror: ONE dog\'s query failing rejects the whole aggregate, not a partial list missing just that dog',
  (async () => {
    let threw = false
    try {
      await getAllDocumentsForUserMirror(['d1', 'd2', 'd3'], async (id) => {
        if (id === 'd2') throw new Error('permission-denied')
        return [{ id: `doc-${id}` }]
      })
    } catch (err) {
      threw = err instanceof GetDocumentsErrorMirror
    }
    return threw
  })())

await checkAsync('getAllDocumentsForUser mirror: failure never resolves as a normal (even if short) array',
  (async () => {
    let resolved = false
    try {
      await getAllDocumentsForUserMirror(['d1', 'd2'], async (id) => {
        if (id === 'd1') return [{ id: 'doc1' }]
        throw new Error('unavailable')
      })
      resolved = true
    } catch { /* expected */ }
    return !resolved
  })())

await checkAsync('getAllDocumentsForUser mirror: zero accessible dogs still legitimately resolves to [] (not an error)',
  (async () => {
    const result = await getAllDocumentsForUserMirror([], async () => { throw new Error('should never be called') })
    return Array.isArray(result) && result.length === 0
  })())

// =========================================================================
// SECTION 2 — claimed-reminder aggregators (getReminders,
// getAllRemindersForUser, getAllPendingReminders): permission-denied is
// the EXPECTED, by-design outcome until tenantId reassignment — treated
// as "no claimed reminders yet", not a failure. Any OTHER code means the
// aggregate genuinely doesn't know the claimed-reminder state and must
// reject rather than silently present tenant-only results as complete.
// =========================================================================
function codeReader(err) { return err && err.code ? err.code : 'unknown' }

await checkAsync('claimed-reminder mirror: permission-denied on the claimed query still returns tenant-only reminders (expected deny, not a failure)',
  (async () => {
    const tenantReminders = [{ id: 't1' }, { id: 't2' }]
    const result = await claimedReminderMergeMirror(
      tenantReminders, ['claimed-dog-1'],
      async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }) },
      codeReader,
    )
    return result.length === 2 && result.every(r => tenantReminders.some(t => t.id === r.id))
  })())

await checkAsync('claimed-reminder mirror: a GENUINE failure (unavailable) on the claimed query rejects the whole aggregate, never silently returns tenant-only as if complete',
  (async () => {
    let threw = false
    try {
      await claimedReminderMergeMirror(
        [{ id: 't1' }], ['claimed-dog-1'],
        async () => { throw Object.assign(new Error('down'), { code: 'unavailable' }) },
        codeReader,
      )
    } catch (err) {
      threw = err instanceof GetRemindersErrorMirror
    }
    return threw
  })())

await checkAsync('claimed-reminder mirror: an unknown/unrecognized code on the claimed query also rejects (fail closed, not just a fixed allowlist of "safe" failures)',
  (async () => {
    let threw = false
    try {
      await claimedReminderMergeMirror(
        [{ id: 't1' }], ['claimed-dog-1'],
        async () => { throw Object.assign(new Error('mystery'), { code: 'resource-exhausted' }) },
        codeReader,
      )
    } catch (err) {
      threw = err instanceof GetRemindersErrorMirror
    }
    return threw
  })())

await checkAsync('claimed-reminder mirror: both tenant and claimed succeed and are correctly merged/deduplicated',
  (async () => {
    const tenantReminders = [{ id: 'r1' }]
    const result = await claimedReminderMergeMirror(
      tenantReminders, ['claimed-dog-1'],
      async () => fakeSnap([{ id: 'r1' }, { id: 'r2' }]), // r1 duplicated across both sources
      codeReader,
    )
    return result.length === 2
  })())

await checkAsync('claimed-reminder mirror: no claimed dogs at all skips the claimed query entirely and returns tenant reminders only',
  (async () => {
    const tenantReminders = [{ id: 't1' }]
    const result = await claimedReminderMergeMirror(tenantReminders, [], async () => { throw new Error('should never be called') }, codeReader)
    return result.length === 1 && result[0].id === 't1'
  })())

// =========================================================================
// SECTION 3 — source-pattern checks against the REAL src/lib/db.ts
// =========================================================================
{
  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')

  check('GetDocumentsError is exported', /export class GetDocumentsError extends Error/.test(dbSrc))
  check('GetRemindersError is exported', /export class GetRemindersError extends Error/.test(dbSrc))

  const getAllDocsMatch = dbSrc.match(/export async function getAllDocumentsForUser\([\s\S]*?\n}\r?\n/)
  const getAllDocsBlock = getAllDocsMatch ? getAllDocsMatch[0] : ''
  check('getAllDocumentsForUser() source was actually located for inspection', getAllDocsBlock.length > 0)
  check('getAllDocumentsForUser() no longer wraps each per-dog getDogDocuments() call in .catch(() => [])',
    !/getDogDocuments\(id\)\.catch\(\(\) => \[\]\)/.test(getAllDocsBlock))
  check('getAllDocumentsForUser() throws GetDocumentsError on a subordinate-query failure',
    /throw new GetDocumentsError\(\)/.test(getAllDocsBlock))
  check('getAllDocumentsForUser() logs only a sanitized code, not the raw error',
    /console\.error\('getAllDocumentsForUser:[^)]*safeReadFirestoreErrorCode\(err\)/.test(getAllDocsBlock))

  const getRemindersMatch = dbSrc.match(/export async function getReminders\([\s\S]*?\n}\r?\n/)
  const getRemindersBlock = getRemindersMatch ? getRemindersMatch[0] : ''
  check('getReminders() source was actually located for inspection', getRemindersBlock.length > 0)
  check('getReminders() distinguishes permission-denied (expected) from other codes (genuine failure) on the claimed-reminder query',
    /code !== 'permission-denied'/.test(getRemindersBlock) && /throw new GetRemindersError\(\)/.test(getRemindersBlock))

  const getAllRemindersMatch = dbSrc.match(/export async function getAllRemindersForUser\([\s\S]*?\n}\r?\n/)
  const getAllRemindersBlock = getAllRemindersMatch ? getAllRemindersMatch[0] : ''
  check('getAllRemindersForUser() source was actually located for inspection', getAllRemindersBlock.length > 0)
  check('getAllRemindersForUser() distinguishes permission-denied from other codes on the claimed-reminder query',
    /code !== 'permission-denied'/.test(getAllRemindersBlock) && /throw new GetRemindersError\(\)/.test(getAllRemindersBlock))

  const getAllPendingMatch = dbSrc.match(/export async function getAllPendingReminders\([\s\S]*?\n}\r?\n/)
  const getAllPendingBlock = getAllPendingMatch ? getAllPendingMatch[0] : ''
  check('getAllPendingReminders() source was actually located for inspection', getAllPendingBlock.length > 0)
  check('getAllPendingReminders() distinguishes permission-denied from other codes on the claimed-reminder query',
    /code !== 'permission-denied'/.test(getAllPendingBlock) && /throw new GetRemindersError\(\)/.test(getAllPendingBlock))
  check('getAllPendingReminders() no longer has an unconditional swallow-to-empty catch around the claimed query',
    !/catch \(err\) \{\s*console\.error\('Failed to fetch claimed-dog pending reminders/.test(dbSrc))

  check('safeReadFirestoreErrorCode is exported (reusable by page-level loaders for consistent sanitized logging)',
    /export function safeReadFirestoreErrorCode/.test(dbSrc))
}

await summary()
