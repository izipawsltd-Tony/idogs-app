// scripts/test-reminders-batch-regression.mjs — structural/mirror
// regression tests for the ≤20-per-batch claimed-dog reminder query
// chunking added to src/lib/db.ts (chunk(), queryRemindersByDogIds(),
// and the three reminder-loading functions that use it). Follows this
// repo's established convention (see test-round15-aggregator-fail-
// closed.mjs's claimedReminderMergeMirror) of mirroring app logic
// in-file rather than importing db.ts directly — db.ts imports
// src/lib/firebase.ts, which reads `import.meta.env.VITE_*` (Vite-only
// syntax), so it cannot be safely dynamically imported from a plain
// Node script. Real end-to-end batching-against-Rules coverage is in
// scripts/test-reminders-rules-emulator.mjs; this file covers the exact
// batch-count math and the merge/dedupe/fail-closed contract.
//
// Usage: node scripts/test-reminders-batch-regression.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, summary } = makeChecker()

const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')

// ── Mirror of db.ts's chunk() — identical pure-function logic ─────────

function chunk(items, size) {
  const batches = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

// ── Exact batch-boundary math (Part B requirement) ─────────────────────

const BATCH_SIZE = 20
const boundaryCases = [
  { total: 1, expectedBatches: 1 },
  { total: 20, expectedBatches: 1 },
  { total: 21, expectedBatches: 2 },
  { total: 30, expectedBatches: 2 },
  { total: 40, expectedBatches: 2 },
  { total: 41, expectedBatches: 3 },
]

for (const { total, expectedBatches } of boundaryCases) {
  const ids = Array.from({ length: total }, (_, i) => `dog_${i}`)
  const batches = chunk(ids, BATCH_SIZE)
  check(
    `${total} claimed dogs → ${expectedBatches} quer${expectedBatches === 1 ? 'y' : 'ies'}`,
    batches.length === expectedBatches
  )
  check(
    `${total} claimed dogs → every batch has ≤${BATCH_SIZE} dogIds`,
    batches.every(b => b.length <= BATCH_SIZE)
  )
  check(
    `${total} claimed dogs → batches cover every dog exactly once (no truncation, no duplication)`,
    batches.flat().length === total && new Set(batches.flat()).size === total &&
      ids.every(id => batches.some(b => b.includes(id)))
  )
}

// ── db.ts source confirms chunk()/queryRemindersByDogIds() wiring ──────

check('db.ts exports chunk()', /export function chunk<T>/.test(dbSrc))
check('db.ts defines REMINDER_DOG_ID_QUERY_BATCH_SIZE = 20 (matches the empirically-confirmed Rules get()-call budget)', /REMINDER_DOG_ID_QUERY_BATCH_SIZE = 20/.test(dbSrc))
check('db.ts\'s queryRemindersByDogIds() batches via chunk() and queries all batches in parallel via Promise.all', /async function queryRemindersByDogIds/.test(dbSrc) && /Promise\.all\(\s*batches\.map/.test(dbSrc))
check('db.ts\'s queryRemindersByDogIds() flattens all batch results together', /flatMap\(snap => snap\.docs\)/.test(dbSrc))

check(
  'getReminders() routes its claimed-dog query through queryRemindersByDogIds() — not a raw unbatched query',
  /queryRemindersByDogIds\(\[dogId\]\)/.test(dbSrc)
)
check(
  'getAllRemindersForUser() routes its claimed-dog query through queryRemindersByDogIds(), not the old .slice(0,30)',
  /getAllRemindersForUser[\s\S]{0,2500}queryRemindersByDogIds\(claimedDogIds\)/.test(dbSrc) &&
    !/getAllRemindersForUser[\s\S]{0,2500}claimedDogIds\.slice\(0, ?30\)/.test(dbSrc)
)
check(
  'getAllPendingReminders() routes its claimed-dog query through queryRemindersByDogIds(), not the old .slice(0,30)',
  /getAllPendingReminders[\s\S]{0,2500}queryRemindersByDogIds\(claimedDogIds\)/.test(dbSrc) &&
    !/getAllPendingReminders[\s\S]{0,2500}claimedDogIds\.slice\(0, ?30\)/.test(dbSrc)
)
check(
  'No reminder-loading function still truncates claimedDogIds with .slice(0, 30) anywhere in db.ts',
  !/claimedDogIds\.slice\(0, ?30\)/.test(dbSrc)
)

// ── Merge/dedupe/fail-closed mirror — extends round15's
//    claimedReminderMergeMirror to explicitly exercise MULTIPLE batches ──

// Mirrors queryRemindersByDogIds() + the merge logic shared by all three
// db.ts functions: batches the given dogIds, calls queryBatchImpl per
// batch IN PARALLEL (Promise.all — same fail-closed semantics as the
// real code: any rejected batch rejects the whole call), flattens
// results, then merges with tenantReminders deduping by id.
async function claimedBatchMergeMirror(tenantReminders, claimedDogIds, queryBatchImpl) {
  let claimedReminders = []
  if (claimedDogIds.length > 0) {
    const batches = chunk(claimedDogIds, BATCH_SIZE)
    const results = await Promise.all(batches.map(b => queryBatchImpl(b)))
    claimedReminders = results.flat()
  }
  const merged = new Map()
  for (const r of [...tenantReminders, ...claimedReminders]) merged.set(r.id, r)
  return Array.from(merged.values())
}

await checkAsync('41 claimed dogs (3 batches) — ALL 41 claimed reminders are present in the merged result, none truncated', async () => {
  const claimedDogIds = Array.from({ length: 41 }, (_, i) => `dog_${i}`)
  const queryBatchImpl = async (batch) => batch.map(dogId => ({ id: `rem_${dogId}`, dogId, status: 'pending' }))
  const result = await claimedBatchMergeMirror([], claimedDogIds, queryBatchImpl)
  return result.length === 41 && claimedDogIds.every(dogId => result.some(r => r.dogId === dogId))
})

await checkAsync('Merged results are deduplicated by id when a claimed reminder id collides with a tenant reminder id', async () => {
  const tenantReminders = [{ id: 'rem_shared', dogId: 'dogA', status: 'pending', source: 'tenant' }]
  const claimedDogIds = ['dogA', 'dogB']
  const queryBatchImpl = async (batch) => batch.map(dogId =>
    dogId === 'dogA'
      ? { id: 'rem_shared', dogId, status: 'pending', source: 'claimed' } // same id as the tenant reminder
      : { id: `rem_${dogId}`, dogId, status: 'pending', source: 'claimed' }
  )
  const result = await claimedBatchMergeMirror(tenantReminders, claimedDogIds, queryBatchImpl)
  const shared = result.filter(r => r.id === 'rem_shared')
  // Map-based merge means the LAST write wins — claimed overwrites tenant
  // for a colliding id, matching the existing (pre-batching) merge order
  // in all three db.ts functions: `[...tenantReminders, ...claimedReminders]`.
  return result.length === 2 && shared.length === 1 && shared[0].source === 'claimed'
})

await checkAsync('Zero claimed dogs skips the claimed query entirely and returns tenant reminders only — a legitimate success, not a failure', async () => {
  const tenantReminders = [{ id: 't1', dogId: 'dogT', status: 'pending' }]
  let batchQueryCalled = false
  const queryBatchImpl = async () => { batchQueryCalled = true; return [] }
  const result = await claimedBatchMergeMirror(tenantReminders, [], queryBatchImpl)
  return result.length === 1 && result[0].id === 't1' && !batchQueryCalled
})

await checkAsync('Zero total reminders (no tenant, no claimed) returns a successful empty array — not an error', async () => {
  const result = await claimedBatchMergeMirror([], [], async () => [])
  return Array.isArray(result) && result.length === 0
})

await checkAsync('41 claimed dogs (3 batches) — a failure in the THIRD batch rejects the whole call, never a partial 40-of-41 result', async () => {
  const claimedDogIds = Array.from({ length: 41 }, (_, i) => `dog_${i}`)
  let batchIndex = -1
  const queryBatchImpl = async (batch) => {
    batchIndex++
    if (batchIndex === 2) throw new Error('permission-denied (simulated)')
    return batch.map(dogId => ({ id: `rem_${dogId}`, dogId, status: 'pending' }))
  }
  try {
    await claimedBatchMergeMirror([], claimedDogIds, queryBatchImpl)
    return false // must not resolve — a batch failure must reject the whole call
  } catch {
    return true
  }
})

await checkAsync('21 claimed dogs (2 batches) — a failure in the FIRST batch rejects the whole call even though the second batch would have succeeded', async () => {
  const claimedDogIds = Array.from({ length: 21 }, (_, i) => `dog_${i}`)
  const queryBatchImpl = async (batch) => {
    if (batch.length === 20) throw new Error('permission-denied (simulated)')
    return batch.map(dogId => ({ id: `rem_${dogId}`, dogId, status: 'pending' }))
  }
  try {
    await claimedBatchMergeMirror([], claimedDogIds, queryBatchImpl)
    return false
  } catch {
    return true
  }
})

// ── Existing status-filtering/ordering-preservation contract (getAllPendingReminders) ──

await checkAsync('Status filtering (pending/overdue only) still applies correctly across a multi-batch claimed result', async () => {
  const claimedDogIds = Array.from({ length: 25 }, (_, i) => `dog_${i}`) // 2 batches
  const queryBatchImpl = async (batch) => batch.map((dogId, i) => ({
    id: `rem_${dogId}`, dogId, status: i % 2 === 0 ? 'pending' : 'completed',
  }))
  const merged = await claimedBatchMergeMirror([], claimedDogIds, queryBatchImpl)
  const filtered = merged.filter(r => ['pending', 'overdue'].includes(r.status))
  return filtered.length === Math.ceil(25 / 2) && filtered.every(r => r.status === 'pending')
})

await summary()
