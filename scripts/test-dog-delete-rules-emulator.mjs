// scripts/test-dog-delete-rules-emulator.mjs — REAL Firestore Rules
// emulator test proving the dogs/{dogId} `allow delete` rule itself
// (not just the client-side UI mirror in src/lib/utils.ts) permanently
// denies deletion of any dog carrying transfer/claim history, while still
// allowing legitimate deletion of an eligible, never-transferred dog.
//
// This is the authoritative half of the Dog Detail Delete-button fix —
// scripts/test-dog-delete-gating.mjs covers the client-side UI mirror
// (isDogHistoryBearing/isDogDeletableByUser + DogDetailPage.tsx wiring)
// via structural assertions; this file proves the ACTUAL enforced rule
// behaves the same way, so a direct client write (bypassing the UI
// entirely — devtools, a modified build, a stray deleteDoc() call) is
// denied just as reliably as the gated button.
//
// Requires a running Firestore emulator on localhost:8080 (firebase.json).
// Usage: firebase emulators:exec --project demo-idogs-dog-delete-test \
//          "node scripts/test-dog-delete-rules-emulator.mjs"

import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore'
import { makeChecker } from './_lib/test-check.mjs'

const { checkAsync, summary } = makeChecker()

const PROJECT_ID = 'demo-idogs-dog-delete-test'
const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

const BREEDER = 'breederA'
const OWNER = 'ownerB'
const STRANGER = 'strangerC'

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: RULES, host: 'localhost', port: 8080 },
})

async function seedDog(id, data) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), `dogs/${id}`), {
      tenantId: BREEDER,
      name: 'Test Dog',
      breed: 'Labrador Retriever',
      status: 'active',
      ...data,
    })
  })
}

async function dogExists(id) {
  // withSecurityRulesDisabled() does not forward its callback's return
  // value — capture via closure instead.
  let exists = false
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const snap = await getDoc(doc(ctx.firestore(), `dogs/${id}`))
    exists = snap.exists()
  })
  return exists
}

// ── Required scenario 1: transferred/claimed dog — direct deletion denied ──

await checkAsync('Breeder cannot delete own dog mid-pendingClaim (real Rules denial)', async () => {
  await seedDog('dog-pending', {
    currentOwnerId: BREEDER, status: 'transferred', transferStatus: 'pendingClaim',
    previousOwnerId: BREEDER, buyerEmail: 'buyer@example.com', transferredAt: '2026-01-01',
  })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(deleteDoc(doc(db, 'dogs/dog-pending')))
  return await dogExists('dog-pending')
})

await checkAsync('Former breeder cannot delete a dog already claimed by the buyer (currentOwnerId no longer theirs)', async () => {
  await seedDog('dog-claimed-by-other', {
    currentOwnerId: OWNER, status: 'active',
    previousOwnerId: BREEDER, buyerEmail: 'buyer@example.com', transferredAt: '2026-01-01',
    claimedAt: '2026-01-02', claimedBy: OWNER,
  })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(deleteDoc(doc(db, 'dogs/dog-claimed-by-other')))
  return await dogExists('dog-claimed-by-other')
})

// ── Required scenario 2: breeder-issued claimed dog — direct deletion denied
//    (status reverted to 'active' post-claim; only history fields still
//    block it — the exact QA_TEST-reminder-tony shape) ──

await checkAsync('Owner cannot delete their OWN claimed dog even though status is back to active (real Rules denial via history fields)', async () => {
  await seedDog('dog-claimed-active', {
    currentOwnerId: OWNER, status: 'active',
    previousOwnerId: BREEDER, buyerEmail: 'buyer@example.com', transferredAt: '2026-01-01',
    claimedAt: '2026-01-02', claimedBy: OWNER,
  })
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertFails(deleteDoc(doc(db, 'dogs/dog-claimed-active')))
  return await dogExists('dog-claimed-active')
})

await checkAsync('Owner cannot delete their claimed dog while it is restricted either (same history-field denial, independent of status)', async () => {
  await seedDog('dog-claimed-restricted', {
    currentOwnerId: OWNER, status: 'restricted',
    previousOwnerId: BREEDER, buyerEmail: 'buyer@example.com', transferredAt: '2026-01-01',
    claimedAt: '2026-01-02', claimedBy: OWNER,
  })
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertFails(deleteDoc(doc(db, 'dogs/dog-claimed-restricted')))
  return await dogExists('dog-claimed-restricted')
})

// ── Required scenario 3: eligible never-transferred dog — existing Delete behaviour preserved ──

await checkAsync('Owner CAN delete their own never-transferred, history-free dog (existing legitimate behaviour unchanged)', async () => {
  await seedDog('dog-eligible', { currentOwnerId: OWNER, status: 'active' })
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertSucceeds(deleteDoc(doc(db, 'dogs/dog-eligible')))
  return !(await dogExists('dog-eligible'))
})

await checkAsync('Owner CAN delete a restricted (over-cap) dog that was NEVER transferred — Rules only exclude literal transferred status + history fields', async () => {
  await seedDog('dog-restricted-clean', { currentOwnerId: OWNER, status: 'restricted' })
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertSucceeds(deleteDoc(doc(db, 'dogs/dog-restricted-clean')))
  return !(await dogExists('dog-restricted-clean'))
})

await checkAsync('Owner CAN delete an archived dog that was NEVER transferred', async () => {
  await seedDog('dog-archived-clean', { currentOwnerId: OWNER, status: 'archived' })
  const db = testEnv.authenticatedContext(OWNER).firestore()
  await assertSucceeds(deleteDoc(doc(db, 'dogs/dog-archived-clean')))
  return !(await dogExists('dog-archived-clean'))
})

// ── Unrelated third party denied regardless of the dog's own state ──

await checkAsync('Unrelated stranger cannot delete an eligible dog they have no relationship to', async () => {
  await seedDog('dog-eligible-2', { currentOwnerId: OWNER, status: 'active' })
  const db = testEnv.authenticatedContext(STRANGER).firestore()
  await assertFails(deleteDoc(doc(db, 'dogs/dog-eligible-2')))
  return await dogExists('dog-eligible-2')
})

// NOTE: api/set-dog-status.js's archive/restore/activate/restrict actions
// (the "archive instead" alternative the UI now offers) run via the
// Admin SDK, bypassing these client Rules entirely, and already have
// their own test coverage elsewhere (e.g. test-dog-cap.mjs,
// test-pricing-integration-checks.mjs) — not re-verified here.

// cleanup() MUST run before summary() — summary() calls process.exit()
// internally (see _lib/test-check.mjs), so anything after it never runs.
await testEnv.cleanup()
await summary()
