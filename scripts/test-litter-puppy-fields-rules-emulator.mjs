// scripts/test-litter-puppy-fields-rules-emulator.mjs — REAL Firestore
// Rules emulator test proving the dogs/{dogId} update rule's
// dogProtectedFieldsUnchanged() helper makes `litterId`,
// `retainedByBreeder`, and (Codex fix-round, Finding 3) `restrictionReason`
// fully immutable via any DIRECT client write (add, change, or remove) —
// Pricing v1.2's core anti-forgery guarantee, since all three fields are
// exactly what api/_lib/dog-cap.js's isEligibleForCap()/reconciliation
// trust to distinguish an unpromoted litter puppy from a promoted/
// retained breeding dog, and a provably cap-driven restriction from any
// other kind.
//
// Companion to scripts/test-litter-puppy-cap-v1.2.mjs, which covers the
// real HTTP endpoints (server-side, Admin SDK — bypasses these Rules
// entirely) and the cross-runtime predicate agreement. This file proves
// the CLIENT-facing half: even a direct devtools/modified-build Firestore
// write, with no server endpoint involved at all, cannot forge or erase
// any of the three fields. Follows the exact @firebase/rules-unit-testing
// pattern established in test-dog-delete-rules-emulator.mjs.
//
// Requires a running Firestore emulator on localhost:8080 (firebase.json).
// Usage: firebase emulators:exec --project demo-idogs-litter-fields-test \
//          "node scripts/test-litter-puppy-fields-rules-emulator.mjs"

import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteField, getDoc } from 'firebase/firestore'
import { makeChecker } from './_lib/test-check.mjs'

const { checkAsync, summary } = makeChecker()

const PROJECT_ID = 'demo-idogs-litter-fields-test'
const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

const BREEDER = 'breederA'

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: RULES, host: 'localhost', port: 8080 },
})

async function seedDog(id, data) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), `dogs/${id}`), {
      tenantId: BREEDER, currentOwnerId: BREEDER, createdByUserId: BREEDER,
      name: 'Test Puppy', breed: 'Labrador Retriever', status: 'active', isDeceased: false,
      ...data,
    })
  })
}

async function fieldValue(id, field) {
  let value
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const snap = await getDoc(doc(ctx.firestore(), `dogs/${id}`))
    value = snap.data()[field]
  })
  return value
}

// ── litterId is immutable — cannot be added, changed, or removed directly ──

await checkAsync('Breeder cannot ADD a litterId directly to a standalone dog they own (real Rules denial)', async () => {
  await seedDog('dog-add-litterid', {})
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/dog-add-litterid'), { litterId: 'forged-litter' }))
  return (await fieldValue('dog-add-litterid', 'litterId')) === undefined
})

await checkAsync('Breeder cannot CHANGE an existing litterId directly (e.g. to relabel provenance)', async () => {
  await seedDog('dog-change-litterid', { litterId: 'litter-real' })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/dog-change-litterid'), { litterId: 'litter-forged' }))
  return (await fieldValue('dog-change-litterid', 'litterId')) === 'litter-real'
})

await checkAsync('Breeder cannot REMOVE an existing litterId directly (e.g. to escape the litter-puppy cap exemption\'s counting logic or vice versa)', async () => {
  await seedDog('dog-remove-litterid', { litterId: 'litter-real' })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/dog-remove-litterid'), { litterId: deleteField() }))
  return (await fieldValue('dog-remove-litterid', 'litterId')) === 'litter-real'
})

// ── retainedByBreeder is immutable — the exact self-promotion forgery this field exists to prevent ──

await checkAsync('Breeder cannot self-promote a puppy by directly setting retainedByBreeder:true (must go through the cap-checked promote action)', async () => {
  await seedDog('dog-add-retained', { litterId: 'litter-real' })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/dog-add-retained'), { retainedByBreeder: true }))
  return (await fieldValue('dog-add-retained', 'retainedByBreeder')) === undefined
})

await checkAsync('Breeder cannot directly flip retainedByBreeder from true back to false either (must go through the unpromote action)', async () => {
  await seedDog('dog-change-retained', { litterId: 'litter-real', retainedByBreeder: true })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/dog-change-retained'), { retainedByBreeder: false }))
  return (await fieldValue('dog-change-retained', 'retainedByBreeder')) === true
})

await checkAsync('Breeder cannot REMOVE an existing retainedByBreeder field directly', async () => {
  await seedDog('dog-remove-retained', { litterId: 'litter-real', retainedByBreeder: true })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/dog-remove-retained'), { retainedByBreeder: deleteField() }))
  return (await fieldValue('dog-remove-retained', 'retainedByBreeder')) === true
})

// ── restrictionReason is immutable — Codex fix-round (Finding 3): this
// is what lets api/_lib/dog-cap.js's automatic reconciliation PROVE a
// restriction was cap-driven instead of guessing from a restricted dog's
// shape. A client that could forge/clear this directly could trick
// automatic reconciliation into reactivating a dog restricted for some
// other reason (or hide that a restriction was ever manual). ──

await checkAsync('Breeder cannot ADD a restrictionReason directly to fake a cap-driven restriction', async () => {
  await seedDog('dog-add-reason', { litterId: 'litter-real', status: 'restricted' })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/dog-add-reason'), { restrictionReason: 'plan_cap_exceeded' }))
  return (await fieldValue('dog-add-reason', 'restrictionReason')) === undefined
})

await checkAsync('Breeder cannot CHANGE an existing restrictionReason (e.g. relabel a manual restriction as cap-driven to make it eligible for auto-reconciliation)', async () => {
  await seedDog('dog-change-reason', { litterId: 'litter-real', status: 'restricted', restrictionReason: 'manual' })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/dog-change-reason'), { restrictionReason: 'plan_cap_exceeded' }))
  return (await fieldValue('dog-change-reason', 'restrictionReason')) === 'manual'
})

await checkAsync('Breeder cannot REMOVE an existing restrictionReason directly (e.g. to make a manually-restricted dog look like a legacy/ambiguous record)', async () => {
  await seedDog('dog-remove-reason', { litterId: 'litter-real', status: 'restricted', restrictionReason: 'manual' })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/dog-remove-reason'), { restrictionReason: deleteField() }))
  return (await fieldValue('dog-remove-reason', 'restrictionReason')) === 'manual'
})

// ── Sanity: an ordinary, unrelated field on the same puppy document is still editable — proves the denial above is field-specific, not a blanket lockout ──

await checkAsync('Breeder CAN still edit an ordinary field (e.g. notes) on the same litter puppy document — the protection is scoped to litterId/retainedByBreeder only', async () => {
  await seedDog('dog-edit-notes', { litterId: 'litter-real', notes: 'old note' })
  const db = testEnv.authenticatedContext(BREEDER).firestore()
  await assertSucceeds(updateDoc(doc(db, 'dogs/dog-edit-notes'), { notes: 'updated note' }))
  return (await fieldValue('dog-edit-notes', 'notes')) === 'updated note'
})

// cleanup() MUST run before summary() — summary() calls process.exit()
// internally (see _lib/test-check.mjs), so anything after it never runs.
await testEnv.cleanup()
await summary()
