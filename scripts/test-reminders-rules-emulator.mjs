// scripts/test-reminders-rules-emulator.mjs — REAL Firestore Rules
// emulator test for the reminders collection's dogBelongsToUser() read-
// grant fix (see firestore.rules `match /reminders/{id}`).
//
// Unlike this repo's other test-*.mjs files (which assert on rule/db.ts
// SOURCE SHAPE — see test-pricing-integration-checks.mjs's own header),
// this one runs the actual firestore.rules text against a live Firestore
// emulator via @firebase/rules-unit-testing, because the bug this fixes
// (claimed-dog reminder queries permanently denied — see the "Production
// bug fix" comment directly above the reminders match block in
// firestore.rules) is a genuine Rules/query-shape incompatibility that no
// amount of mocked/structural testing can prove or disprove. Only a real
// emulator evaluating the real rules against the real query shape can.
//
// Requires a running Firestore emulator on localhost:8080 (firebase.json).
// Usage: firebase emulators:exec --project demo-idogs-rules-test \
//          "node scripts/test-reminders-rules-emulator.mjs"

import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  doc, setDoc, getDoc, getDocs, collection, query, where,
  updateDoc, deleteDoc, addDoc,
} from 'firebase/firestore'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, summary } = makeChecker()

const PROJECT_ID = 'demo-idogs-rules-test'
const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

const BREEDER = 'breederA'
const OWNER = 'ownerB'
const STRANGER = 'strangerC'

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: RULES, host: 'localhost', port: 8080 },
})

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    // dog1: transferred from BREEDER to OWNER — the exact "claimed dog"
    // shape (tenantId permanently stays the original breeder; see
    // api/send-reminders.js's getReminderEligibleDogs() comment).
    await setDoc(doc(db, 'dogs/dog1'), { tenantId: BREEDER, currentOwnerId: OWNER, status: 'active' })
    // dog2: BREEDER's own dog, never transferred.
    await setDoc(doc(db, 'dogs/dog2'), { tenantId: BREEDER, currentOwnerId: BREEDER, status: 'active' })
    // dog3: unrelated — owned entirely by STRANGER, no relationship to OWNER.
    await setDoc(doc(db, 'dogs/dog3'), { tenantId: STRANGER, currentOwnerId: STRANGER, status: 'active' })

    // rem1: a reminder on the CLAIMED dog1, still tagged with the
    // ORIGINAL breeder's tenantId — never reassigned (dog.tenantId is
    // permanent), so this is the exact document the production bug could
    // never surface to OWNER.
    await setDoc(doc(db, 'reminders/rem1'), { dogId: 'dog1', tenantId: BREEDER, status: 'pending', title: 'Vaccine' })
    // rem2: BREEDER's own reminder on their own dog2 — must keep working
    // via the pre-existing tenantId path, unchanged.
    await setDoc(doc(db, 'reminders/rem2'), { dogId: 'dog2', tenantId: BREEDER, status: 'pending', title: 'Worming' })
    // rem3: STRANGER's reminder on dog3 — OWNER has no relationship to this.
    await setDoc(doc(db, 'reminders/rem3'), { dogId: 'dog3', tenantId: STRANGER, status: 'pending', title: 'Vaccine' })
  })
}

await seed()

// ── 1. Current owner (currentOwnerId==uid, tenantId!=uid) can get/list
//      reminders for the claimed dog ─────────────────────────────────

await checkAsync('OWNER can GET rem1 (claimed dog1, reminder still tagged with breeder tenantId)', async () => {
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertSucceeds(getDoc(doc(db, 'reminders/rem1')))
  return true
})

await checkAsync('OWNER can LIST reminders via the real dogId-only claimed-dog query shape (matches db.ts getReminders)', async () => {
  const db = testEnv.authenticatedContext(OWNER).firestore()
  const snap = await assertSucceeds(getDocs(query(collection(db, 'reminders'), where('dogId', '==', 'dog1'))))
  return snap.size === 1 && snap.docs[0].id === 'rem1'
})

await checkAsync('OWNER can LIST reminders via the real dogId "in" claimed-dog query shape (matches db.ts getAllPendingReminders/getAllRemindersForUser)', async () => {
  const db = testEnv.authenticatedContext(OWNER).firestore()
  const snap = await assertSucceeds(getDocs(query(collection(db, 'reminders'), where('dogId', 'in', ['dog1']))))
  return snap.size === 1 && snap.docs[0].id === 'rem1'
})

// ── 2. Original breeder can still read historical reminders (unchanged) ──

await checkAsync('BREEDER (tenantId match) can still GET rem1 — pre-existing provenance access unchanged', async () => {
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertSucceeds(getDoc(doc(db, 'reminders/rem1')))
  return true
})

await checkAsync('BREEDER can still LIST their own reminders via the tenant-scoped query — unchanged', async () => {
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  const snap = await assertSucceeds(getDocs(query(collection(db, 'reminders'), where('tenantId', '==', BREEDER))))
  return snap.size === 2 && new Set(snap.docs.map(d => d.id)).has('rem1') && new Set(snap.docs.map(d => d.id)).has('rem2')
})

// ── 3. Unrelated third party cannot get/list ──────────────────────────

await checkAsync('STRANGER cannot GET rem1 (no tenantId match, no dog relationship)', async () => {
  const db = testEnv.authenticatedContext(STRANGER).firestore()
  await assertFails(getDoc(doc(db, 'reminders/rem1')))
  return true
})

await checkAsync('STRANGER cannot LIST rem1 via dogId query', async () => {
  const db = testEnv.authenticatedContext(STRANGER).firestore()
  await assertFails(getDocs(query(collection(db, 'reminders'), where('dogId', '==', 'dog1'))))
  return true
})

// ── 4. Claimed owner cannot create/update/delete through the new read grant ──

await checkAsync('OWNER cannot UPDATE rem1 (tenantId still BREEDER — write rules untouched by this fix)', async () => {
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertFails(updateDoc(doc(db, 'reminders/rem1'), { status: 'completed' }))
  return true
})

await checkAsync('OWNER cannot DELETE rem1 (tenantId still BREEDER — write rules untouched by this fix)', async () => {
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertFails(deleteDoc(doc(db, 'reminders/rem1')))
  return true
})

await checkAsync('OWNER cannot CREATE a reminder impersonating BREEDER as tenantId (create rule untouched)', async () => {
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertFails(setDoc(doc(db, 'reminders/rem-forged'), { dogId: 'dog1', tenantId: BREEDER, status: 'pending' }))
  return true
})

// ── 5. A query mixing an authorised dogId and an unauthorised dogId is denied in full ──

await checkAsync('OWNER querying dogId IN [authorised dog1, unrelated dog3] is denied IN FULL — no partial results', async () => {
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertFails(getDocs(query(collection(db, 'reminders'), where('dogId', 'in', ['dog1', 'dog3']))))
  return true
})

// ── 6. Tenant-scoped reads/writes continue to behave exactly as before ──

await checkAsync('BREEDER can still UPDATE their own reminder (tenantId match) — unchanged', async () => {
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertSucceeds(updateDoc(doc(db, 'reminders/rem2'), { status: 'completed' }))
  return true
})

await checkAsync('BREEDER can still DELETE their own reminder (tenantId match) — unchanged', async () => {
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertSucceeds(deleteDoc(doc(db, 'reminders/rem2')))
  return true
})

await checkAsync('BREEDER can still CREATE a reminder with their own tenantId — unchanged', async () => {
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertSucceeds(setDoc(doc(db, 'reminders/rem-new'), { dogId: 'dog2', tenantId: BREEDER, status: 'pending' }))
  return true
})

// ── 7. Query-scale / access-call limit test ─────────────────────────
//
// Empirically bisected in an earlier round: a SINGLE unbatched `in`
// query against these rules succeeds up to exactly 20 distinct dogIds
// and is denied at 21+ — Firestore's documented per-query cap on
// get()/exists() calls during rule evaluation (dogBelongsToUser()'s
// fallback get() fires once per dogId whose reminder tenantId doesn't
// already match the caller). That is DIFFERENT from — and lower than —
// Firestore's own native `in`-operator value limit (30), which is why a
// single unbatched query is not a safe design here even within
// Firestore's own query limits. db.ts's queryRemindersByDogIds() works
// around this by batching into chunks of 20 and querying every batch in
// parallel (see src/lib/db.ts). This section re-confirms the raw
// single-query boundary, then proves that BATCHED querying — the exact
// mechanism the app now uses — succeeds and covers every claimed dog at
// each of the required totals.

function chunk(items, size) {
  const batches = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

async function seedClaimedFleet(count) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (let i = 0; i < count; i++) {
      const dogId = `fleet_dog_${i}`
      await setDoc(doc(db, `dogs/${dogId}`), { tenantId: BREEDER, currentOwnerId: OWNER, status: 'active' })
      await setDoc(doc(db, `reminders/fleet_rem_${i}`), { dogId, tenantId: BREEDER, status: 'pending', title: `Vaccine ${i}` })
    }
  })
}

// 7a. Raw single-query boundary — 20 succeeds, 21 fails, as a single
// unbatched `in` query (confirms the platform ceiling itself, independent
// of the app's own batching).
await checkAsync('Raw single unbatched query: 20 distinct dogIds succeeds', async () => {
  await seedClaimedFleet(20)
  const dogIds = Array.from({ length: 20 }, (_, i) => `fleet_dog_${i}`)
  const db = testEnv.authenticatedContext(OWNER).firestore()
  const snap = await assertSucceeds(getDocs(query(collection(db, 'reminders'), where('dogId', 'in', dogIds))))
  return snap.size === 20
})

await checkAsync('Raw single unbatched query: 21 distinct dogIds is denied — documented platform behavior, confirms batching is required', async () => {
  await seedClaimedFleet(21)
  const dogIds = Array.from({ length: 21 }, (_, i) => `fleet_dog_${i}`)
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertFails(getDocs(query(collection(db, 'reminders'), where('dogId', 'in', dogIds))))
  return true
})

// 7b. Batched querying (mirrors db.ts's actual queryRemindersByDogIds
// shape) at every required total: 1, 20, 21, 30, 40, 41.
for (const total of [1, 20, 21, 30, 40, 41]) {
  const expectedBatches = Math.ceil(total / 20)
  await checkAsync(
    `Batched (chunks of 20) claimed-dog query at total=${total} → ${expectedBatches} batch(es), all succeed, union covers all ${total} reminders`,
    async () => {
      await seedClaimedFleet(total)
      const dogIds = Array.from({ length: total }, (_, i) => `fleet_dog_${i}`)
      const batches = chunk(dogIds, 20)
      if (batches.length !== expectedBatches) return false
      const db = testEnv.authenticatedContext(OWNER).firestore()
      const snaps = await Promise.all(
        batches.map(b => assertSucceeds(getDocs(query(collection(db, 'reminders'), where('dogId', 'in', b)))))
      )
      const allDocIds = new Set(snaps.flatMap(s => s.docs.map(d => d.id)))
      return allDocIds.size === total
    }
  )
}

// cleanup() MUST run before summary() — summary() calls process.exit()
// internally (see _lib/test-check.mjs), so anything after it never runs.
await testEnv.cleanup()
await summary()
