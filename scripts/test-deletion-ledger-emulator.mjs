import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { createDeletionLedger, manifestFingerprint, snapshotVersion } from '../api/_lib/account-deletion-ledger.js'
import { operationKey, runDeletionRehearsal } from './qa/deletion/processor.mjs'
const projectId = 'demo-idogs-account-deletion'
if (process.env.GCLOUD_PROJECT !== projectId || !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('emulator_only')
let app, db, n = 0
before(() => { app = initializeApp({projectId}, 'durable-ledger'); db = getFirestore(app) })
after(async () => { await db?.terminate(); if (app) await deleteApp(app) })
async function seed() {
  const uid = `qa-deletion-ledger-${++n}`
  const dogPath = `dogs/${uid}`, documentPath = `documents/${uid}`
  await db.doc(dogPath).set({currentOwnerId:uid, tenantId:'original-breeder'})
  await db.doc(documentPath).set({dogId:uid, tenantId:'original-breeder', privateBody:'never-copy-this-body'})
  const plan = {complete:true, holds:[], evidence:{retention:'synthetic-only', backups:'synthetic-only', writeFreeze:'cooperative-test-only'}, approvals:{policy:'synthetic-only', billing:'synthetic-only'},
    records:[{path:documentPath, ownerPath:dogPath, version:snapshotVersion(await db.doc(documentPath).get()), disposition:'delete_exclusive'},
      {path:dogPath, ownerPath:dogPath, version:snapshotVersion(await db.doc(dogPath).get()), disposition:'delete_exclusive'}], objects:[]}
  plan.fingerprint = manifestFingerprint(plan)
  const request = db.doc(`accountDeletionRequests/${uid}`), manifest = db.doc(`accountDeletionManifests/${uid}/revisions/1`)
  const fence = db.doc(`accountDeletionFences/${uid}`), progress = db.doc(`accountDeletionProgress/${uid}/revisions/1`)
  await request.set({uid,revision:1,status:'requested'}); await manifest.set(plan); await fence.set({revision:1,state:'frozen'})
  let clock = 100000
  const make = workerId => createDeletionLedger({db,uid,revision:1,workerId,now:()=>clock,leaseMs:1000})
  const f = {uid, plan, request, manifest, fence, progress, dogPath, documentPath, make, advance:()=> {clock += 2000}}
  f.worker = make('worker-a')
  f.claim = w => w.claim(uid,1,plan.fingerprint)
  f.remove = (w, record) => w.deleteRecordAtomically({uid,revision:1,fingerprint:plan.fingerprint,record,key:operationKey(uid,1,'record',record.path)})
  return f
}
test('constructor refuses live projects and non-emulator hosts before RPC', () => {
  assert.throws(()=>createDeletionLedger({db:{projectId:'idogs-app'}}),/emulator_only/)
})
test('durable transaction records deletion and receipt together; fresh worker resumes after lease', async () => {
  const f = await seed(); await f.claim(f.worker); await f.remove(f.worker,f.plan.records[0])
  assert.equal((await db.doc(f.documentPath).get()).exists,false)
  const receipts = await f.progress.collection('operations').get(); assert.equal(receipts.size,1)
  assert.doesNotMatch(JSON.stringify(receipts.docs.map(d=>d.data())), /never-copy|original-breeder/)
  f.advance(); const restarted = f.make('worker-b'); await f.claim(restarted)
  await f.remove(restarted,f.plan.records[0]); await f.remove(restarted,f.plan.records[1])
  await assert.rejects(restarted.complete(f.uid,1),/auth_not_confirmed/)
  await restarted.recordAuthOutcome('deleted'); await restarted.complete(f.uid,1)
  assert.equal((await f.request.get()).data().status,'completed')
  assert.equal((await f.fence.get()).data().state,'frozen')
})
test('concurrent workers produce one owner; old worker is fenced after takeover', async () => {
  const f = await seed(), a=f.make('a'), b=f.make('b')
  const results=await Promise.allSettled([f.claim(a),f.claim(b)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  const winner=results[0].status==='fulfilled'?a:b
  f.advance(); const next=f.make('next'); await f.claim(next)
  await assert.rejects(f.remove(winner,f.plan.records[0]),/worker_fenced/)
  await f.remove(next,f.plan.records[0])
})
test('cancellation committed before claim prevents cleanup', async () => {
  const f=await seed(); await f.request.update({status:'cancelled'})
  await assert.rejects(f.claim(f.worker),/fence_changed/)
  assert.equal((await db.doc(f.documentPath).get()).exists,true)
})
test('current owner beats original tenant; changed ownership/version cannot be deleted', async () => {
  const f=await seed(); await f.claim(f.worker)
  await db.doc(f.dogPath).update({currentOwnerId:'qa-deletion-new-owner'})
  await assert.rejects(f.remove(f.worker,f.plan.records[0]),/ownership_or_version_changed/)
  assert.equal((await db.doc(f.documentPath).get()).exists,true)
})
test('pending transfer blocks claim', async () => {
  const f=await seed(); await db.doc(f.dogPath).update({transferStatus:'pendingClaim'})
  await assert.rejects(f.claim(f.worker),/ownership_or_version_changed/)
})
test('nanosecond document version is checked inside delete transaction', async () => {
  const f=await seed(); await f.claim(f.worker); await db.doc(f.documentPath).update({note:'new-content'})
  await assert.rejects(f.remove(f.worker,f.plan.records[0]),/ownership_or_version_changed/)
})
test('freeze state, request revision and fingerprint are checked during processing', async () => {
  const f=await seed(); await f.claim(f.worker); await f.fence.update({state:'open'})
  await assert.rejects(f.remove(f.worker,f.plan.records[0]),/fence_changed/)
  await f.fence.update({state:'frozen'}); await f.request.update({revision:2})
  await assert.rejects(f.remove(f.worker,f.plan.records[0]),/fence_changed/)
})
test('tampered manifest cannot reuse prior approval fingerprint', async () => {
  const f=await seed(); await f.manifest.update({objects:[{path:'unapproved'}]})
  await assert.rejects(f.claim(f.worker),/manifest_not_ready/)
})
test('cooperating Admin SDK write checks same fence transaction', async () => {
  const f=await seed()
  await assert.rejects(f.worker.guardedWrite(f.documentPath,{note:'should-not-write'}),/writes_frozen/)
  assert.equal((await db.doc(f.documentPath).get()).data().note,undefined)
})
test('direct Admin SDK bypass remains possible: global freeze NOT proven', async () => {
  const f=await seed()
  await db.doc(f.documentPath).update({note:'bypass-demonstration-synthetic-only'})
  assert.equal((await db.doc(f.documentPath).get()).data().note,'bypass-demonstration-synthetic-only')
})
test('completion cannot hide outstanding operations or failed Auth', async () => {
  const f=await seed(); await f.claim(f.worker)
  await assert.rejects(f.worker.recordAuthOutcome('deleted'),/cleanup_incomplete/)
  await assert.rejects(f.worker.recordAuthOutcome('failed'),/auth_not_confirmed/)
  assert.equal((await f.request.get()).data().status,'processing')
})

test('coordinator resumes Firestore receipts and real emulator Auth after a lost completion receipt', async () => {
  const f=await seed(), auth=getAuth(app)
  await auth.createUser({uid:f.uid, email:`${f.uid}@example.invalid`, password:'Synthetic-only-123!'})
  const makeAuth=()=>({kind:'synthetic-auth-emulator', async deleteExact(uid) {
    try {await auth.deleteUser(uid);return 'deleted'} catch(error) {if(error.code==='auth/user-not-found')return 'already_absent';throw error}
  }})
  const billing={kind:'synthetic-memory',async listVerifiedSubscriptions(){return []}}
  const objects={kind:'synthetic-memory'}
  const complete=f.worker.complete
  let lost=false
  f.worker.complete=async (...args)=>{if(!lost){lost=true;throw new Error('completion_receipt_lost')}return complete(...args)}
  await assert.rejects(runDeletionRehearsal({uid:f.uid,revision:1,store:f.worker,billing,objects,auth:makeAuth()}),/completion_receipt_lost/)
  assert.equal((await f.request.get()).data().status,'processing')
  await assert.rejects(auth.getUser(f.uid),error=>error.code==='auth/user-not-found')
  // New adapter instance and worker: progress is read from Firestore, not memory.
  f.advance();const restarted=f.make('restarted')
  await runDeletionRehearsal({uid:f.uid,revision:1,store:restarted,billing,objects,auth:makeAuth()})
  assert.equal((await f.request.get()).data().status,'completed')
  assert.equal((await f.progress.get()).data().authOutcome,'already_absent')
})
