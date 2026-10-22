import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, updateDoc } from 'firebase/firestore'
import { requireAccountWrites } from '../api/_lib/account-write-fence.js'
import { buildDeletionInventory } from '../api/_lib/account-deletion-inventory.js'
import { newRenewalTask, deletionCommitment } from '../api/_lib/account-deletion-policy.js'
const projectId='demo-idogs-account-deletion'
for(const [key,port] of [['FIRESTORE_EMULATOR_HOST','8080'],['FIREBASE_AUTH_EMULATOR_HOST','9099'],['FIREBASE_STORAGE_EMULATOR_HOST','9199']]) {
  if(process.env.GCLOUD_PROJECT!==projectId || !new RegExp(`^(127\\.0\\.0\\.1|localhost):${port}$`).test(process.env[key]||'')) throw Error('emulator_only')
}
let app,db,env
before(async()=>{
  app=initializeApp({projectId},'isolated-backend-boundary');db=getFirestore(app)
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}})
})
after(async()=>{await env?.cleanup();await db?.terminate();if(app)await deleteApp(app)})
test('unchanged production Rules permit a client write despite a server fence; inventory never claims ready',async()=>{
  const uid='qa-isolated-boundary',dogId='qa-isolated-boundary-dog'
  await db.doc(`users/${uid}`).set({email:'synthetic@example.invalid'})
  await db.doc(`dogs/${dogId}`).set({tenantId:uid,currentOwnerId:uid,status:'active',name:'Synthetic'})
  await db.doc(`accountDeletionFences/${uid}`).set({state:'frozen'})
  // This success documents the remaining release boundary. It is not a
  // freeze PASS and must never be used to enable permanent deletion.
  await assertSucceeds(updateDoc(doc(env.authenticatedContext(uid).firestore(),`dogs/${dogId}`),{name:'Synthetic client update'}))
  await assert.rejects(db.runTransaction(async tx=>{
    await requireAccountWrites(tx,db,uid)
    tx.update(db.doc(`dogs/${dogId}`),{name:'Forbidden server update'})
  }), error=>error.code==='account_writes_frozen')
  assert.equal((await db.doc(`dogs/${dogId}`).get()).data().name,'Synthetic client update')
  const inventory=await buildDeletionInventory({db,uid})
  assert.equal(inventory.readyForDeletion,false)
  assert.ok(inventory.holds.includes('write_freeze_not_verified'))
})
test('production request policy still cannot dispatch subscription cancellation',()=>{
  const commitment=deletionCommitment(1792612800000)
  const task=newRenewalTask({uid:'qa-isolated-policy',revision:1,commitment})
  assert.equal(task.executionEnabled,false)
  assert.equal(task.restartOnDeletionCancellation,false)
})
