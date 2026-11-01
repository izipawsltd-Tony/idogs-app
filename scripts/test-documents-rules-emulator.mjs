// scripts/test-documents-rules-emulator.mjs — REAL Firestore Rules emulator
// test for documents/{id} update hardening (Phase 2 security fix, 01 Nov 2026).
//
// Proves: owner can rename/edit display metadata (View → Edit → Delete flow);
// owner can NOT repoint dogId/tenantId/filePath; strangers can't edit or delete.
//
// Usage: npx firebase-tools@14.12.0 emulators:exec --project demo-idogs-rules-test \
//          --only firestore "node scripts/test-documents-rules-emulator.mjs"

import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore'
import { makeChecker } from './_lib/test-check.mjs'

const { checkAsync, summary } = makeChecker()
const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
const OWNER = 'ownerA'
const VICTIM = 'victimB'
const STRANGER = 'strangerC'

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-idogs-rules-test',
  firestore: { rules: RULES, host: 'localhost', port: 8080 },
})

async function seed() {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'dogs/ownDog'), { tenantId: OWNER, currentOwnerId: OWNER, status: 'active' })
    await setDoc(doc(db, 'dogs/victimDog'), { tenantId: VICTIM, currentOwnerId: VICTIM, status: 'active' })
    await setDoc(doc(db, 'documents/doc1'), {
      dogId: 'ownDog', tenantId: OWNER, documentType: 'vaccine',
      filePath: `documents/${OWNER}/ownDog/a.pdf`, name: 'Old name', title: 'Old name',
    })
    await setDoc(doc(db, 'vaccineRecords/vac1'), { dogId: 'ownDog', tenantId: OWNER, name: 'C5', dateGiven: '2026-01-01' })
    await setDoc(doc(db, 'healthTests/ht1'), { dogId: 'ownDog', tenantId: OWNER, testType: 'hips', result: '4/5' })
    await setDoc(doc(db, 'wormingRecords/w1'), { dogId: 'ownDog', tenantId: OWNER, product: 'X' })
    await setDoc(doc(db, 'activityNotes/n1'), { dogId: 'ownDog', createdBy: OWNER, note: 'hi' })
  })
}

const as = uid => testEnv.authenticatedContext(uid).firestore()

await seed()
await checkAsync('owner can read own document', () => assertSucceeds(getDoc(doc(as(OWNER), 'documents/doc1'))))
await checkAsync('owner can rename (name)', () => assertSucceeds(updateDoc(doc(as(OWNER), 'documents/doc1'), { name: 'Rabies cert 2026' })))
await checkAsync('owner can clear name (deleteField)', () => assertSucceeds(updateDoc(doc(as(OWNER), 'documents/doc1'), { name: deleteField() })))
await checkAsync('owner can set manual-upload metadata (name,title,notes,source)', () =>
  assertSucceeds(updateDoc(doc(as(OWNER), 'documents/doc1'), { name: 'x', title: 'x', notes: null, source: 'manual' })))
await checkAsync('owner CANNOT repoint dogId to victim dog', () =>
  assertFails(updateDoc(doc(as(OWNER), 'documents/doc1'), { dogId: 'victimDog' })))
await checkAsync('owner CANNOT change tenantId', () =>
  assertFails(updateDoc(doc(as(OWNER), 'documents/doc1'), { tenantId: VICTIM })))
await checkAsync('owner CANNOT change filePath', () =>
  assertFails(updateDoc(doc(as(OWNER), 'documents/doc1'), { filePath: `documents/${VICTIM}/victimDog/b.pdf` })))
await checkAsync('owner CANNOT smuggle dogId alongside a rename', () =>
  assertFails(updateDoc(doc(as(OWNER), 'documents/doc1'), { name: 'ok', dogId: 'victimDog' })))
await checkAsync('stranger CANNOT rename', () => assertFails(updateDoc(doc(as(STRANGER), 'documents/doc1'), { name: 'pwned' })))
await checkAsync('stranger CANNOT delete', () => assertFails(deleteDoc(doc(as(STRANGER), 'documents/doc1'))))
await checkAsync('signed-out CANNOT rename', () =>
  assertFails(updateDoc(doc(testEnv.unauthenticatedContext().firestore(), 'documents/doc1'), { name: 'x' })))
await checkAsync('owner can delete own document', () => assertSucceeds(deleteDoc(doc(as(OWNER), 'documents/doc1'))))

// Sibling dog-scoped collections: edits allowed, ownership keys immutable.
await seed()
await checkAsync('owner can edit vaccine record fields', () =>
  assertSucceeds(updateDoc(doc(as(OWNER), 'vaccineRecords/vac1'), { name: 'C5 booster', nextDue: '2027-01-01', uncertain: false })))
await checkAsync('owner CANNOT move vaccine record onto victim dog (QR passport injection)', () =>
  assertFails(updateDoc(doc(as(OWNER), 'vaccineRecords/vac1'), { dogId: 'victimDog' })))
await checkAsync('owner CANNOT change vaccine tenantId', () =>
  assertFails(updateDoc(doc(as(OWNER), 'vaccineRecords/vac1'), { tenantId: VICTIM })))
await checkAsync('owner can edit health test + documentPath', () =>
  assertSucceeds(updateDoc(doc(as(OWNER), 'healthTests/ht1'), { result: '5/5', documentPath: 'x/y.pdf' })))
await checkAsync('owner CANNOT move health test to victim dog', () =>
  assertFails(updateDoc(doc(as(OWNER), 'healthTests/ht1'), { dogId: 'victimDog' })))
await checkAsync('owner CANNOT move worming record to victim dog', () =>
  assertFails(updateDoc(doc(as(OWNER), 'wormingRecords/w1'), { dogId: 'victimDog' })))
await checkAsync('owner can edit activity note text', () =>
  assertSucceeds(updateDoc(doc(as(OWNER), 'activityNotes/n1'), { note: 'edited' })))
await checkAsync('owner CANNOT reassign activity note createdBy', () =>
  assertFails(updateDoc(doc(as(OWNER), 'activityNotes/n1'), { createdBy: VICTIM })))
await checkAsync('owner can still delete own vaccine record', () =>
  assertSucceeds(deleteDoc(doc(as(OWNER), 'vaccineRecords/vac1'))))

await testEnv.cleanup()
await summary()
