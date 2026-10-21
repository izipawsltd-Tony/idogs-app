import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch, getDocs, collection, query, where } from 'firebase/firestore'

const projectId = 'demo-idogs-account-deletion'
if (process.env.GCLOUD_PROJECT !== projectId || !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('emulator_only')
let env, seq = 0
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080,
    rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } })
})
after(async () => { await env?.cleanup() })
async function seed(entries) {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore(), batch = writeBatch(db)
    for (const [path, data] of Object.entries(entries)) batch.set(doc(db, path), data)
    await batch.commit()
  })
}
const states = [undefined, { state: 'open' }, { state: 'frozen', revision: 1 },
  { state: 'completed', revision: 1 }, { revision: 1 }]
const operations = [
  ['profile create', 'users', 'create'], ['profile update', 'users', 'update'], ['profile delete', 'users', 'delete'],
  ['dog update', 'dogs', 'update'], ['dog delete', 'dogs', 'delete'],
  ...['vaccineRecords', 'wormingRecords', 'healthTests', 'documents', 'activityNotes', 'reminders']
    .flatMap(col => ['create', 'update', 'delete'].map(op => [`${col} ${op}`, col, op])),
  ['heat cycle delete', 'heatCycles', 'delete'],
  ['passport reservation create', 'passportReservations', 'create'], ['audit create', 'auditLogs', 'create'],
]
for (const [label, col, operation] of operations) {
  for (const state of states) {
    const allowed = !state || state.state === 'open'
    test(`${label}: ${state?.state || (state ? 'malformed' : 'absent')} fence ${allowed ? 'permits' : 'denies'} an otherwise authorized write`, async () => {
      const uid = `qa-fence-matrix-${++seq}`, dogId = `${uid}-dog`
      const data = { dogId, tenantId: uid, createdBy: uid, title: 'Synthetic', name: 'Synthetic', status: 'active' }
      const path = `${col}/${col === 'users' ? uid : col === 'dogs' ? dogId : uid}`
      const entries = { [`dogs/${dogId}`]: { currentOwnerId: uid, tenantId: 'old-breeder', status: 'active', name: 'Synthetic' } }
      if (operation !== 'create' && col !== 'dogs') entries[path] = data
      if (state) entries[`accountDeletionFences/${uid}`] = state
      await seed(entries)
      const db = env.authenticatedContext(uid).firestore(), ref = doc(db, path)
      const mutation = operation === 'create' ? setDoc(ref, data) : operation === 'delete' ? deleteDoc(ref) : updateDoc(ref, { name: 'Changed' })
      await (allowed ? assertSucceeds(mutation) : assertFails(mutation))
    })
  }
}
test('a pre-existing client cannot write after freeze; reads and current-owner record queries remain available', async () => {
  const uid = 'qa-fence-live-token', dogId = `${uid}-dog`
  await seed({ [`dogs/${dogId}`]: { tenantId: 'old-owner', currentOwnerId: uid, status: 'active' },
    [`activityNotes/${uid}`]: { dogId, createdBy: 'old-owner', note: 'Historical note' },
    [`reminders/${uid}`]: { dogId, tenantId: 'old-owner', title: 'Synthetic' }, [`users/${uid}`]: { name: 'Synthetic' } })
  const db = env.authenticatedContext(uid).firestore()
  await assertSucceeds(updateDoc(doc(db, `dogs/${dogId}`), { name: 'Before freeze' }))
  await seed({ [`accountDeletionFences/${uid}`]: { state: 'frozen', revision: 1 } })
  await assertFails(updateDoc(doc(db, `dogs/${dogId}`), { name: 'After freeze' }))
  for (const path of [`dogs/${dogId}`, `users/${uid}`, `activityNotes/${uid}`, `reminders/${uid}`]) await assertSucceeds(getDoc(doc(db, path)))
  const notes = await assertSucceeds(getDocs(query(collection(db, 'activityNotes'), where('dogId', '==', dogId))))
  assert.equal(notes.size, 1)
  const reminders = await assertSucceeds(getDocs(query(collection(db, 'reminders'), where('dogId', '==', dogId))))
  assert.equal(reminders.size, 1)
})
test('freezing the original breeder cannot freeze the new owner; former owner and strangers retain no live access', async () => {
  const breeder = 'qa-fence-former', owner = 'qa-fence-current', dogId = 'qa-fence-transferred'
  await seed({ [`accountDeletionFences/${breeder}`]: { state: 'frozen' },
    [`dogs/${dogId}`]: { currentOwnerId: owner, tenantId: breeder, status: 'active' },
    [`documents/${dogId}`]: { dogId, tenantId: breeder } })
  const db = env.authenticatedContext(owner).firestore()
  await assertSucceeds(updateDoc(doc(db, `dogs/${dogId}`), { name: 'New owner' }))
  await assertSucceeds(updateDoc(doc(db, `documents/${dogId}`), { name: 'New owner document' }))
  for (const uid of [breeder, 'qa-fence-stranger']) {
    const other = env.authenticatedContext(uid).firestore()
    await assertFails(getDoc(doc(other, `documents/${dogId}`)))
    await assertFails(updateDoc(doc(other, `dogs/${dogId}`), { name: 'Forbidden' }))
  }
})
test('legacy ownership fallback is frozen too; missing owner never authorizes a write', async () => {
  const uid = 'qa-fence-legacy'
  await seed({ 'dogs/qa-fence-legacy-dog': { tenantId: uid, status: 'active' },
    'dogs/qa-fence-no-owner': { status: 'active' }, [`accountDeletionFences/${uid}`]: { state: 'frozen' } })
  const db = env.authenticatedContext(uid).firestore()
  await assertFails(updateDoc(doc(db, 'dogs/qa-fence-legacy-dog'), { name: 'Forbidden' }))
  await assertFails(updateDoc(doc(db, 'dogs/qa-fence-no-owner'), { name: 'Forbidden' }))
})
test('clients cannot read, forge, reopen or remove server fences; a mixed batch cannot bypass them', async () => {
  const uid = 'qa-fence-server-owned', path = `accountDeletionFences/${uid}`
  await seed({ [path]: { state: 'frozen' }, [`users/${uid}`]: { name: 'Before' } })
  const db = env.authenticatedContext(uid).firestore()
  await assertFails(getDoc(doc(db, path)))
  await assertFails(setDoc(doc(db, path), { state: 'open' }))
  await assertFails(deleteDoc(doc(db, path)))
  const batch = writeBatch(db)
  batch.delete(doc(db, path)); batch.update(doc(db, `users/${uid}`), { name: 'Forbidden' })
  await assertFails(batch.commit())
  assert.equal((await getDoc(doc(db, `users/${uid}`))).data().name, 'Before')
})
test('anonymous and signed clients cannot recreate scan logs or forge server-only collections', async () => {
  for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext('qa-fence-client')]) {
    const db = ctx.firestore()
    for (const col of ['scanLogs', 'accountDeletionRequests', 'accountDeletionRenewalTasks', 'accountDeletionManifests', 'accountDeletionProgress']) {
      await assertFails(setDoc(doc(db, `${col}/qa-fence-forged`), { state: 'open', status: 'completed' }))
    }
  }
})
test('an ordinary multi-record care batch stays within Rules access-call budgets', async () => {
  const uid = 'qa-fence-batch', dogId = `${uid}-dog`
  await seed({ [`dogs/${dogId}`]: { currentOwnerId: uid, status: 'active' }, [`accountDeletionFences/${uid}`]: { state: 'open' } })
  const db = env.authenticatedContext(uid).firestore(), batch = writeBatch(db)
  for (let i = 0; i < 20; i++) batch.set(doc(db, `vaccineRecords/${uid}-${i}`), { dogId, title: 'Synthetic' })
  await assertSucceeds(batch.commit())
})
