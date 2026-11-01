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

// checkAsync() passes only on a truthy result; Firestore writes resolve to
// undefined, so convert both assertion helpers to explicit booleans.
const ok = p => assertSucceeds(p).then(() => true)
const denied = p => assertFails(p).then(() => true)
const as = uid => testEnv.authenticatedContext(uid).firestore()

await seed()
await checkAsync('owner can read own document', () => ok(getDoc(doc(as(OWNER), 'documents/doc1'))))
await checkAsync('owner can rename (name)', () => ok(updateDoc(doc(as(OWNER), 'documents/doc1'), { name: 'Rabies cert 2026' })))
await checkAsync('owner can clear name (deleteField)', () => ok(updateDoc(doc(as(OWNER), 'documents/doc1'), { name: deleteField() })))
await checkAsync('owner can set manual-upload metadata (name,title,notes,source)', () =>
  ok(updateDoc(doc(as(OWNER), 'documents/doc1'), { name: 'x', title: 'x', notes: null, source: 'manual' })))
await checkAsync('owner CANNOT repoint dogId to victim dog', () =>
  denied(updateDoc(doc(as(OWNER), 'documents/doc1'), { dogId: 'victimDog' })))
await checkAsync('owner CANNOT change tenantId', () =>
  denied(updateDoc(doc(as(OWNER), 'documents/doc1'), { tenantId: VICTIM })))
await checkAsync('owner CANNOT change filePath', () =>
  denied(updateDoc(doc(as(OWNER), 'documents/doc1'), { filePath: `documents/${VICTIM}/victimDog/b.pdf` })))
await checkAsync('owner CANNOT smuggle dogId alongside a rename', () =>
  denied(updateDoc(doc(as(OWNER), 'documents/doc1'), { name: 'ok', dogId: 'victimDog' })))
await checkAsync('stranger CANNOT rename', () => denied(updateDoc(doc(as(STRANGER), 'documents/doc1'), { name: 'pwned' })))
await checkAsync('stranger CANNOT delete', () => denied(deleteDoc(doc(as(STRANGER), 'documents/doc1'))))
await checkAsync('signed-out CANNOT rename', () =>
  denied(updateDoc(doc(testEnv.unauthenticatedContext().firestore(), 'documents/doc1'), { name: 'x' })))
await checkAsync('owner can delete own document', () => ok(deleteDoc(doc(as(OWNER), 'documents/doc1'))))

// Sibling dog-scoped collections: edits allowed, ownership keys immutable.
await seed()
await checkAsync('owner can edit vaccine record fields', () =>
  ok(updateDoc(doc(as(OWNER), 'vaccineRecords/vac1'), { name: 'C5 booster', nextDue: '2027-01-01', uncertain: false })))
await checkAsync('owner CANNOT move vaccine record onto victim dog (QR passport injection)', () =>
  denied(updateDoc(doc(as(OWNER), 'vaccineRecords/vac1'), { dogId: 'victimDog' })))
await checkAsync('owner CANNOT change vaccine tenantId', () =>
  denied(updateDoc(doc(as(OWNER), 'vaccineRecords/vac1'), { tenantId: VICTIM })))
await checkAsync('owner can edit health test + documentPath', () =>
  ok(updateDoc(doc(as(OWNER), 'healthTests/ht1'), { result: '5/5', documentPath: 'x/y.pdf' })))
await checkAsync('owner CANNOT move health test to victim dog', () =>
  denied(updateDoc(doc(as(OWNER), 'healthTests/ht1'), { dogId: 'victimDog' })))
await checkAsync('owner CANNOT move worming record to victim dog', () =>
  denied(updateDoc(doc(as(OWNER), 'wormingRecords/w1'), { dogId: 'victimDog' })))
await checkAsync('owner can edit activity note text', () =>
  ok(updateDoc(doc(as(OWNER), 'activityNotes/n1'), { note: 'edited' })))
await checkAsync('owner CANNOT reassign activity note createdBy', () =>
  denied(updateDoc(doc(as(OWNER), 'activityNotes/n1'), { createdBy: VICTIM })))
await checkAsync('owner can still delete own vaccine record', () =>
  ok(deleteDoc(doc(as(OWNER), 'vaccineRecords/vac1'))))

// ── Directive 6564223316: least-privilege boundaries ──────────────────────
// Admin: there is NO client-side admin role. Admin work goes through the
// Admin SDK (server APIs), so an 'admin' custom claim grants nothing here.
// Deleted dog: get() on a missing dog denies every write to its records.
// Deleted account: authorization follows the dog's currentOwnerId, not the
// users/{uid} profile (disabled/deleted Auth users can't mint tokens).
// QR passport + timeline are served by Admin-SDK APIs (/api/passport,
// /api/qr-documents, /api/puppy-updates), so the public never reads these
// collections directly — signed-out reads stay denied.
const BREEDER = 'breederD'
const BUYER = 'buyerE'
await testEnv.clearFirestore()
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'dogs/ownDog'), { tenantId: OWNER, currentOwnerId: OWNER, status: 'active' })
  await setDoc(doc(db, 'dogs/soldDog'), { tenantId: BREEDER, currentOwnerId: BUYER, status: 'active' })
  await setDoc(doc(db, 'documents/doc1'), { dogId: 'ownDog', tenantId: OWNER, documentType: 'vaccine', filePath: 'documents/x/a.pdf', name: 'A' })
  await setDoc(doc(db, 'documents/sold1'), { dogId: 'soldDog', tenantId: BREEDER, documentType: 'pedigree', filePath: 'documents/y/b.pdf', name: 'Pedigree' })
  await setDoc(doc(db, 'vaccineRecords/sold1'), { dogId: 'soldDog', tenantId: BREEDER, name: 'C5', dateGiven: '2026-01-01' })
  await setDoc(doc(db, 'documents/orphan1'), { dogId: 'deletedDog', tenantId: OWNER, documentType: 'other', name: 'Orphan' })
})
const adminCtx = testEnv.authenticatedContext('adminX', { admin: true, email: 'admin@example.invalid' }).firestore()
const anon = testEnv.unauthenticatedContext().firestore()
await checkAsync('admin custom claim grants NO client read of another user document', () => denied(getDoc(doc(adminCtx, 'documents/doc1'))))
await checkAsync('admin custom claim grants NO client rename', () => denied(updateDoc(doc(adminCtx, 'documents/doc1'), { name: 'x' })))
await checkAsync('admin custom claim grants NO client vaccine edit', () => denied(updateDoc(doc(adminCtx, 'vaccineRecords/sold1'), { name: 'x' })))
await checkAsync('signed-out CANNOT read documents directly (QR goes via API)', () => denied(getDoc(doc(anon, 'documents/doc1'))))
await checkAsync('signed-out CANNOT read vaccine records directly', () => denied(getDoc(doc(anon, 'vaccineRecords/sold1'))))
await checkAsync('transferred-dog BUYER can rename the dog document', () => ok(updateDoc(doc(as(BUYER), 'documents/sold1'), { name: 'Mum pedigree' })))
await checkAsync('transferred-dog BUYER can edit vaccine fields', () => ok(updateDoc(doc(as(BUYER), 'vaccineRecords/sold1'), { name: 'C5 booster' })))
await checkAsync('BUYER CANNOT rewrite tenantId (provenance) on a transferred record', () => denied(updateDoc(doc(as(BUYER), 'vaccineRecords/sold1'), { tenantId: BUYER })))
await checkAsync('former BREEDER CANNOT rename the sold dog document', () => denied(updateDoc(doc(as(BREEDER), 'documents/sold1'), { name: 'x' })))
await checkAsync('former BREEDER CANNOT delete the sold dog document', () => denied(deleteDoc(doc(as(BREEDER), 'documents/sold1'))))
await checkAsync('record of a DELETED dog cannot be edited', () => denied(updateDoc(doc(as(OWNER), 'documents/orphan1'), { name: 'x' })))
await checkAsync('owner with NO users/{uid} profile (deleted profile) still limited to own dog', async () => {
  await ok(getDoc(doc(as(OWNER), 'documents/doc1')))
  return denied(updateDoc(doc(as(OWNER), 'documents/sold1'), { name: 'x' }))
})
await checkAsync('owner CANNOT create a document on someone else\'s dog', () =>
  denied(setDoc(doc(as(OWNER), 'documents/new1'), { dogId: 'soldDog', tenantId: OWNER, name: 'fake' })))

await testEnv.cleanup()
await summary()
