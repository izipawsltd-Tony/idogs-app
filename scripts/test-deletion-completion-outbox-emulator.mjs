import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {initializeApp,deleteApp} from 'firebase-admin/app'
import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'
import {createEmulatorDeletionIntake} from '../api/_lib/deletion-intake.js'
import {createEmulatorDeletionCompletionOutbox} from '../api/_lib/deletion-completion-outbox.js'
import {createEmulatorDeletionProcessor} from '../api/_lib/deletion-processor.js'
import {syntheticDeletionProvider} from '../api/_lib/deletion-synthetic-provider.js'
import {digest} from '../api/_lib/deletion-plan.js'

const PROJECT='demo-idogs-deletion'
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])if(!/^(localhost|127\.0\.0\.1):\d{4,5}$/.test(process.env[key]||''))throw Error('Expected local emulators')
if(process.env.GCLOUD_PROJECT!==PROJECT||process.env.ACCOUNT_DELETION_MODE!=='prototype-emulator')throw Error('Expected synthetic project opt-in')
let app,db,ledgerDb,auth,bucket,processor
const fixtures=[]
before(()=>{
  app=initializeApp({projectId:PROJECT,storageBucket:`${PROJECT}.firebasestorage.app`},'completion-outbox-tests')
  db=getFirestore(app);ledgerDb=getFirestore(app,'idogs-deletion-ledger-qa');auth=getAuth(app);bucket=getStorage(app).bucket()
  processor=createEmulatorDeletionProcessor({projectId:PROJECT,db,auth,bucket,provider:syntheticDeletionProvider(db)})
})
after(async()=>{
  // Only this test file's exact synthetic scopes, never a project-wide reset.
  for(const f of fixtures){
    // Preflight the source's nonce-bound request and the fixture-owned seed.
    // A foreign/replaced record stops cleanup; nothing resets an entire DB.
    const request=await db.doc(`accountDeletionRequests/${f.uid}`).get(),r=request.data()
    assert.equal(r?.uid,f.uid);assert.equal(r?.revision,1);assert.equal(r?.independentIntake?.nonce,f.nonce)
    const snapshots=[]
    for(const collection of ['users','deletionSyntheticProviders','accountDeletionRequests','accountDeletionJobs','accountDeletionLocks']){
      const snap=await db.doc(`${collection}/${f.uid}`).get(),v=snap.data()
      if(snap.exists){
        if(collection==='users')assert.equal(v.email,f.email)
        else if(collection==='deletionSyntheticProviders')assert.deepEqual(v.completionOutboxFixture,{uid:f.uid,nonce:f.nonce})
        else if(collection==='accountDeletionRequests')assert.deepEqual(v,r)
        else assert.equal(v.revision,1)
        snapshots.push(snap)
      }
    }
    const job=snapshots.find(s=>s.ref.parent.id==='accountDeletionJobs')?.data()
    // Intake also creates these two exact support records; when the worker
    // runs they are deleted alongside users/{uid}. No other paths are allowed.
    const allowedOperationPaths=new Set([`users/${f.uid}`,`supportConversations/account_deletion_${f.uid}`,`supportMessages/account_deletion_${f.uid}_1_request`])
    for(const path of [...allowedOperationPaths].filter(p=>!p.startsWith('users/'))){
      const snap=await db.doc(path).get(),v=snap.data()
      if(snap.exists){
        assert.equal(v.createdAt,r.requestedAt)
        if(path.startsWith('supportConversations/')){assert.equal(v.ownerUid,f.uid);assert.equal(v.category,'account_deletion')}
        else {assert.equal(v.senderUid,f.uid);assert.equal(v.conversationId,`account_deletion_${f.uid}`)}
        snapshots.push(snap)
      }
    }
    const children=[]
    const operations=await db.doc(`accountDeletionJobs/${f.uid}`).collection('operations').limit(4).get()
    const receipts=await db.doc(`accountDeletionJobs/${f.uid}`).collection('receipts').limit(4).get()
    assert.ok(operations.size<=3&&receipts.size<=3)
    if(job?.planReady){assert.equal(operations.size,job.operationCount);assert.equal(job.operationHashes.length,job.operationCount)}
    else assert.equal(operations.size,0)
    const operationById=new Map()
    for(const snap of operations.docs){
      const {index,revision,...op}=snap.data()
      assert.equal(revision,1);assert.equal(snap.id,String(index).padStart(6,'0'));assert.equal(op.kind,'delete')
      assert.ok(allowedOperationPaths.has(op.path));assert.match(op.expectedVersion,/^\d+:\d+$/)
      assert.equal(digest(op),job.operationHashes[index]);operationById.set(snap.id,op);children.push(snap)
    }
    for(const snap of receipts.docs){
      const v=snap.data();assert.ok(operationById.has(snap.id));assert.equal(v.revision,1);assert.equal(v.kind,'delete')
      assert.ok(Number.isFinite(Date.parse(v.at)));children.push(snap)
    }
    for(const path of [`accountDeletionReceipts/${digest([f.uid,1])}`,`accountDeletionRenewalTasks/${f.uid}_1`]){
      const snap=await db.doc(path).get(),v=snap.data()
      if(snap.exists){assert.equal(v.revision,1);if(snap.ref.parent.id==='accountDeletionReceipts'){assert.equal(v.fingerprint,job?.fingerprint);assert.equal(v.completedAt,r.completedAt)}else assert.equal(v.uid,f.uid);snapshots.push(snap)}
    }
    for(const key of [`intake_${f.nonce}`,`completion_capture_${f.nonce}`]){
      const snap=await db.doc(`accountMutationLeases/${key}`).get(),v=snap.data()
      if(snap.exists){assert.deepEqual(v.uids,[f.uid]);assert.equal((v.intake||v.capture)?.nonce,f.nonce);assert.equal((v.intake||v.capture)?.uid,f.uid);snapshots.push(snap)}
    }
    for(const collection of ['scopedDeletionLedger','scopedDeletionIntakes','scopedDeletionCompletionOutbox']){
      const ref=ledgerDb.doc(`${collection}/${f.uid}`),snap=await ref.get()
      if(collection==='scopedDeletionLedger'){
        const events=await ref.collection('events').limit(3).get();assert.ok(events.size<=2)
        for(const event of events.docs){assert.equal(event.data().uid,f.uid);assert.equal(event.data().nonce,f.nonce);snapshots.push(event)}
      }
      if(snap.exists){assert.equal(snap.data().uid,f.uid);assert.equal(snap.data().nonce,f.nonce);snapshots.push(snap)}
    }
    // Revalidate content and Firestore updateTime immediately before each
    // preconditioned delete. A changed version is preserved for investigation.
    for(const snap of [...children,...snapshots]){const current=await snap.ref.get();assert.ok(current.updateTime?.isEqual(snap.updateTime));assert.equal(digest(current.data()),digest(snap.data()));await snap.ref.delete({lastUpdateTime:snap.updateTime})}
    try{
      const user=await auth.getUser(f.uid)
      assert.equal(user.uid,f.uid);assert.equal(user.email,f.cleanupEmail||f.email)
      const current=await auth.getUser(f.uid);assert.equal(digest(current.toJSON()),digest(user.toJSON()))
      await auth.deleteUser(f.uid)
    }catch(e){if(e.code!=='auth/user-not-found')throw e}
  }
  if(app)await deleteApp(app)
})
async function fixture(){
  const uid=`synthetic-outbox-${randomUUID()}`,nonce=randomUUID(),email=`${uid}@example.invalid`,password='Emulator-fixture-only-42!'
  const options={db,ledgerDb,auth,bucket,projectId:PROJECT,uid,nonce,executionEnabled:true},f={uid,nonce,email,options}
  fixtures.push(f)
  await auth.createUser({uid,email,password,emailVerified:true})
  const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})})
  assert.equal(response.status,200);f.token=(await response.json()).idToken
  await db.doc(`users/${uid}`).set({email,role:'owner',plan:'free'})
  await db.doc(`deletionSyntheticProviders/${uid}`).set({completionOutboxFixture:{uid,nonce},discoveryComplete:true,subscriptions:[],retention:{verified:true,restoreReplayVerified:true,mediaIngressDrained:true,storageRetentionSeconds:0}})
  f.intake=createEmulatorDeletionIntake(options);await f.intake.prepare({idToken:f.token,confirmation:'DELETE MY ACCOUNT'});await f.intake.accept({idToken:f.token})
  f.outbox=()=>createEmulatorDeletionCompletionOutbox(options)
  f.ref=ledgerDb.doc(`scopedDeletionCompletionOutbox/${uid}`)
  f.lease=db.doc(`accountMutationLeases/completion_capture_${nonce}`)
  return f
}
async function complete(f){assert.equal((await processor.process({uid:f.uid,revision:1})).status,'completed');await f.intake.ledger.publishCompleted()}
function privateResult(result,f){assert.equal(JSON.stringify(result).includes(f.email),false);assert.equal(Object.hasOwn(result,'delivered'),false);assert.equal(Object.hasOwn(result,'ready'),false)}

test('outbox explicit opt-in and exact demo/nonce/endpoint scope reject before capture',async()=>{
  const f=await fixture()
  for(const override of [{executionEnabled:false},{projectId:'idogs-app'},{uid:'ordinary-account'},{nonce:randomUUID().replaceAll('-','')},{ledgerDb:db}])assert.throws(()=>createEmulatorDeletionCompletionOutbox({...f.options,...override}))
  assert.equal((await f.ref.get()).exists,false)
})
test('actual pre-Auth capture, worker completion and independent completion bind privately across restart',async()=>{
  const f=await fixture(),captured=await f.outbox().capture({idToken:f.token})
  assert.equal(captured.status,'captured');privateResult(captured,f)
  assert.equal((await f.lease.get()).data().receiptHash,captured.intentHash)
  assert.equal((await f.ref.get()).data().recipient.address,f.email)
  assert.deepEqual(await f.outbox().capture({idToken:f.token}),captured)
  assert.equal((await f.outbox().bindCompletion()).status,'held')
  await complete(f)
  const result=await f.outbox().bindCompletion();assert.equal(result.status,'completion_bound_no_send');privateResult(result,f)
  assert.deepEqual(await f.outbox().bindCompletion(),result)
  assert.deepEqual(Object.keys(f.outbox()).sort(),['bindCompletion','capture'])
})
test('lost actual independent capture commit reply retains worker barrier until verified restart',async()=>{
  const f=await fixture();let lose=true
  const fault={projectId:ledgerDb.projectId,databaseId:ledgerDb.databaseId,_settings:ledgerDb._settings,doc:ledgerDb.doc.bind(ledgerDb),collection:ledgerDb.collection.bind(ledgerDb),runTransaction:async fn=>{
    const result=await ledgerDb.runTransaction(fn)
    if(lose&&(await f.ref.get()).exists){lose=false;throw Error('actual capture commit reply lost')}
    return result
  }}
  await assert.rejects(createEmulatorDeletionCompletionOutbox({...f.options,ledgerDb:fault}).capture({idToken:f.token}),/actual capture commit reply lost/)
  assert.equal((await f.ref.get()).data().state,'captured');assert.equal((await f.lease.get()).data().state,'active')
  assert.deepEqual(await processor.process({uid:f.uid,revision:1}),{status:'held',code:'active_mutations'})
  assert.ok(await auth.getUser(f.uid))
  assert.equal((await f.outbox().capture({idToken:f.token})).status,'captured')
  assert.equal((await f.lease.get()).data().state,'closed');await complete(f)
  assert.equal((await f.outbox().bindCompletion()).status,'completion_bound_no_send')
})
test('uncertain capture without a receipt keeps its source lease active and completion held',async()=>{
  const f=await fixture()
  const fault={projectId:ledgerDb.projectId,databaseId:ledgerDb.databaseId,_settings:ledgerDb._settings,doc:ledgerDb.doc.bind(ledgerDb),collection:ledgerDb.collection.bind(ledgerDb),runTransaction:async()=>{throw Error('unknown capture publication')}}
  // Ledger reads also use transactions, so fail specifically after the source barrier exists.
  fault.runTransaction=async fn=>{if((await f.lease.get()).exists)throw Error('unknown capture publication');return ledgerDb.runTransaction(fn)}
  await assert.rejects(createEmulatorDeletionCompletionOutbox({...f.options,ledgerDb:fault}).capture({idToken:f.token}),/unknown capture publication/)
  assert.equal((await f.ref.get()).exists,false);assert.equal((await f.lease.get()).data().state,'active')
  assert.deepEqual(await processor.process({uid:f.uid,revision:1}),{status:'held',code:'active_mutations'})
  assert.equal((await f.outbox().bindCompletion()).code,'recipient_capture_missing')
})
test('capture rejects changed identity and a worker that installed its lock first',async()=>{
  const f=await fixture();f.cleanupEmail=`changed-${f.uid}@example.invalid`;await auth.updateUser(f.uid,{email:f.cleanupEmail,emailVerified:true})
  // Email changes may revoke the existing token before the identity hash check.
  // Both barriers must reject without creating any capture state.
  await assert.rejects(f.outbox().capture({idToken:f.token}),e=>e.code==='auth/id-token-revoked'||e.message==='DELETION_OUTBOX_IDENTITY_CHANGED')
  assert.equal((await f.lease.get()).exists,false)
  assert.equal((await f.ref.get()).exists,false)
  // Exercise the pinned identity check with an actually verified fresh token.
  // Emulator validSince has millisecond precision while JWT iat is seconds;
  // bounded real sign-ins may wait for that validity boundary, never alter it.
  let freshToken
  for(let attempt=0;attempt<20;attempt++){
    const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.cleanupEmail,password:'Emulator-fixture-only-42!',returnSecureToken:true})})
    assert.equal(response.status,200);const token=(await response.json()).idToken
    try{assert.equal((await auth.verifyIdToken(token,true)).uid,f.uid);freshToken=token;break}
    catch(e){if(e.code!=='auth/id-token-revoked')throw e;await new Promise(resolve=>setTimeout(resolve,100))}
  }
  assert.ok(freshToken,'Fresh sign-in must pass actual revocation verification within the bounded real-time window')
  await assert.rejects(f.outbox().capture({idToken:freshToken}),/DELETION_OUTBOX_IDENTITY_CHANGED/)
  assert.equal((await f.lease.get()).exists,false);assert.equal((await f.ref.get()).exists,false)
  const g=await fixture();await db.doc(`accountDeletionLocks/${g.uid}`).set({revision:1,state:'processing'})
  await assert.rejects(g.outbox().capture({idToken:g.token}),/DELETION_OUTBOX_CAPTURE_TOO_LATE/)
  assert.equal((await g.ref.get()).exists,false)
})
test('completion requires independent receipt and current Auth absence, including restored identities',async()=>{
  const f=await fixture();await f.outbox().capture({idToken:f.token})
  assert.equal((await processor.process({uid:f.uid,revision:1})).status,'completed')
  assert.equal((await f.outbox().bindCompletion()).code,'independent_completion_missing')
  await f.intake.ledger.publishCompleted()
  await auth.createUser({uid:f.uid,email:f.email,emailVerified:true})
  assert.equal((await f.outbox().bindCompletion()).code,'auth_present')
  assert.equal((await f.ref.get()).data().state,'captured')
  await auth.deleteUser(f.uid);await f.outbox().bindCompletion()
  await auth.createUser({uid:f.uid,email:f.email,emailVerified:true,disabled:true})
  assert.equal((await f.outbox().bindCompletion()).status,'held')
})
test('recipient tampering, unknown state, scope and revision changes reject without completion',async()=>{
  const f=await fixture();await f.outbox().capture({idToken:f.token});const original=(await f.ref.get()).data()
  for(const change of [{recipient:{channel:'email',address:'other@example.invalid'}},{state:'dispatched'},{nonce:randomUUID()},{revision:2}]){
    await f.ref.set({...original,...change});await assert.rejects(f.outbox().bindCompletion(),/DELETION_OUTBOX_INTENT_CHANGED/)
  }
  await f.ref.set(original);await complete(f)
  const request=db.doc(`accountDeletionRequests/${f.uid}`);await request.update({revision:2})
  await assert.rejects(f.outbox().bindCompletion(),/INDEPENDENT_LEDGER_REQUEST_INVALID/)
  await request.update({revision:1})
})
test('missing/restored source and substituted completion receipt never suffice after capture',async()=>{
  const f=await fixture();await f.outbox().capture({idToken:f.token});await complete(f)
  const request=db.doc(`accountDeletionRequests/${f.uid}`),original=(await request.get()).data()
  await request.delete();await assert.rejects(f.outbox().bindCompletion(),/DELETION_OUTBOX_SOURCE_CHANGED/)
  await request.set(original)
  const receipt=db.doc(`accountDeletionReceipts/${digest([f.uid,1])}`),saved=(await receipt.get()).data()
  await receipt.update({retainedCategories:['substituted']})
  await assert.rejects(f.outbox().bindCompletion(),/DELETION_OUTBOX_COMPLETION_CHANGED/)
  await receipt.set(saved);assert.equal((await f.outbox().bindCompletion()).status,'completion_bound_no_send')
})
test('erased private capture after closed barrier cannot be reconstructed from restored source/Auth',async()=>{
  const f=await fixture();await f.outbox().capture({idToken:f.token})
  const lease=await f.lease.get(),request=await db.doc(`accountDeletionRequests/${f.uid}`).get()
  const original=await f.ref.get();await original.ref.delete({lastUpdateTime:original.updateTime})
  await assert.rejects(f.outbox().capture({idToken:f.token}),/DELETION_OUTBOX_CAPTURE_HISTORY_MISSING/)
  assert.equal((await f.ref.get()).exists,false)
  assert.deepEqual((await f.lease.get()).data(),lease.data())
  assert.deepEqual((await db.doc(`accountDeletionRequests/${f.uid}`).get()).data(),request.data())
  assert.ok(await auth.getUser(f.uid));assert.equal((await f.outbox().bindCompletion()).code,'recipient_capture_missing')
})
test('capture recovery rejects changed/completed processing locks and preserves the exact lease',async()=>{
  const f=await fixture();await f.outbox().capture({idToken:f.token})
  const originalLease=(await f.lease.get()).data(),originalIntent=(await f.ref.get()).data(),lock=db.doc(`accountDeletionLocks/${f.uid}`)
  for(const change of [{revision:2,state:'processing'},{revision:1,state:'completed'}]){
    await lock.create(change)
    await assert.rejects(f.outbox().capture({idToken:f.token}),/DELETION_OUTBOX_LOCK_CHANGED/)
    assert.deepEqual((await f.lease.get()).data(),originalLease);assert.deepEqual((await f.ref.get()).data(),originalIntent)
    const snap=await lock.get();assert.deepEqual(snap.data(),change);await lock.delete({lastUpdateTime:snap.updateTime})
  }
})
