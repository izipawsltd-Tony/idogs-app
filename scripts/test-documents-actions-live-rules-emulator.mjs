// Documents View/Edit/Delete under the CURRENT (live-equivalent) firestore.rules
// of this release candidate — proves the UI does not depend on rules changes.
// Usage: npx firebase-tools@14.12.0 emulators:exec --project demo-idogs-live-rules \
//          --only firestore "node scripts/test-documents-actions-live-rules-emulator.mjs"
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, deleteField } from 'firebase/firestore'
import { makeChecker } from './_lib/test-check.mjs'

const { checkAsync, summary } = makeChecker()
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-idogs-live-rules',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: 'localhost', port: 8080 },
})
const OWNER = 'ownerA', STRANGER = 'strangerB', BUYER = 'buyerC'
const ok = p => assertSucceeds(p).then(() => true)
const denied = p => assertFails(p).then(() => true)
const as = uid => testEnv.authenticatedContext(uid).firestore()
await testEnv.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'dogs/d1'), { tenantId: OWNER, currentOwnerId: OWNER, status: 'active', name: 'Ruby' })
  await setDoc(doc(db, 'dogs/d2'), { tenantId: OWNER, currentOwnerId: BUYER, status: 'active', name: 'Sold pup' })
  await setDoc(doc(db, 'documents/a'), { dogId: 'd1', tenantId: OWNER, documentType: 'vaccine_card', title: 'Vet letter', filePath: `documents/${OWNER}/d1/a.pdf` })
  await setDoc(doc(db, 'documents/b'), { dogId: 'd1', tenantId: OWNER, documentType: 'other', title: 'To delete', filePath: `documents/${OWNER}/d1/b.pdf` })
  await setDoc(doc(db, 'documents/c'), { dogId: 'd2', tenantId: OWNER, documentType: 'contract', title: 'Transferred', filePath: `documents/${OWNER}/d2/c.pdf` })
})
// View (list + read metadata used to request a signed URL)
await checkAsync('owner lists own dog documents (View list)', () => ok(getDocs(query(collection(as(OWNER), 'documents'), where('dogId', '==', 'd1')))))
await checkAsync('owner reads document metadata (View)', () => ok(getDoc(doc(as(OWNER), 'documents/a'))))
await checkAsync('stranger cannot read document metadata', () => denied(getDoc(doc(as(STRANGER), 'documents/a'))))
// Edit (rename writes documents.name only — exactly what updateDocument() sends)
await checkAsync('owner renames document (Edit)', () => ok(updateDoc(doc(as(OWNER), 'documents/a'), { name: 'Desexing letter' })))
await checkAsync('owner clears custom name (Edit with empty name)', () => ok(updateDoc(doc(as(OWNER), 'documents/a'), { name: deleteField() })))
await checkAsync('stranger cannot rename', () => denied(updateDoc(doc(as(STRANGER), 'documents/a'), { name: 'x' })))
await checkAsync('signed-out cannot rename', () => denied(updateDoc(doc(testEnv.unauthenticatedContext().firestore(), 'documents/a'), { name: 'x' })))
await checkAsync('former breeder cannot rename a transferred dog document', () => denied(updateDoc(doc(as(OWNER), 'documents/c'), { name: 'x' })))
await checkAsync('current owner (buyer) can rename transferred dog document', () => ok(updateDoc(doc(as(BUYER), 'documents/c'), { name: 'Contract' })))
// Delete
await checkAsync('stranger cannot delete', () => denied(deleteDoc(doc(as(STRANGER), 'documents/b'))))
await checkAsync('owner deletes document (Delete)', () => ok(deleteDoc(doc(as(OWNER), 'documents/b'))))
await testEnv.cleanup()
await summary()
