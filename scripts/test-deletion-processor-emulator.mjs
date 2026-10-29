import {before,after,beforeEach,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {createServer} from 'node:http'
import {initializeApp,deleteApp} from 'firebase-admin/app'
import {getAuth} from 'firebase-admin/auth'
import {getFirestore,FieldValue} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing'
import {doc,getDoc,setDoc,updateDoc,deleteDoc,serverTimestamp} from 'firebase/firestore'
import {makeDeletionHandler} from '../api/account-deletion.js'
import {makeDeletionProcessingHandler} from '../api/_lib/deletion-processing-handler.js'
import {createEmulatorDeletionProcessor} from '../api/_lib/deletion-processor.js'
import {syntheticDeletionProvider} from '../api/_lib/deletion-synthetic-provider.js'
import {buildEmulatorDeletionPlan,scanDeletionDocuments,versionOf,mediaPaths} from '../api/_lib/deletion-plan.js'
import {requireDeletionEmulators,beginAccountMutation,withAccountMutationFence} from '../api/_lib/deletion-fence.js'
import {recordDeletionBillingAcceptance} from '../api/_lib/deletion-billing.js'
import {changeDeletionRequest} from '../api/_lib/account-deletion.js'
import {createEmulatorDocumentIngress} from '../api/_lib/deletion-document-ingress.js'
import {createEmulatorIndependentLedger} from '../api/_lib/deletion-independent-ledger.js'
import {randomUUID} from 'node:crypto'

const PROJECT='demo-idogs-deletion'
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])if(!/^(localhost|127\.0\.0\.1):\d{4,5}$/.test(process.env[key]||''))throw Error('Expected local emulators')
if(process.env.GCLOUD_PROJECT!==PROJECT||process.env.ACCOUNT_DELETION_MODE!=='prototype-emulator')throw Error('Expected synthetic project opt-in')
let app,db,ledgerDb,auth,bucket,rules,server,origin,owner,other,operator,processor,provider,counter=0
const reqBody={action:'request',confirmation:'DELETE MY ACCOUNT'}
const documentIngress=()=>createEmulatorDocumentIngress({db,auth,bucket,projectId:PROJECT})
const beginDocument=()=>documentIngress().begin({idToken:owner.token,dogId:'synthetic-dog',executionEnabled:true})
const ingressMetadata=()=>({source:'manual',fileName:'proof.pdf',filePath:`documents/${owner.uid}/synthetic-dog/proof.pdf`,mediaType:'application/pdf',title:'Synthetic proof'})
const requestRef=()=>db.collection('accountDeletionRequests').doc(owner.uid)
async function signup(label,claims){
  const uid=`synthetic-${label}-${++counter}`,email=`${uid}@example.invalid`,password='Emulator-fixture-only-42!'
  await auth.createUser({uid,email,password,emailVerified:true})
  if(claims)await auth.setCustomUserClaims(uid,claims)
  const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})})
  assert.equal(response.status,200)
  return {uid,email,token:(await response.json()).idToken}
}
async function call(identity,path,method='GET',body){const r=await fetch(origin+path,{method,headers:{...(identity?{Authorization:`Bearer ${identity.token}`}:{ }),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}}
async function request(){const r=await call(owner,'/request','POST',reqBody);assert.equal(r.status,200);return r}
async function seed({shared=false,media=true,billingAcceptance=true,subscriptions=[],stripeCustomerId}={}){
  await db.collection('users').doc(owner.uid).set({email:owner.email,firstName:'Synthetic',lastName:'Departing',phone:'0400000000',address:'Synthetic only',role:'owner',plan:'free',...(stripeCustomerId?{stripeCustomerId}:{})})
  await db.collection('users').doc(other.uid).set({email:other.email,role:'owner',plan:'free'})
  const dog={tenantId:owner.uid,currentOwnerId:shared?other.uid:owner.uid,name:'Synthetic dog',passportId:'NNG-SYNTHETIC',status:'active'}
  await db.collection('dogs').doc('synthetic-dog').set(dog)
  const recordOwner=shared?other.uid:owner.uid
  await db.collection('vaccineRecords').doc('synthetic-vaccine').set({dogId:'synthetic-dog',createdBy:recordOwner,name:'Synthetic vaccine',dateGiven:'2026-01-01'})
  await db.collection('wormingRecords').doc('synthetic-worm').set({dogId:'synthetic-dog',createdBy:recordOwner,product:'Synthetic worming'})
  if(media){const path=`documents/${recordOwner}/synthetic-dog/proof.pdf`;await bucket.file(path).save(Buffer.from('Synthetic fixture only'));await db.collection('documents').doc('synthetic-document').set({dogId:'synthetic-dog',tenantId:recordOwner,filePath:path})}
  await db.collection('deletionSyntheticProviders').doc(owner.uid).set({discoveryComplete:true,subscriptions,retention:{verified:true,restoreReplayVerified:true,mediaIngressDrained:true,storageRetentionSeconds:0}})
  if(billingAcceptance)await request()
  else await changeDeletionRequest({db,token:await auth.verifyIdToken(owner.token,true),body:reqBody})
}
before(async()=>{
  app=initializeApp({projectId:PROJECT,storageBucket:`${PROJECT}.firebasestorage.app`});db=getFirestore(app);auth=getAuth(app);bucket=getStorage(app).bucket()
  ledgerDb=getFirestore(app,'idogs-deletion-ledger-qa')
  requireDeletionEmulators({projectId:PROJECT,db,auth,bucket})
  rules=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}})
  provider=syntheticDeletionProvider(db)
  processor=createEmulatorDeletionProcessor({projectId:PROJECT,db,auth,bucket,provider})
  const requestHandler=makeDeletionHandler({db,authenticate:t=>auth.verifyIdToken(t,true),onRequestAccepted:job=>recordDeletionBillingAcceptance({...job,db,provider,assertRuntime:()=>requireDeletionEmulators({projectId:PROJECT,db,auth,bucket})})})
  const workHandler=makeDeletionProcessingHandler({authorize:async(req,res)=>{try{return await auth.verifyIdToken((req.headers.authorization||'').slice(7),true)}catch{res.status(401).json({error:'Unauthorized'});return null}},processor})
  server=createServer(async(req,res)=>{res.status=code=>{res.statusCode=code;return res};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res};try{let body='';for await(const c of req)body+=c;req.body=body?JSON.parse(body):undefined;req.query={};await (req.url==='/request'?requestHandler:workHandler)(req,res)}catch{if(!res.headersSent)res.status(500).json({error:'Fixture server failure'})}})
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`
})
beforeEach(async()=>{
  await rules.clearFirestore()
  const users=await auth.listUsers(1000);if(users.users.length)await auth.deleteUsers(users.users.map(u=>u.uid))
  const [files]=await bucket.getFiles();for(const f of files)await f.delete()
  owner=await signup('owner');other=await signup('other');operator=await signup('operator',{deletionPrototypeOperator:true})
})
after(async()=>{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await rules?.cleanup();if(app)await deleteApp(app)})

test('strict environment/service guard rejects cloud, remote hosts, credentials and missing emulator hosts',()=>{
  const env={...process.env}
  for(const change of [{GCLOUD_PROJECT:'idogs-app'},{FIRESTORE_EMULATOR_HOST:'remote.example:8080'},{FIREBASE_AUTH_EMULATOR_HOST:''},{FIREBASE_STORAGE_EMULATOR_HOST:''},{FIREBASE_PRIVATE_KEY:'not-a-real-key'},{ACCOUNT_DELETION_MODE:'live'}])assert.throws(()=>requireDeletionEmulators({projectId:PROJECT,db,auth,bucket,env:{...env,...change}}))
  assert.throws(()=>requireDeletionEmulators({projectId:PROJECT,db,auth,bucket:{name:'idogs-app.firebasestorage.app'},env}))
  assert.throws(()=>createEmulatorDeletionProcessor({projectId:PROJECT,db,auth,bucket,provider:{mode:'live'}}))
})
test('acceptance stops synthetic renewal before destructive processing; cancellation never restarts it',async()=>{
  await seed();const fixture=db.collection('deletionSyntheticProviders').doc(owner.uid)
  await fixture.update({subscriptions:[{id:'sub-synthetic',ownerUid:owner.uid,renewalStopped:false}]})
  const accepted=await request()
  assert.equal(accepted.body.renewalStatus,'verified_stopped');assert.equal(accepted.body.status,'requested')
  assert.equal((await db.collection('users').doc(owner.uid).get()).exists,true);assert.ok(await auth.getUser(owner.uid))
  assert.equal((await call(owner,'/request','POST',{action:'cancel'})).body.renewalStatus,'verified_stopped')
  assert.equal((await fixture.get()).data().subscriptions[0].renewalStopped,true)
  assert.equal((await fixture.get()).data().keys.length,1)
  const task=(await db.doc(`accountDeletionRenewalTasks/${owner.uid}_1`).get()).data()
  assert.equal(task.status,'verified_stopped');assert.equal(task.executionEnabled,false);assert.equal(task.verificationMode,'synthetic-emulator')
})
test('acceptance provider failure keeps an honest receipt; later failed recheck never claims verified renewal',async()=>{
  await seed();const fixture=db.collection('deletionSyntheticProviders').doc(owner.uid)
  // A prior check is not proof of the current provider state.
  await requestRef().update({renewalStatus:'pending_verification'})
  await fixture.update({discoveryComplete:false})
  const held=await request();assert.equal(held.body.renewalStatus,'review_required');assert.equal(held.body.canCancel,true)
  await fixture.update({discoveryComplete:true,subscriptions:[{id:'sub-synthetic',ownerUid:owner.uid,renewalStopped:false}]})
  assert.equal((await request()).body.renewalStatus,'verified_stopped')
  await fixture.update({failCancellation:true})
  assert.equal((await request()).body.renewalStatus,'review_required')
})
test('late billing evidence cannot overwrite a replacement request revision',async()=>{
  await seed();const late={...provider,discover:async uid=>{await requestRef().update({revision:2,renewalStatus:'pending_verification'});return {uid,complete:true,subscriptions:[]}}}
  await recordDeletionBillingAcceptance({db,uid:owner.uid,revision:1,provider:late,assertRuntime:()=>requireDeletionEmulators({projectId:PROJECT,db,auth,bucket})})
  assert.equal((await requestRef().get()).data().renewalStatus,'pending_verification')
})
test('an older failed billing attempt cannot overwrite a newer verified result',async()=>{
  await seed();let entered,release
  const started=new Promise(r=>{entered=r}),waiting=new Promise(r=>{release=r})
  const late={...provider,discover:async()=>{entered();await waiting;throw Error('old timeout')}}
  const assertRuntime=()=>requireDeletionEmulators({projectId:PROJECT,db,auth,bucket})
  const first=recordDeletionBillingAcceptance({db,uid:owner.uid,revision:1,provider:late,assertRuntime})
  await started
  await recordDeletionBillingAcceptance({db,uid:owner.uid,revision:1,provider,assertRuntime})
  release();await first
  assert.equal((await requestRef().get()).data().renewalStatus,'verified_no_subscription')
})
test('UID-keyed promotion Checkout ledger is inventoried and held for reviewed billing retention',async()=>{
  await seed();await db.doc(`plusPromotionCheckouts/${owner.uid}`).set({sessionId:'cs_synthetic',status:'complete'})
  assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'retention_review')
  assert.ok(await auth.getUser(owner.uid));assert.equal((await db.doc(`users/${owner.uid}`).get()).exists,true)
})
test('Rules preserve marketing preferences for an active account and deny changes by a frozen account',async()=>{
  await seed()
  const preferences={marketingConsent:{channel:'email_marketing',choice:'opt_in',email:other.email,source:'account_settings'}}
  const client=rules.authenticatedContext(other.uid).firestore()
  await assertSucceeds(updateDoc(doc(client,'users',other.uid),preferences))
  await db.doc(`accountDeletionLocks/${other.uid}`).set({state:'processing',revision:1})
  await assertFails(updateDoc(doc(client,'users',other.uid),{marketingConsent:{...preferences.marketingConsent,choice:'opt_out'}}))
})
test('email-only data introduced after planning blocks completion and preserves Auth',async()=>{
  await seed({media:false});let injected=false
  await assert.rejects(processor.process({uid:owner.uid,revision:1,afterOperation:async()=>{if(!injected){injected=true;await db.doc('unknownRecords/email-only').set({note:`Contact ${owner.email.toUpperCase()} before closure`})}}}),/RESIDUAL_ACCOUNT_RECORD/)
  assert.ok(await auth.getUser(owner.uid));assert.notEqual((await requestRef().get()).data().status,'completed')
})
test('tampered staged operation is refused on retry before a different path can be deleted',async()=>{
  await seed({media:false});await assert.rejects(processor.process({uid:owner.uid,revision:1,afterOperation:async()=>{throw Error('staged crash')}}),/staged crash/)
  const op=db.doc(`accountDeletionJobs/${owner.uid}/operations/000001`)
  await op.update({path:`users/${other.uid}`})
  await assert.rejects(processor.process({uid:owner.uid,revision:1}),/DELETION_PLAN_CHANGED/)
  assert.equal((await db.doc(`users/${other.uid}`).get()).exists,true)
})
test('HTTP request -> operator processor -> real emulator records/media/Auth removal with completion receipt',async()=>{
  await seed();const path=`dogs/${owner.uid}/orphan.jpg`;await bucket.file(path).save(Buffer.from('orphan'))
  const r=await call(operator,'/process','POST',{action:'process',uid:owner.uid,revision:1});assert.equal(r.status,200);assert.equal(r.body.status,'completed')
  for(const path of [`users/${owner.uid}`,'dogs/synthetic-dog','vaccineRecords/synthetic-vaccine','wormingRecords/synthetic-worm','documents/synthetic-document'])assert.equal((await db.doc(path).get()).exists,false,path)
  assert.equal((await bucket.getFiles())[0].length,0)
  await assert.rejects(auth.getUser(owner.uid),e=>e.code==='auth/user-not-found')
  assert.equal((await requestRef().get()).data().status,'completed')
  assert.equal((await db.collection('accountDeletionLocks').doc(owner.uid).get()).data().state,'completed')
  assert.equal((await db.collection('deletionSyntheticProviders').doc(owner.uid).get()).data().confirmationAccepted,true)
  assert.equal((await db.collection('users').doc(other.uid).get()).exists,true)
  assert.equal((await processor.process({uid:owner.uid,revision:1})).duplicate,true)
})
test('ordinary account cannot invoke the trusted processing HTTP route or forge completion',async()=>{
  await seed();assert.equal((await call(owner,'/process','POST',{action:'process',uid:owner.uid,revision:1})).status,403)
  assert.equal((await call(null,'/process','POST',{action:'process',uid:owner.uid,revision:1})).status,401)
  assert.equal((await call(operator,'/process','POST',{action:'process',uid:owner.uid,revision:1,decisions:{}})).status,400)
  assert.equal((await requestRef().get()).data().status,'requested')
})
test('deleting the former owner preserves the new owner vaccine, worming, documents and media',async()=>{
  await seed({shared:true});const before=(await db.collection('vaccineRecords').doc('synthetic-vaccine').get()).data()
  assert.equal((await processor.process({uid:owner.uid,revision:1})).status,'completed')
  const dog=(await db.collection('dogs').doc('synthetic-dog').get()).data()
  assert.equal(dog.currentOwnerId,other.uid);assert.match(dog.tenantId,/^deleted_/)
  assert.deepEqual((await db.collection('vaccineRecords').doc('synthetic-vaccine').get()).data(),before)
  assert.equal((await db.collection('wormingRecords').doc('synthetic-worm').get()).exists,true)
  assert.equal((await bucket.file(`documents/${other.uid}/synthetic-dog/proof.pdf`).exists())[0],true)
  const client=rules.authenticatedContext(other.uid).firestore()
  await assertSucceeds(getDoc(doc(client,'vaccineRecords','synthetic-vaccine')))
  await assertSucceeds(updateDoc(doc(client,'wormingRecords','synthetic-worm'),{product:'New owner update'}))
})
test('in-flight Admin writer holds processing; new writes and cancellation are denied after lock',async()=>{
  await seed();const close=await beginAccountMutation(db,[owner.uid],'synthetic upload')
  assert.deepEqual(await processor.process({uid:owner.uid,revision:1}),{status:'held',code:'active_mutations'})
  assert.equal((await requestRef().get()).data().processingStage,'waiting_for_writes')
  assert.equal((await call(owner,'/request','POST',{action:'cancel'})).status,409)
  await assert.rejects(beginAccountMutation(db,[owner.uid],'late writer'),/ACCOUNT_DELETION_LOCKED/)
  assert.equal((await db.collection('dogs').doc('synthetic-dog').get()).exists,true)
  await close();assert.equal((await processor.process({uid:owner.uid,revision:1})).status,'completed')
})
test('actual Rules deny locked actor writes, lock forgery, replay and anonymous scan writes to frozen dogs',async()=>{
  await seed();await db.collection('accountDeletionLocks').doc(owner.uid).set({state:'processing',revision:1})
  const a=rules.authenticatedContext(owner.uid).firestore(),b=rules.authenticatedContext(other.uid).firestore(),anon=rules.unauthenticatedContext().firestore()
  await assertFails(updateDoc(doc(a,'users',owner.uid),{firstName:'Bypass'}))
  await assertFails(updateDoc(doc(a,'dogs','synthetic-dog'),{name:'Bypass'}))
  await assertFails(setDoc(doc(a,'vaccineRecords','late-vaccine'),{dogId:'synthetic-dog',name:'late'}))
  await assertFails(deleteDoc(doc(a,'accountDeletionLocks',owner.uid)))
  await assertFails(setDoc(doc(b,'accountDeletionJobs',owner.uid),{status:'completed'}))
  await assertFails(setDoc(doc(anon,'scanLogs','late'),{dogId:'synthetic-dog',passportId:'NNG-SYNTHETIC',result:'public_view',scannedAt:serverTimestamp()}))
  await assertSucceeds(updateDoc(doc(b,'users',other.uid),{firstName:'Allowed'}))
  await assertSucceeds(getDoc(doc(a,'dogs','synthetic-dog')))
})
test('prototype route wrapper denies an actual authenticated mutation before handler IO and closes failed writer leases',async()=>{
  await seed();let calls=0
  const wrapped=withAccountMutationFence(async()=>{calls++;throw Error('fixture handler failed')},{route:'synthetic-test'})
  const response=()=>({headersSent:false,status(c){this.code=c;return this},json(b){this.body=b;return this}})
  const req={method:'POST',headers:{authorization:`Bearer ${other.token}`},query:{},body:{}}
  const r=response();await wrapped(req,r);assert.equal(calls,1);assert.equal(r.code,503)
  assert.equal((await db.collection('accountMutationLeases').where('state','==','active').get()).size,0)
  await db.collection('accountDeletionLocks').doc(other.uid).set({state:'processing'})
  const locked=response();await wrapped(req,locked);assert.equal(calls,1);assert.equal(locked.code,423)
})
for(const route of ['api/request-showcase-media-upload.js','api/request-landing-media-upload.js']){
  for(const outcome of ['returned','threw'])test(`signed authority issuer retains its original hold after ${outcome}: ${route}`,async()=>{
    await seed();let calls=0
    const wrapped=withAccountMutationFence(async()=>{
      calls++
      // This is an actual grant-state write, not a fake successful signer or
      // drain receipt. Even a locally expired/rejected grant proves no drain.
      await db.doc('mediaUploadGrants/synthetic-authority').set({uid:owner.uid,dogId:'synthetic-dog',status:'expired',expiresAt:'2000-01-01T00:00:00Z'})
      if(outcome==='threw')throw Error('synthetic signer outcome unknown')
      return {status:'returned_without_drain_proof'}
    },{route})
    const res={headersSent:false,status(c){this.code=c;return this},json(b){this.body=b;return this}}
    await wrapped({method:'POST',headers:{authorization:`Bearer ${owner.token}`},query:{},body:{dogId:'synthetic-dog'}},res)
    assert.equal(calls,1)
    if(outcome==='threw')assert.equal(res.code,503)
    const leases=await db.collection('accountMutationLeases').where('state','==','active').get()
    assert.equal(leases.size,1)
    const lease=leases.docs[0],original=lease.data()
    assert.equal(original.operation,route);assert.deepEqual(original.uids,[owner.uid])
    const result=await processor.process({uid:owner.uid,revision:1})
    assert.deepEqual(result,{status:'held',code:'active_mutations'})
    assert.deepEqual((await lease.ref.get()).data(),original)
    assert.equal((await db.doc('dogs/synthetic-dog').get()).exists,true)
    assert.equal((await auth.getUser(owner.uid)).disabled,false)
    assert.equal((await bucket.file(`documents/${owner.uid}/synthetic-dog/proof.pdf`).exists())[0],true)
    assert.equal((await requestRef().get()).data().processingStage,'waiting_for_writes')
    await wrapped({method:'POST',headers:{authorization:`Bearer ${owner.token}`},query:{},body:{dogId:'synthetic-dog'}},res)
    assert.equal(res.code,423);assert.equal(calls,1)
    assert.equal((await db.collection('accountMutationLeases').where('state','==','active').get()).size,1)
  })
}

test('concurrent workers never execute two destructive plans',async()=>{
  await seed();const r=await Promise.allSettled([processor.process({uid:owner.uid,revision:1}),processor.process({uid:owner.uid,revision:1})])
  assert.equal(r.filter(x=>x.status==='fulfilled'&&x.value.status==='completed'&&!x.value.duplicate).length,1)
  assert.ok(r.every(x=>x.status==='fulfilled'?x.value.status==='completed':x.reason.code==='DELETION_WORKER_BUSY'),JSON.stringify(r.map(x=>x.status==='fulfilled'?{status:x.value.status,code:x.value.code}:{code:x.reason.code,name:x.reason.name})))
  assert.equal((await requestRef().get()).data().status,'completed')
})
test('second worker is rejected while the first holds a live lease after a destructive receipt',async()=>{
  await seed()
  let entered,release,paused=false
  const reached=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve})
  const first=processor.process({uid:owner.uid,revision:1,afterOperation:async()=>{
    if(!paused){paused=true;entered();await gate}
  }})
  try{
    await Promise.race([reached,first.then(()=>{throw Error('first worker did not reach its receipt')})])
    const job=(await db.doc(`accountDeletionJobs/${owner.uid}`).get()).data()
    assert.ok(job.leaseUntil>Date.now())
    await assert.rejects(processor.process({uid:owner.uid,revision:1}),{code:'DELETION_WORKER_BUSY'})
  }finally{release()}
  assert.equal((await first).status,'completed')
  assert.equal((await requestRef().get()).data().status,'completed')
  assert.equal((await processor.process({uid:owner.uid,revision:1})).duplicate,true)
})
test('lost response / crash after a destructive receipt resumes without recreating or double deleting data',async()=>{
  await seed();await assert.rejects(processor.process({uid:owner.uid,revision:1,afterOperation:async()=>{throw Error('synthetic worker crash')}}),/synthetic worker crash/)
  assert.equal((await requestRef().get()).data().status,'processing')
  assert.equal((await processor.process({uid:owner.uid,revision:1})).status,'completed')
})
test('stale record versions block processing, retain Auth and never fabricate completion',async()=>{
  await seed({media:false});let changed=false
  await assert.rejects(processor.process({uid:owner.uid,revision:1,afterOperation:async()=>{if(!changed){changed=true;await db.collection('vaccineRecords').doc('synthetic-vaccine').update({name:'Concurrent admin change'})}}}),/RECORD_VERSION_CONFLICT/)
  assert.equal((await requestRef().get()).data().status,'processing');assert.ok(await auth.getUser(owner.uid))
})
test('Auth deletion failure is restartable after data cleanup and does not report completion early',async()=>{
  await seed();let fail=true
  const authFault=new Proxy(auth,{get(target,key){if(key==='deleteUser')return async(uid)=>{if(fail){fail=false;throw Error('synthetic Auth outage')}return target.deleteUser(uid)};const v=target[key];return typeof v==='function'?v.bind(target):v}})
  const p=createEmulatorDeletionProcessor({projectId:PROJECT,db,auth:authFault,bucket,provider})
  await assert.rejects(p.process({uid:owner.uid,revision:1}),/synthetic Auth outage/)
  assert.equal((await requestRef().get()).data().status,'processing')
  assert.equal((await p.process({uid:owner.uid,revision:1})).status,'completed')
})
test('Auth is disabled and existing sessions are rejected before data removal completes',async()=>{
  await seed();let checked=false
  await processor.process({uid:owner.uid,revision:1,afterOperation:async()=>{
    if(checked)return;checked=true
    assert.equal((await auth.getUser(owner.uid)).disabled,true)
    assert.equal((await call(owner,'/request')).status,401)
    const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:'Emulator-fixture-only-42!',returnSecureToken:true})})
    assert.equal(response.status,400)
  }})
  assert.equal(checked,true)
})
test('Auth freeze failure precedes every destructive operation and is restartable',async()=>{
  await seed();let fail=true
  const faulty=new Proxy(auth,{get(target,key){if(key==='updateUser')return async(...args)=>{if(fail){fail=false;throw Error('freeze outage')}return target.updateUser(...args)};const v=target[key];return typeof v==='function'?v.bind(target):v}})
  const p=createEmulatorDeletionProcessor({projectId:PROJECT,db,auth:faulty,bucket,provider})
  await assert.rejects(p.process({uid:owner.uid,revision:1}),/freeze outage/)
  assert.equal((await db.doc('dogs/synthetic-dog').get()).exists,true)
  assert.equal((await bucket.getFiles())[0].length,1)
  assert.equal((await p.process({uid:owner.uid,revision:1})).status,'completed')
})
test('identity change after planning aborts before deleting data',async()=>{
  await seed();let first=true
  const changing=new Proxy(auth,{get(target,key){if(key==='getUser')return async uid=>{const original=await target.getUser(uid);if(first){first=false;await target.updateUser(uid,{email:'changed-identity@example.invalid'})}return original};const v=target[key];return typeof v==='function'?v.bind(target):v}})
  const p=createEmulatorDeletionProcessor({projectId:PROJECT,db,auth:changing,bucket,provider})
  await assert.rejects(p.process({uid:owner.uid,revision:1}),/AUTH_IDENTITY_CHANGED/)
  assert.equal((await db.doc('dogs/synthetic-dog').get()).exists,true)
  assert.equal((await db.doc(`users/${owner.uid}`).get()).exists,true)
})
test('final scan checks both profile and Auth email identities',async()=>{
  await seed({media:false});const profileEmail='older-profile@example.invalid'
  await db.doc(`users/${owner.uid}`).update({email:profileEmail})
  let injected=false
  await assert.rejects(processor.process({uid:owner.uid,revision:1,afterOperation:async()=>{if(!injected){injected=true;await db.doc('newData/email-only').set({note:profileEmail})}}}),/RESIDUAL_ACCOUNT_RECORD/)
  assert.ok(await auth.getUser(owner.uid))
})
test('an Auth identity recreated during cleanup is preserved and completion is refused',async()=>{
  await seed({media:false});let replaced=false
  await assert.rejects(processor.process({uid:owner.uid,revision:1,afterOperation:async()=>{
    if(replaced)return;replaced=true
    await auth.deleteUser(owner.uid)
    await auth.createUser({uid:owner.uid,email:'replacement-identity@example.invalid',password:'Synthetic-replacement-only-42!'})
  }}),/AUTH_IDENTITY_CHANGED/)
  assert.equal((await auth.getUser(owner.uid)).email,'replacement-identity@example.invalid')
  assert.notEqual((await requestRef().get()).data().status,'completed')
})
test('an already executed operation changed before final verification cannot forge completion',async()=>{
  await seed({media:false});let changed=false
  await assert.rejects(processor.process({uid:owner.uid,revision:1,afterOperation:async({index})=>{
    if(changed)return;changed=true
    await db.doc(`accountDeletionJobs/${owner.uid}/operations/${String(index).padStart(6,'0')}`).update({path:`users/${other.uid}`})
  }}),/DELETION_PLAN_CHANGED/)
  assert.equal((await db.doc(`users/${other.uid}`).get()).exists,true)
  assert.ok(await auth.getUser(owner.uid))
})
test('still-valid signed upload authority holds deletion even when the grant status is failed',async()=>{
  await seed();const grant=db.collection('mediaUploadGrants').doc('synthetic-grant')
  await grant.set({uid:owner.uid,dogId:'synthetic-dog',status:'failed',path:`dogs/${owner.uid}/synthetic-dog/upload.jpg`,expiresAt:new Date(Date.now()+600000).toISOString()})
  assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'signed_upload_not_drained')
  assert.equal((await db.collection('documents').doc('synthetic-document').get()).exists,true)
  await grant.update({expiresAt:new Date(Date.now()-120000).toISOString()})
  assert.equal((await processor.process({uid:owner.uid,revision:1})).status,'completed')
})
test('incomplete provider discovery, ownership mismatch and missing retention/restore evidence stop before data deletion',async()=>{
  await seed();const ref=db.collection('deletionSyntheticProviders').doc(owner.uid)
  await ref.update({discoveryComplete:false});assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'billing_provider_verification')
  await ref.update({discoveryComplete:true,subscriptions:[{id:'sub-synthetic',ownerUid:other.uid}]});assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'billing_provider_verification')
  await ref.update({subscriptions:[],retention:{verified:true,restoreReplayVerified:false,mediaIngressDrained:true}})
  assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'provider_retention_review');assert.ok(await auth.getUser(owner.uid))
})
test('synthetic renewal stops once with stable keys; cancelling cannot restart it',async()=>{
  await seed();const ref=db.collection('deletionSyntheticProviders').doc(owner.uid)
  await ref.update({subscriptions:[{id:'sub-synthetic',ownerUid:owner.uid,renewalStopped:false}]})
  await assert.rejects(processor.process({uid:owner.uid,revision:1,afterOperation:async()=>{throw Error('lost-response')}}))
  assert.equal((await ref.get()).data().keys.length,1)
  assert.equal((await call(owner,'/request','POST',{action:'cancel'})).status,401)
  await processor.process({uid:owner.uid,revision:1});assert.equal((await ref.get()).data().keys.length,1)
  assert.equal((await ref.get()).data().subscriptions[0].renewalStopped,true)
})
test('reviewed financial retention requires exact version, reason and future review date',async()=>{
  await seed();const ref=db.collection('financeDocuments').doc('synthetic-invoice');await ref.set({tenantId:owner.uid,amount:100,documentType:'invoice'})
  assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'retention_review')
  const decisions={[ref.path]:{expectedVersion:versionOf(await ref.get()),action:'retain',reason:'Synthetic reviewed financial fixture',reviewAfter:new Date(Date.now()+86400000).toISOString()}}
  assert.equal((await processor.process({uid:owner.uid,revision:1,decisions})).status,'completed')
  assert.equal((await ref.get()).exists,true);assert.deepEqual((await requestRef().get()).data().retainedCategories,['reviewed_financial_record'])
})
for(const shared of [false,true])test(`changed retained ${shared?'shared history':'financial record'} blocks completion and confirmation`,async()=>{
  await seed({shared,media:false})
  const ref=db.doc(shared?'dogs/synthetic-dog':'financeDocuments/synthetic-invoice')
  if(!shared)await ref.set({tenantId:owner.uid,amount:100,documentType:'invoice'})
  const decisions=shared?{}:{[ref.path]:{expectedVersion:versionOf(await ref.get()),action:'retain',reason:'Synthetic reviewed financial fixture',reviewAfter:new Date(Date.now()+86400000).toISOString()}}
  let changed=false
  await assert.rejects(processor.process({uid:owner.uid,revision:1,decisions,afterOperation:async()=>{
    if(changed)return
    changed=true
    await ref.update({unexpectedContact:owner.email})
  }}),/RETAINED_RECORD_CHANGED/)
  assert.equal((await auth.getUser(owner.uid)).disabled,true)
  assert.notEqual((await requestRef().get()).data().status,'completed')
  assert.equal((await db.doc(`deletionSyntheticProviders/${owner.uid}`).get()).data().confirmationAccepted,undefined)
})

test('a retained financial review that expires during storage recovery must be renewed before completion',async()=>{
  await seed()
  let now=Date.now()
  const ref=db.doc('financeDocuments/synthetic-invoice')
  await ref.set({tenantId:owner.uid,amount:100,documentType:'invoice'})
  const decisions={[ref.path]:{expectedVersion:versionOf(await ref.get()),action:'retain',reason:'Synthetic reviewed financial fixture',reviewAfter:new Date(now+86400000).toISOString()}}
  await db.doc(`deletionSyntheticProviders/${owner.uid}`).update({'retention.storageRetentionSeconds':604800,'retention.storageRecoveryVerified':true})
  const worker=createEmulatorDeletionProcessor({projectId:PROJECT,db,auth,bucket,provider,clock:()=>now})
  assert.equal((await worker.process({uid:owner.uid,revision:1,decisions})).code,'storage_retention_pending')
  now+=604800000
  await assert.rejects(worker.process({uid:owner.uid,revision:1}),/RETENTION_REVIEW_EXPIRED/)
  assert.ok(await auth.getUser(owner.uid))
  assert.notEqual((await requestRef().get()).data().status,'completed')
})

test('invalid collection budgets are rejected before inventory access',async()=>{
  const noReads={listCollections(){throw Error('UNEXPECTED_DATABASE_READ')}}
  for(const maxCollections of [0,-1,201,1.5,NaN,Infinity,'200',null])await assert.rejects(scanDeletionDocuments(noReads,{maxCollections}),/INVALID_INVENTORY_LIMIT/)
})

test('unknown collection and orphaned subcollection are discovered and held rather than silently skipped',async()=>{
  await seed();await db.collection('newUnclassifiedCollection').doc('one').set({uid:owner.uid})
  assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'unclassified_record_review')
  await db.collection('newUnclassifiedCollection').doc('one').delete()
  await db.doc('dogs/missing-parent/privateNotes/one').set({uid:owner.uid,note:'synthetic'})
  const scan=await scanDeletionDocuments(db);assert.ok(scan.records.find(r=>r.path==='dogs/missing-parent/privateNotes/one'))
  assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'unclassified_record_review')
})
test('inventory pagination crosses 100 records and a bounded scan never claims complete after truncation',async()=>{
  await seed({media:false});const batch=db.batch();for(let i=0;i<105;i++)batch.set(db.collection('activityNotes').doc(`note-${i}`),{dogId:'synthetic-dog',createdBy:owner.uid,note:'synthetic'});await batch.commit()
  const limited=await buildEmulatorDeletionPlan({db,bucket,uid:owner.uid,limits:{maxDocuments:10}});assert.ok(limited.holds.includes('inventory_limit'))
  assert.equal((await processor.process({uid:owner.uid,revision:1})).status,'completed')
  assert.equal((await db.collection('activityNotes').get()).size,0)
})
test('pending transfer and legacy ownership are quarantined with no Auth deletion',async()=>{
  await seed();const dog=db.collection('dogs').doc('synthetic-dog');await dog.update({status:'transferred',transferStatus:'pendingClaim'})
  assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'ownership_history_review')
  await dog.update({currentOwnerId:FieldValue.delete(),transferStatus:FieldValue.delete(),status:'active'})
  assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'legacy_ownership_review')
  assert.ok(await auth.getUser(owner.uid))
})
test('invalid IDs, stale revisions and malformed media paths fail closed',async()=>{
  await seed();await assert.rejects(processor.process({uid:'../real-account',revision:1}),/INVALID_DELETION_JOB/)
  await assert.rejects(processor.process({uid:owner.uid,revision:2}),/DELETION_REQUEST_MISMATCH/)
  assert.ok(mediaPaths({filePath:'../escape'},bucket.name).holds.length)
  assert.ok(mediaPaths({fileUrl:'https://unverified.example/private'},bucket.name).holds.length)
  await db.collection('documents').doc('synthetic-document').update({filePath:'../escape'})
  assert.equal((await processor.process({uid:owner.uid,revision:1})).code,'unresolved_media_reference')
})
test('confirmation adapter failure never produces a completion receipt; retry verifies Auth already absent',async()=>{
  await seed();const ref=db.collection('deletionSyntheticProviders').doc(owner.uid);await ref.update({failConfirmation:true})
  await assert.rejects(processor.process({uid:owner.uid,revision:1}),/SYNTHETIC_CONFIRMATION_FAILURE/)
  assert.equal((await requestRef().get()).data().status,'processing');assert.equal((await db.collection('accountDeletionReceipts').get()).size,0)
  await ref.update({failConfirmation:false});assert.equal((await processor.process({uid:owner.uid,revision:1})).status,'completed')
})
test('expired worker epoch cannot overwrite completion by a successful replacement worker',async()=>{
  await seed();let now=Date.now(),reentered=false
  const p=createEmulatorDeletionProcessor({projectId:PROJECT,db,auth,bucket,provider,clock:()=>now})
  await assert.rejects(p.process({uid:owner.uid,revision:1,afterOperation:async()=>{if(!reentered){reentered=true;now+=61000;assert.equal((await p.process({uid:owner.uid,revision:1})).status,'completed')}}}),/STALE_DELETION_WORKER/)
  assert.equal((await requestRef().get()).data().status,'completed')
})
test('all current API entrypoints declare a prototype fence or an explicit deletion control exemption',()=>{
  const registry=JSON.parse(readFileSync(new URL('../api/_lib/deletion-fenced-routes.json',import.meta.url),'utf8'))
  function walk(dir){for(const e of readdirSync(new URL('../'+dir+'/',import.meta.url),{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory()){if(e.name!=='_lib')walk(p)}else if(p.endsWith('.js')){const s=readFileSync(new URL('../'+p,import.meta.url),'utf8');if(/export default/.test(s)&&!registry.exemptions.includes(p)){assert.ok(registry.routes.includes(p),p);assert.match(s,/export default withAccountMutationFence\(/,p)}}}}
  walk('api')
})

test('seven-day storage recovery holds Auth and completion; elapsed time alone is insufficient',async()=>{
  await seed()
  let now=Date.now()
  const fixture=db.collection('deletionSyntheticProviders').doc(owner.uid)
  await fixture.update({'retention.storageRetentionSeconds':604800,'retention.storageRecoveryVerified':false})
  const worker=createEmulatorDeletionProcessor({projectId:PROJECT,db,auth,bucket,provider,clock:()=>now})
  assert.deepEqual(await worker.process({uid:owner.uid,revision:1}),{status:'held',code:'storage_retention_pending'})
  const waiting=(await requestRef().get()).data()
  assert.equal(waiting.status,'processing');assert.equal(waiting.processingStage,'waiting_for_storage')
  assert.equal(Date.parse(waiting.storageReviewAfter),now+604800000)
  assert.equal((await auth.getUser(owner.uid)).disabled,true)
  assert.equal((await fixture.get()).data().confirmationAccepted,undefined)
  assert.equal((await bucket.getFiles())[0].length,0)
  const retryTime=waiting.storageReviewAfter
  now+=86400000
  await worker.process({uid:owner.uid,revision:1})
  assert.equal((await requestRef().get()).data().storageReviewAfter,retryTime)
  now=Date.parse(retryTime)
  assert.deepEqual(await worker.process({uid:owner.uid,revision:1}),{status:'held',code:'storage_recovery_verification'})
  assert.ok(await auth.getUser(owner.uid))
  await fixture.update({'retention.storageRecoveryVerified':true})
  assert.equal((await worker.process({uid:owner.uid,revision:1})).status,'completed')
  await assert.rejects(auth.getUser(owner.uid),{code:'auth/user-not-found'})
})

test('missing storage retention evidence holds before destructive processing',async()=>{
  await seed()
  await db.collection('deletionSyntheticProviders').doc(owner.uid).update({'retention.storageRetentionSeconds':FieldValue.delete()})
  assert.deepEqual(await processor.process({uid:owner.uid,revision:1}),{status:'held',code:'storage_retention_unverified'})
  assert.equal((await db.doc(`users/${owner.uid}`).get()).exists,true)
  assert.equal((await auth.getUser(owner.uid)).disabled,false)
})

for(const invalid of ['foreign-readback','invalid-subscription-id','oversized-inventory'])test(`billing ${invalid} blocks worker before Auth freeze or data deletion`,async()=>{
  await seed()
  const subscription={id:'sub-synthetic',ownerUid:owner.uid,renewalStopped:true}
  let mutations=0
  const guarded={...provider,
    discover:async()=>({uid:owner.uid,complete:true,subscriptions:invalid==='oversized-inventory'?Array.from({length:201},(_,i)=>({...subscription,id:`sub-${i}`})):[{...subscription,id:invalid==='invalid-subscription-id'?'sub/unsafe':subscription.id}]}),
    stopRenewal:async()=>{mutations++},verify:async()=>({...subscription,id:'sub-foreign'})}
  const worker=createEmulatorDeletionProcessor({db,auth,bucket,projectId:PROJECT,provider:guarded})
  assert.equal((await worker.process({uid:owner.uid,revision:1})).code,'billing_provider_verification')
  assert.equal(mutations,invalid==='foreign-readback'?1:0)
  assert.equal((await auth.getUser(owner.uid)).disabled,false)
  assert.equal((await db.doc(`users/${owner.uid}`).get()).exists,true)
  assert.equal((await db.doc('documents/synthetic-document').get()).exists,true)
  assert.equal((await requestRef().get()).data().status,'processing')
})

// These trusted Admin writes activate only disposable emulator tasks. The
// request API still creates executionEnabled:false; no route enables live work.
import {createEmulatorRenewalDispatcher} from '../api/_lib/deletion-renewal-dispatcher.js'
import {createGuardedRenewalQueue} from '../api/_lib/deletion-renewal-queue.js'
const renewalTask=()=>db.doc(`accountDeletionRenewalTasks/${owner.uid}_1`)
const seedRenewal=options=>seed({stripeCustomerId:'cus_synthetic',billingAcceptance:false,...options})
const dispatchWith=(p=provider,clock)=>createEmulatorRenewalDispatcher({db,auth,bucket,projectId:PROJECT,provider:p,clock})
async function enableEmulatorRenewal(){
  const task=await renewalTask().get()
  assert.equal(task.data().executionEnabled,false)
  await renewalTask().update({executionEnabled:true})
}

test('renewal dispatcher holds default-disabled tasks without provider calls or account deletion',async()=>{
  await seedRenewal();let calls=0
  const p={...provider,discover:async()=>{calls++;throw Error('must not call provider')}}
  assert.deepEqual(await dispatchWith(p).execute({uid:owner.uid,revision:1}),{status:'held',code:'execution_disabled'})
  assert.equal(calls,0);assert.equal((await auth.getUser(owner.uid)).disabled,false)
  assert.equal((await renewalTask().get()).data().attempts,undefined)
})

test('renewal dispatcher persists exact provider receipts and duplicate completion without deleting Auth',async()=>{
  await seedRenewal({billingAcceptance:false,subscriptions:[{id:'sub-durable',ownerUid:owner.uid,renewalStopped:false,createdAt:new Date(Date.now()-1000).toISOString()}]})
  await enableEmulatorRenewal()
  const dispatcher=dispatchWith()
  assert.deepEqual(await dispatcher.execute({uid:owner.uid,revision:1}),{status:'completed',renewalStatus:'verified_stopped'})
  const task=(await renewalTask().get()).data(),receipts=await renewalTask().collection('receipts').get()
  assert.equal(task.executionEnabled,false);assert.equal(task.attempts,1);assert.equal(receipts.size,1)
  assert.equal(receipts.docs[0].data().subscriptionId,'sub-durable')
  assert.equal((await requestRef().get()).data().status,'requested')
  assert.equal((await auth.getUser(owner.uid)).disabled,false)
  assert.equal((await dispatcher.execute({uid:owner.uid,revision:1})).duplicate,true)
  assert.equal((await db.doc(`deletionSyntheticProviders/${owner.uid}`).get()).data().keys.length,1)
})

test('renewal dispatcher lost response schedules bounded retry with the same provider key',async()=>{
  await seedRenewal({billingAcceptance:false,subscriptions:[{id:'sub-durable',ownerUid:owner.uid,renewalStopped:false,createdAt:new Date(Date.now()-1000).toISOString()}]})
  await enableEmulatorRenewal();let time=Date.now(),drop=true,calls=0
  const p={...provider,stopRenewal:async(...args)=>{calls++;await provider.stopRenewal(...args);if(drop){drop=false;throw Object.assign(Error('lost reply'),{code:'ETIMEDOUT'})}}}
  const dispatcher=dispatchWith(p,()=>time)
  assert.deepEqual(await dispatcher.execute({uid:owner.uid,revision:1}),{status:'retry_wait'})
  const first=(await renewalTask().get()).data()
  assert.equal(first.status,'review_required');assert.equal(first.verificationReceipt,undefined)
  assert.deepEqual(await dispatcher.execute({uid:owner.uid,revision:1}),{status:'held',code:'retry_not_due'})
  assert.equal(calls,1)
  // Synthetic scheduler unit time only; this is not real Storage-expiry evidence.
  time=Date.parse(first.nextAttemptAt)
  assert.equal((await dispatcher.execute({uid:owner.uid,revision:1})).renewalStatus,'verified_stopped')
  assert.equal((await renewalTask().get()).data().attempts,2)
  assert.equal((await db.doc(`deletionSyntheticProviders/${owner.uid}`).get()).data().keys.length,1)
})

test('renewal dispatcher refuses a second worker while a claimed provider request is in flight',async()=>{
  await seedRenewal();await enableEmulatorRenewal();let enter,release
  const entered=new Promise(r=>{enter=r}),gate=new Promise(r=>{release=r})
  const slow={...provider,discover:async uid=>{enter();await gate;return provider.discover(uid)}}
  const first=dispatchWith(slow).execute({uid:owner.uid,revision:1})
  try{await entered;assert.deepEqual(await dispatchWith().execute({uid:owner.uid,revision:1}),{status:'busy'})}finally{release()}
  assert.equal((await first).renewalStatus,'verified_no_subscription')
  assert.equal((await renewalTask().get()).data().attempts,1)
})

test('renewal dispatcher cannot overwrite a replacement request after provider work',async()=>{
  await seedRenewal();await enableEmulatorRenewal()
  const changed={...provider,discover:async uid=>{await requestRef().update({revision:2,renewalStatus:'pending_verification'});return provider.discover(uid)}}
  assert.deepEqual(await dispatchWith(changed).execute({uid:owner.uid,revision:1}),{status:'superseded'})
  assert.equal((await requestRef().get()).data().renewalStatus,'pending_verification')
  assert.equal((await renewalTask().get()).data().verificationReceipt,undefined)
})

test('renewal dispatcher honors accepted cancellation without restarting subscription or account deletion',async()=>{
  await seedRenewal();await enableEmulatorRenewal()
  assert.equal((await call(owner,'/request','POST',{action:'cancel'})).status,200)
  assert.equal((await dispatchWith().execute({uid:owner.uid,revision:1})).renewalStatus,'verified_no_subscription')
  assert.equal((await requestRef().get()).data().status,'cancelled')
  assert.equal((await auth.getUser(owner.uid)).disabled,false)
})

test('renewal dispatcher holds wrong provider evidence for review and enforces attempt limit',async()=>{
  await seedRenewal();await enableEmulatorRenewal()
  const bad={...provider,discover:async()=>({uid:owner.uid,complete:false,subscriptions:[]})}
  assert.deepEqual(await dispatchWith(bad).execute({uid:owner.uid,revision:1}),{status:'review_required'})
  assert.equal((await renewalTask().get()).data().verificationReceipt,undefined)
  assert.equal((await renewalTask().get()).data().nextAttemptAt,null)
  await renewalTask().update({dispatchState:'retry_wait',attempts:5})
  assert.deepEqual(await dispatchWith().execute({uid:owner.uid,revision:1}),{status:'held',code:'attempt_limit'})
  assert.equal((await requestRef().get()).data().renewalStatus,'review_required')
})

test('renewal dispatcher detects a modified receipt instead of accepting forged duplicate success',async()=>{
  await seedRenewal();await enableEmulatorRenewal();const dispatcher=dispatchWith()
  await dispatcher.execute({uid:owner.uid,revision:1})
  await renewalTask().update({'verificationReceipt.bindingHash':'changed'})
  await assert.rejects(dispatcher.execute({uid:owner.uid,revision:1}),/RENEWAL_RECEIPT_CHANGED/)
})

for(const createdAt of [undefined,'not-a-date',new Date(Date.now()+86400000).toISOString()])test(`renewal dispatcher refuses missing or post-acceptance subscription evidence ${String(createdAt)}`,async()=>{
  await seedRenewal({billingAcceptance:false});await enableEmulatorRenewal();let calls=0
  const p={...provider,discover:async()=>({uid:owner.uid,complete:true,billingIdentityHash:(await provider.discover(owner.uid)).billingIdentityHash,subscriptions:[{id:'sub-new',ownerUid:owner.uid,createdAt}]}),stopRenewal:async()=>{calls++}}
  assert.equal((await dispatchWith(p).execute({uid:owner.uid,revision:1})).status,'review_required')
  assert.equal(calls,0);assert.equal((await renewalTask().get()).data().verificationReceipt,undefined)
  assert.equal((await auth.getUser(owner.uid)).disabled,false)
})

test('renewal dispatcher expired attempt cannot overwrite the replacement receipt',async()=>{
  await seedRenewal({billingAcceptance:false});await enableEmulatorRenewal();let time=Date.now(),enter,release
  const entered=new Promise(r=>{enter=r}),gate=new Promise(r=>{release=r})
  const slow={...provider,discover:async uid=>{enter();await gate;return provider.discover(uid)}}
  const first=dispatchWith(slow,()=>time).execute({uid:owner.uid,revision:1})
  try{
    await entered;time+=60001
    assert.equal((await dispatchWith(provider,()=>time).execute({uid:owner.uid,revision:1})).status,'completed')
  }finally{release()}
  assert.deepEqual(await first,{status:'superseded'})
  const task=(await renewalTask().get()).data()
  assert.equal(task.attempts,2);assert.equal(task.dispatchEpoch,task.verificationReceipt.epoch)
})

test('renewal dispatcher resumes verified per-subscription receipts after a later provider timeout',async()=>{
  const createdAt=new Date(Date.now()-1000).toISOString()
  await seedRenewal({billingAcceptance:false,subscriptions:['sub-a','sub-b'].map(id=>({id,ownerUid:owner.uid,createdAt,renewalStopped:false}))})
  await enableEmulatorRenewal();let time=Date.now(),drop=true;const calls=[]
  const p={...provider,stopRenewal:async(id,args)=>{calls.push(id);await provider.stopRenewal(id,args);if(id==='sub-b'&&drop){drop=false;throw Object.assign(Error('lost reply'),{code:'ETIMEDOUT'})}}}
  assert.equal((await dispatchWith(p,()=>time).execute({uid:owner.uid,revision:1})).status,'retry_wait')
  assert.equal((await renewalTask().collection('receipts').get()).size,1)
  time=Date.parse((await renewalTask().get()).data().nextAttemptAt)
  assert.equal((await dispatchWith(p,()=>time).execute({uid:owner.uid,revision:1})).status,'completed')
  assert.deepEqual(calls,['sub-a','sub-b','sub-b'])
  assert.equal((await renewalTask().collection('receipts').get()).size,2)
  assert.equal((await db.doc(`deletionSyntheticProviders/${owner.uid}`).get()).data().keys.length,2)
})

test('renewal dispatcher refuses a different customer binding recorded after acceptance',async()=>{
  await seedRenewal();await enableEmulatorRenewal()
  await db.doc(`users/${owner.uid}`).update({stripeCustomerId:'cus_replacement'})
  let calls=0
  const p={...provider,stopRenewal:async()=>{calls++}}
  assert.equal((await dispatchWith(p).execute({uid:owner.uid,revision:1})).status,'review_required')
  assert.equal(calls,0);assert.equal((await renewalTask().get()).data().verificationReceipt,undefined)
})

test('renewal dispatcher does not invent an acceptance binding for legacy tasks',async()=>{
  await seedRenewal();await enableEmulatorRenewal()
  await renewalTask().update({billingIdentityHash:FieldValue.delete()})
  assert.deepEqual(await dispatchWith().execute({uid:owner.uid,revision:1}),{status:'held',code:'acceptance_billing_binding_missing'})
  assert.equal((await renewalTask().get()).data().attempts,undefined)
})

async function queueManifest(identities=[owner]){
  return {id:'synthetic-operator-batch',targets:await Promise.all(identities.map(async identity=>{
    const r=(await db.doc(`accountDeletionRequests/${identity.uid}`).get()).data()
    return {uid:identity.uid,revision:r.revision,acceptedAt:r.acceptedAt}
  }))}
}
const queueWith=(manifest,options={})=>createGuardedRenewalQueue({db,provider,manifest,mode:'prototype-emulator',
  assertRuntime:uid=>{requireDeletionEmulators({db,auth,bucket,projectId:PROJECT});if(!manifest.targets.some(t=>t.uid===uid))throw Error('not allowlisted')},...options})

test('renewal queue defaults disabled and does not activate disabled tasks',async()=>{
  await seedRenewal();const q=queueWith(await queueManifest())
  assert.equal((await q.run()).code,'queue_execution_disabled')
  assert.equal((await requestRef().get()).data().renewalQueue,undefined)
  assert.deepEqual(await q.run({executionEnabled:true}),{status:'blocked',cursor:0,total:1,taskStatus:'held'})
  assert.equal((await renewalTask().get()).data().executionEnabled,false)
})

test('renewal queue pages explicit revisions and a new worker validates completion receipts',async()=>{
  await seedRenewal();await enableEmulatorRenewal()
  await db.doc(`users/${other.uid}`).update({stripeCustomerId:'cus_other'})
  await db.doc(`deletionSyntheticProviders/${other.uid}`).set({discoveryComplete:true,subscriptions:[]})
  await changeDeletionRequest({db,token:await auth.verifyIdToken(other.token,true),body:reqBody})
  await db.doc(`accountDeletionRenewalTasks/${other.uid}_1`).update({executionEnabled:true})
  const manifest=await queueManifest([owner,other])
  assert.deepEqual(await queueWith(manifest).run({limit:1,executionEnabled:true}),{status:'page_completed',cursor:1,total:2})
  assert.equal((await db.doc(`accountDeletionRenewalTasks/${other.uid}_1`).get()).data().attempts,undefined)
  assert.deepEqual(await queueWith(manifest).run({limit:1,executionEnabled:true}),{status:'completed',cursor:2,total:2})
  assert.equal((await queueWith(manifest).run({executionEnabled:true})).status,'completed')
  assert.equal((await renewalTask().get()).data().attempts,1)
  await renewalTask().update({'verificationReceipt.bindingHash':'tampered'})
  await assert.rejects(queueWith(manifest).run({executionEnabled:true}),/RENEWAL_RECEIPT_CHANGED/)
})

test('renewal queue recovers a task completed before its queue acknowledgement',async()=>{
  await seedRenewal();await enableEmulatorRenewal();await dispatchWith().execute({uid:owner.uid,revision:1})
  const manifest=await queueManifest();let calls=0
  const p={...provider,discover:async()=>{calls++;throw Error('receipt recovery must not rediscover')}}
  assert.equal((await queueWith(manifest,{provider:p}).run({executionEnabled:true})).status,'completed')
  assert.equal(calls,0);assert.equal((await renewalTask().get()).data().attempts,1)
})

test('renewal queue validates every allowlisted UID before touching any checkpoint',async()=>{
  await seedRenewal();const manifest=await queueManifest();manifest.targets.push({uid:other.uid,revision:1,acceptedAt:manifest.targets[0].acceptedAt})
  const q=queueWith(manifest,{assertRuntime:async uid=>{if(uid!==owner.uid)throw Error('scope denied')}})
  await assert.rejects(q.run({executionEnabled:true}),/scope denied/)
  assert.equal((await requestRef().get()).data().renewalQueue,undefined)
})

test('renewal queue refuses changed manifest, target revision and backwards clock',async()=>{
  await seedRenewal();await enableEmulatorRenewal();const manifest=await queueManifest();let time=Date.now()
  const q=queueWith(manifest,{clock:()=>time});await q.run({executionEnabled:true})
  time--;await assert.rejects(q.run({executionEnabled:true}),/RENEWAL_QUEUE_CLOCK_INVALID/)
  await assert.rejects(queueWith({...manifest,id:'different-batch'}).run({executionEnabled:true}),/RENEWAL_QUEUE_CHECKPOINT_CHANGED/)
  await requestRef().update({revision:2})
  await assert.rejects(queueWith(manifest).run({executionEnabled:true}),/RENEWAL_QUEUE_TARGET_CHANGED/)
})

test('renewal queue concurrent operators exclude live leases and expired workers cannot acknowledge',async()=>{
  await seedRenewal();await enableEmulatorRenewal();const manifest=await queueManifest();let time=Date.now(),entered,release
  const enteredPromise=new Promise(r=>{entered=r}),hold=new Promise(r=>{release=r})
  const p={...provider,discover:async uid=>{entered();await hold;return provider.discover(uid)}}
  const first=queueWith(manifest,{provider:p,clock:()=>time}).run({executionEnabled:true})
  await enteredPromise
  assert.equal((await queueWith(manifest,{clock:()=>time}).run({executionEnabled:true})).status,'busy')
  time+=60001
  assert.equal((await queueWith(manifest,{clock:()=>time}).run({executionEnabled:true})).status,'completed')
  release();await assert.rejects(first,/RENEWAL_QUEUE_STALE_ATTEMPT/)
  assert.equal((await requestRef().get()).data().renewalQueue.cursor,1)
})

test('document ingress is disabled by default and authenticates before resolving ownership',async()=>{
  await seed()
  assert.deepEqual(await documentIngress().begin(),{status:'held',code:'document_ingress_disabled'})
  await assert.rejects(documentIngress().begin({idToken:'untrusted',dogId:'synthetic-dog',executionEnabled:true}))
  assert.equal((await db.collection('accountMutationLeases').get()).size,0)
})

test('document ingress rejects former owners, restricted dogs and unresolved owner fields',async()=>{
  await seed()
  for(const patch of [{currentOwnerId:other.uid},{currentOwnerId:owner.uid,status:'restricted'},{currentOwnerId:null,status:'active'}]){
    await db.doc('dogs/synthetic-dog').update(patch)
    await assert.rejects(beginDocument(),/DOCUMENT_INGRESS_OWNERSHIP_REQUIRED/)
  }
  assert.equal((await db.collection('accountMutationLeases').get()).size,0)
})

test('document ingress commits metadata and lease receipt atomically and validates duplicates',async()=>{
  await seed();const session=await beginDocument(),metadata=ingressMetadata()
  await session.assertRecordWrite()
  assert.deepEqual(await session.createDocument({recordId:'ingress-proof',metadata}),{status:'record_created',recordId:'ingress-proof'})
  const lease=(await db.doc(`accountMutationLeases/${session.leaseId}`).get()).data()
  assert.equal(lease.state,'closed');assert.equal(lease.documentRecord.path,'documents/ingress-proof')
  const stored=(await db.doc('documents/ingress-proof').get()).data()
  assert.equal(stored.tenantId,owner.uid);assert.equal(stored.dogId,'synthetic-dog')
  assert.equal((await session.createDocument({recordId:'ingress-proof',metadata})).duplicate,true)
  await assert.rejects(session.createDocument({recordId:'ingress-proof',metadata:{...metadata,title:'changed'}}),/DOCUMENT_INGRESS_RECEIPT_CHANGED/)
  await db.doc('documents/ingress-proof').update({title:'tampered'})
  await assert.rejects(session.createDocument({recordId:'ingress-proof',metadata}),/DOCUMENT_INGRESS_RECEIPT_CHANGED/)
})

test('document ingress refuses a late deletion lock without closing the active hold',async()=>{
  await seed();const session=await beginDocument()
  await db.doc(`accountDeletionLocks/${owner.uid}`).set({state:'processing'})
  await assert.rejects(session.assertRecordWrite(),/ACCOUNT_DELETION_LOCKED/)
  await assert.rejects(session.createDocument({recordId:'ingress-proof',metadata:ingressMetadata()}),/ACCOUNT_DELETION_LOCKED/)
  assert.equal((await db.doc('documents/ingress-proof').get()).exists,false)
  assert.equal((await db.doc(`accountMutationLeases/${session.leaseId}`).get()).data().state,'active')
})

test('document ingress pins ownership and the exact dog version before record writes',async()=>{
  await seed();const session=await beginDocument()
  await db.doc('dogs/synthetic-dog').update({currentOwnerId:other.uid})
  await assert.rejects(session.createDocument({recordId:'ingress-proof',metadata:ingressMetadata()}),/DOCUMENT_INGRESS_OWNERSHIP_CHANGED/)
  assert.equal((await db.doc('documents/ingress-proof').get()).exists,false)
  assert.equal((await db.doc(`accountMutationLeases/${session.leaseId}`).get()).data().state,'active')
})

test('document ingress rechecks revoked Auth and rejects caller ownership or foreign paths',async()=>{
  await seed();const session=await beginDocument(),metadata=ingressMetadata()
  for(const change of [{tenantId:other.uid},{dogId:'foreign-dog'},{createdBy:other.uid}])await assert.rejects(session.createDocument({recordId:'ingress-proof',metadata:{...metadata,...change}}),/CALLER_IDENTITY_FORBIDDEN/)
  await assert.rejects(session.createDocument({recordId:'ingress-proof',metadata:{...metadata,filePath:`documents/${other.uid}/synthetic-dog/proof.pdf`}}),/RECORD_INVALID/)
  await auth.updateUser(owner.uid,{disabled:true})
  await assert.rejects(session.createDocument({recordId:'ingress-proof',metadata}))
  assert.equal((await db.doc('documents/ingress-proof').get()).exists,false)
})

test('document ingress active session blocks the destructive worker until metadata commit',async()=>{
  await seed();const session=await beginDocument()
  const result=await processor.process({uid:owner.uid,revision:1})
  assert.notEqual(result.status,'completed')
  assert.equal((await db.doc('dogs/synthetic-dog').get()).exists,true)
  assert.equal((await auth.getUser(owner.uid)).disabled,false)
  assert.equal((await db.doc(`accountMutationLeases/${session.leaseId}`).get()).data().state,'active')
})

test('document ingress refuses same-owner version changes and altered lease proof',async()=>{
  await seed();const session=await beginDocument()
  await db.doc('dogs/synthetic-dog').update({name:'Edited after claim'})
  await assert.rejects(session.createDocument({recordId:'ingress-proof',metadata:ingressMetadata()}),/DOCUMENT_INGRESS_OWNERSHIP_CHANGED/)
  const second=await beginDocument()
  await db.doc(`accountMutationLeases/${second.leaseId}`).update({'documentIngress.epoch':'replaced'})
  await assert.rejects(second.createDocument({recordId:'ingress-proof',metadata:ingressMetadata()}),/DOCUMENT_INGRESS_LEASE_CHANGED/)
  await db.doc(`accountMutationLeases/${second.leaseId}`).update({documentIngress:FieldValue.delete()})
  await assert.rejects(second.createDocument({recordId:'ingress-proof',metadata:ingressMetadata()}),/DOCUMENT_INGRESS_LEASE_CHANGED/)
  assert.equal((await db.doc('documents/ingress-proof').get()).exists,false)
})

test('document ingress constructor cannot target cloud services',()=>{
  assert.throws(()=>createEmulatorDocumentIngress({db,auth,bucket,projectId:'idogs-app-staging'}),/DELETION_EMULATOR_ONLY/)
})

const resumeDocument=(leaseId,idToken=owner.token,dogId='synthetic-dog')=>documentIngress().resume({leaseId,idToken,dogId,executionEnabled:true})
function independentLedger(nonce=randomUUID(),overrides={}){
  return createEmulatorIndependentLedger({db,ledgerDb,auth,bucket,projectId:PROJECT,uid:owner.uid,nonce,executionEnabled:true,...overrides})
}
test('independent ledger defaults disabled and rejects the restored/default or cloud database',async()=>{
  assert.throws(()=>independentLedger(randomUUID(),{executionEnabled:false}),/INDEPENDENT_LEDGER_DISABLED/)
  assert.throws(()=>independentLedger(randomUUID(),{ledgerDb:db}),/INDEPENDENT_LEDGER_TARGET_INVALID/)
  assert.throws(()=>independentLedger(randomUUID(),{ledgerDb:{projectId:PROJECT,databaseId:'idogs-deletion-ledger-qa',_settings:{servicePath:'remote.example',port:443,ssl:true}}}),/INDEPENDENT_LEDGER_ENDPOINT_CHANGED/)
  assert.throws(()=>independentLedger(randomUUID(),{projectId:'idogs-app-staging'}),/DELETION_EMULATOR_ONLY/)
})
test('independent ledger publishes durable acceptance and completion with restart duplicate receipts',async()=>{
  await seed();const nonce=randomUUID(),ledger=independentLedger(nonce)
  assert.equal((await ledger.quarantine()).code,'independent_ledger_missing')
  await assert.rejects(ledger.assertWritable(owner.uid),/INDEPENDENT_LEDGER_HISTORY_REQUIRED/)
  const first=await ledger.publishAccepted();assert.equal(first.sequence,1);assert.equal(first.duplicate,false)
  assert.equal((await independentLedger(nonce).publishAccepted()).duplicate,true)
  await assert.rejects(ledger.publishCompleted(),/INDEPENDENT_LEDGER_COMPLETION_REQUIRED/)
  assert.equal((await processor.process({uid:owner.uid,revision:1})).status,'completed')
  const completed=await ledger.publishCompleted();assert.equal(completed.sequence,2)
  assert.equal((await independentLedger(nonce).publishCompleted()).duplicate,true)
  const state=await independentLedger(nonce).read()
  assert.equal(state.events.length,2);assert.equal(state.events[1].previous,state.events[0].hash)
  assert.equal(state.head.hash,completed.hash)
  assert.equal(JSON.stringify(state).includes(owner.email),false)
  assert.equal((await ledger.quarantine()).code,'independent_deletion_receipt')
})
test('independent receipt survives restored source tombstone loss and historical Auth import',async()=>{
  const signInLocal=async()=>{
    const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:await auth.createCustomToken(owner.uid),returnSecureToken:true}),redirect:'error',signal:AbortSignal.timeout(5000)})
    assert.equal(response.status,200);return (await response.json()).idToken
  }
  // Use an actual provider-less custom-auth account. Reconstructing password
  // credentials is unnecessary and no password/hash export is permitted.
  await auth.deleteUser(owner.uid);await auth.createUser({uid:owner.uid,email:owner.email,emailVerified:true})
  owner.token=await signInLocal()
  await seed();const nonce=randomUUID(),ledger=independentLedger(nonce),original=await auth.getUser(owner.uid)
  const lookup=async idToken=>{
    const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=synthetic&fields=users(localId,createdAt,email,phoneNumber,tenantId)`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken}),redirect:'error',signal:AbortSignal.timeout(5000)})
    assert.equal(response.status,200);const raw=(await response.json()).users[0]
    return {uid:raw.localId,createdAt:raw.createdAt,email:raw.email||null,phone:raw.phoneNumber||null,tenant:raw.tenantId||null}
  }
  const precise=await lookup(owner.token)
  const saved=(await requestRef().get()).data(),savedDog=(await db.doc('dogs/synthetic-dog').get()).data()
  await ledger.publishAccepted();await processor.process({uid:owner.uid,revision:1});await ledger.publishCompleted()
  const external=await ledger.read()
  // Restore only this exact synthetic account's source records, not the
  // separate receipt database. Import preserves the historical SDK metadata.
  await db.doc(`accountDeletionLocks/${owner.uid}`).delete()
  await requestRef().set(saved)
  await db.doc(`users/${owner.uid}`).set({email:owner.email,firstName:'Restored synthetic'})
  await db.doc('dogs/synthetic-dog').set(savedDog)
  const imported=await auth.importUsers([{uid:owner.uid,email:owner.email,emailVerified:true,
    providerData:original.providerData.map(p=>({providerId:p.providerId,uid:p.uid,email:p.email})),
    metadata:{creationTime:new Date(Number(precise.createdAt)).toISOString()}}])
  assert.equal(imported.failureCount,0)
  const restored=await auth.getUser(owner.uid)
  assert.equal(restored.metadata.creationTime,original.metadata.creationTime)
  assert.deepEqual(restored.providerData,original.providerData)
  owner.token=await signInLocal()
  const restoredEvidence=await lookup(owner.token)
  assert.deepEqual(restoredEvidence,precise)
  assert.equal((await db.doc(`accountDeletionLocks/${owner.uid}`).get()).exists,false)
  const gate=await independentLedger(nonce).quarantine()
  assert.equal(gate.code,'restored_auth_quarantine');assert.equal(gate.authState,'enabled')
  assert.equal(gate.watermark,external.head.hash);assert.equal(gate.productionReady,false)
  assert.equal(gate.globalCompletenessVerified,false)
  assert.deepEqual(await ledger.read(),external)
  const baseline=await beginDocument();assert.equal(baseline.status,'claimed')
  const leases=(await db.collection('accountMutationLeases').get()).size
  const guarded=createEmulatorDocumentIngress({db,auth,bucket,projectId:PROJECT,independentLedger:independentLedger(nonce)})
  await assert.rejects(async()=>{
    const session=await guarded.begin({idToken:owner.token,dogId:'synthetic-dog',executionEnabled:true})
    return session.createDocument({recordId:'restored-write',metadata:ingressMetadata()})
  },/INDEPENDENT_LEDGER_QUARANTINED/)
  assert.equal((await db.collection('accountMutationLeases').get()).size,leases)
  assert.equal((await db.doc('documents/restored-write').get()).exists,false)
  await assert.rejects(ledger.assertWritable(other.uid),/INDEPENDENT_LEDGER_ACCOUNT_MISMATCH/)
})
test('independent ledger refuses replaced scope, altered chain and erased heads without granting access',async()=>{
  await seed();const nonce=randomUUID(),ledger=independentLedger(nonce)
  await ledger.publishAccepted()
  await assert.rejects(independentLedger().read(),/INDEPENDENT_LEDGER_HEAD_CHANGED/)
  const ref=ledgerDb.doc(`scopedDeletionLedger/${owner.uid}`),event=ref.collection('events').doc('000001'),saved=(await event.get()).data()
  await event.update({requestHash:'0'.repeat(64)})
  await assert.rejects(ledger.quarantine(),/INDEPENDENT_LEDGER_CHAIN_CHANGED/)
  await event.set(saved);await ref.delete()
  await assert.rejects(ledger.quarantine(),/INDEPENDENT_LEDGER_ORPHANED/)
})
test('independent ledger concurrent publishers produce one accepted event and reject a changed source revision',async()=>{
  await seed();const nonce=randomUUID(),ledger=independentLedger(nonce)
  const result=await Promise.all([ledger.publishAccepted(),independentLedger(nonce).publishAccepted()])
  assert.equal(result.filter(r=>!r.duplicate).length,1)
  assert.equal((await ledger.read()).events.length,1)
  await requestRef().update({revision:2})
  await assert.rejects(ledger.publishAccepted(),/INDEPENDENT_LEDGER_REQUEST_INVALID/)
  assert.equal((await ledger.read()).events.length,1)
})
test('independent ledger recovers an actual committed receipt after its caller loses the response',async()=>{
  await seed();const nonce=randomUUID();let lost=true
  const fault={projectId:ledgerDb.projectId,databaseId:ledgerDb.databaseId,_settings:ledgerDb._settings,collection:ledgerDb.collection.bind(ledgerDb),
    runTransaction:async fn=>{const result=await ledgerDb.runTransaction(fn);if(lost){lost=false;throw Error('synthetic lost commit reply')}return result}}
  await assert.rejects(independentLedger(nonce,{ledgerDb:fault}).publishAccepted(),/synthetic lost commit reply/)
  const restarted=independentLedger(nonce)
  assert.equal((await restarted.read()).events.length,1)
  assert.equal((await restarted.publishAccepted()).duplicate,true)
  assert.equal((await restarted.quarantine()).code,'restored_auth_quarantine')
})
test('independent ledger refuses a watermark that changes while Auth is inspected',async()=>{
  await seed();const nonce=randomUUID(),ledger=independentLedger(nonce)
  await ledger.publishAccepted();await processor.process({uid:owner.uid,revision:1})
  let changed=false
  const changing=new Proxy(auth,{get(target,key){if(key==='getUser')return async uid=>{if(!changed){changed=true;await ledger.publishCompleted()}return target.getUser(uid)};const value=target[key];return typeof value==='function'?value.bind(target):value}})
  await assert.rejects(independentLedger(nonce,{auth:changing}).quarantine(),/INDEPENDENT_LEDGER_WATERMARK_CHANGED/)
  assert.equal((await ledger.read()).head.sequence,2)
  assert.equal((await ledger.quarantine()).code,'independent_deletion_receipt')
})
async function signInFixture(email){
  const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Emulator-fixture-only-42!',returnSecureToken:true})})
  assert.equal(response.status,200);return (await response.json()).idToken
}

test('document ingress restart resumes the exact durable lease and verifies closed receipt recovery',async()=>{
  await seed();const original=await beginDocument(),metadata=ingressMetadata()
  const persisted=(await db.doc(`accountMutationLeases/${original.leaseId}`).get()).data()
  assert.equal(persisted.documentIngress.schema,2)
  assert.match(persisted.documentIngress.authHash,/^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(persisted).includes(owner.email),false)
  const restarted=await resumeDocument(original.leaseId,await signInFixture(owner.email))
  await restarted.assertRecordWrite()
  assert.equal((await restarted.createDocument({recordId:'ingress-resumed',metadata})).status,'record_created')
  assert.equal((await db.collection('accountMutationLeases').get()).size,1)
  assert.equal((await (await resumeDocument(original.leaseId)).createDocument({recordId:'ingress-resumed',metadata})).duplicate,true)
  assert.equal((await db.collection('accountMutationLeases').get()).size,1)
})

test('document ingress restart refuses legacy Auth-unbound evidence without rewriting or replacing the hold',async()=>{
  await seed();const original=await beginDocument(),ref=db.doc(`accountMutationLeases/${original.leaseId}`)
  await ref.update({'documentIngress.schema':1,'documentIngress.authHash':FieldValue.delete()})
  const before=(await ref.get()).data()
  await assert.rejects(resumeDocument(original.leaseId),/DOCUMENT_INGRESS_AUTH_BINDING_MISSING/)
  assert.deepEqual((await ref.get()).data(),before)
  assert.equal((await db.collection('accountMutationLeases').get()).size,1)
})

test('document ingress restart refuses changed Auth identity even with a fresh valid token',async()=>{
  await seed();const original=await beginDocument(),email=`changed-${owner.email}`
  await auth.updateUser(owner.uid,{email})
  const freshToken=await signInFixture(email)
  assert.equal((await auth.verifyIdToken(freshToken,true)).uid,owner.uid)
  await assert.rejects(resumeDocument(original.leaseId,freshToken),/DOCUMENT_INGRESS_IDENTITY_CHANGED/)
  await assert.rejects(original.assertRecordWrite())
  assert.equal((await db.doc(`accountMutationLeases/${original.leaseId}`).get()).data().state,'active')
})

test('document ingress restart refuses a recreated Auth user with the same UID and email',async()=>{
  await seed();const original=await beginDocument()
  await auth.deleteUser(owner.uid)
  const replacement=await auth.createUser({uid:owner.uid,email:owner.email,password:'Emulator-fixture-only-42!',emailVerified:true})
  assert.equal(replacement.uid,owner.uid);assert.equal(replacement.email,owner.email)
  const freshToken=await signInFixture(owner.email)
  assert.equal((await auth.verifyIdToken(freshToken,true)).uid,owner.uid)
  await assert.rejects(resumeDocument(original.leaseId,freshToken),/DOCUMENT_INGRESS_IDENTITY_CHANGED/)
  assert.equal((await db.doc(`accountMutationLeases/${original.leaseId}`).get()).data().state,'active')
})

test('document ingress restart rejects foreign identities, malformed lease IDs and changed lease scope',async()=>{
  await seed();const original=await beginDocument()
  await assert.rejects(resumeDocument(original.leaseId,other.token),/DOCUMENT_INGRESS_LEASE_CHANGED/)
  await assert.rejects(resumeDocument('../foreign'),/DOCUMENT_INGRESS_INPUT_INVALID/)
  await assert.rejects(resumeDocument(original.leaseId,owner.token,'foreign-dog'),/DOCUMENT_INGRESS_LEASE_CHANGED/)
  await db.doc(`accountMutationLeases/${original.leaseId}`).update({'documentIngress.mode':'production'})
  await assert.rejects(resumeDocument(original.leaseId),/DOCUMENT_INGRESS_LEASE_CHANGED/)
  assert.equal((await db.collection('accountMutationLeases').get()).size,1)
})

test('document ingress refuses missing or mismatched precise Auth evidence before creating a lease',async()=>{
  await seed();const originalFetch=globalThis.fetch
  try{
    for(const body of [{users:[]},{users:[{localId:other.uid,createdAt:'1'}]},{users:[{localId:owner.uid}]}]){
      globalThis.fetch=async(url,options)=>String(url).includes('/accounts:lookup?')?new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}}):originalFetch(url,options)
      await assert.rejects(beginDocument(),/DOCUMENT_INGRESS_AUTH_EVIDENCE_REQUIRED/)
    }
    globalThis.fetch=async(url,options)=>String(url).includes('/accounts:lookup?')?new Response(null,{status:503}):originalFetch(url,options)
    await assert.rejects(beginDocument(),/DOCUMENT_INGRESS_AUTH_EVIDENCE_REQUIRED/)
  }finally{globalThis.fetch=originalFetch}
  assert.equal((await db.collection('accountMutationLeases').get()).size,0)
})

const storageMetadata=()=>({...ingressMetadata(),fileName:'guarded.pdf',filePath:`documents/${owner.uid}/synthetic-dog/guarded.pdf`})
test('document storage persists intent then verifies a single create and exact-generation readback',async()=>{
  await seed();const session=await beginDocument(),metadata=storageMetadata(),bytes=Buffer.from('Guarded synthetic document')
  const retries={...bucket.storage.retryOptions}
  assert.deepEqual(await session.writeStorage({filePath:metadata.filePath,content:bytes,mediaType:metadata.mediaType}),{status:'storage_verified'})
  const lease=(await db.doc(`accountMutationLeases/${session.leaseId}`).get()).data()
  assert.equal(lease.storageWrite.state,'verified');assert.equal(lease.state,'active')
  assert.equal(lease.storageWrite.receipt.terminal,'single_nonretrying_save_resolved')
  assert.match(lease.storageWrite.receipt.generation,/^\d+$/)
  assert.equal((await db.doc(`accountMutationLeases/${session.leaseId}/storageIntents/${lease.documentIngress.storageIntentHash}`).get()).exists,true)
  assert.deepEqual(bucket.storage.retryOptions,retries)
  const resumed=await resumeDocument(session.leaseId)
  assert.equal((await resumed.writeStorage({filePath:metadata.filePath,content:bytes,mediaType:metadata.mediaType})).duplicate,true)
  assert.equal((await resumed.createDocument({recordId:'storage-proof',metadata})).status,'record_created')
  assert.equal((await db.doc(`accountMutationLeases/${session.leaseId}`).get()).data().state,'closed')
})

test('document storage refuses generation changes and cannot erase intent to bypass the write hold',async()=>{
  await seed();const session=await beginDocument(),metadata=storageMetadata()
  await session.writeStorage({filePath:metadata.filePath,content:Buffer.from('Original synthetic content'),mediaType:metadata.mediaType})
  await bucket.file(metadata.filePath).save(Buffer.from('Replacement synthetic content'))
  await assert.rejects(session.createDocument({recordId:'storage-proof',metadata}),/DOCUMENT_STORAGE_READBACK_CHANGED/)
  const ref=db.doc(`accountMutationLeases/${session.leaseId}`)
  await ref.update({storageWrite:FieldValue.delete(),'documentIngress.storageIntentHash':FieldValue.delete()})
  const restarted=await resumeDocument(session.leaseId)
  await assert.rejects(restarted.createDocument({recordId:'storage-proof',metadata}),/DOCUMENT_STORAGE_INTENT_CHANGED/)
  assert.equal((await db.doc('documents/storage-proof').get()).exists,false)
  assert.equal((await ref.get()).data().state,'active')
})

async function storageResponseBarrier(mode){
  const actual=process.env.FIREBASE_STORAGE_EMULATOR_HOST,oldGcs=process.env.STORAGE_EMULATOR_HOST
  let sends=0,entered,release
  const enteredPromise=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r})
  const proxy=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk)
      const headers={...req.headers};for(const key of ['host','connection','transfer-encoding','content-length'])delete headers[key]
      const response=await fetch(`http://${actual}${req.url}`,{method:req.method,headers,redirect:'error',...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})})
      const bytes=Buffer.from(await response.arrayBuffer())
      if(mode==='freeze'&&req.method==='GET'&&response.status===404)await db.doc(`accountDeletionLocks/${owner.uid}`).set({state:'processing'})
      if(req.method==='POST'){
        sends++;entered()
        if(mode==='drop'){res.destroy();return}
        if(mode==='hold')await gate
      }
      const output=Object.fromEntries(response.headers)
      for(const key of ['content-encoding','content-length','connection','transfer-encoding'])delete output[key]
      res.writeHead(response.status,output);res.end(bytes)
    }catch{if(!res.headersSent){res.statusCode=502;res.end('synthetic proxy failure')}else res.destroy()}
  })
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r))
  const host=`127.0.0.1:${proxy.address().port}`
  process.env.FIREBASE_STORAGE_EMULATOR_HOST=host;process.env.STORAGE_EMULATOR_HOST=`http://${host}`
  return {entered:enteredPromise,release,count:()=>sends,async close(){
    release();process.env.FIREBASE_STORAGE_EMULATOR_HOST=actual;process.env.STORAGE_EMULATOR_HOST=oldGcs
    proxy.closeAllConnections();await new Promise(r=>proxy.close(r))
  }}
}

test('document storage matching object while the HTTP reply is pending cannot close the lease',async()=>{
  await seed();const session=await beginDocument(),metadata=storageMetadata(),barrier=await storageResponseBarrier('hold')
  const writing=session.writeStorage({filePath:metadata.filePath,content:Buffer.from('Pending response fixture'),mediaType:metadata.mediaType})
  try{
    await Promise.race([barrier.entered,writing.then(()=>{throw Error('write finished before response barrier')})])
    assert.equal((await bucket.file(metadata.filePath).exists())[0],true)
    await assert.rejects(session.createDocument({recordId:'storage-proof',metadata}),/DOCUMENT_STORAGE_OUTCOME_UNKNOWN/)
    assert.equal((await db.doc(`accountMutationLeases/${session.leaseId}`).get()).data().state,'active')
    barrier.release();assert.equal((await writing).status,'storage_verified')
    assert.equal(barrier.count(),1)
    assert.equal((await session.createDocument({recordId:'storage-proof',metadata})).status,'record_created')
  }finally{barrier.release();await writing.catch(()=>{});await barrier.close()}
})

test('document storage lost HTTP reply remains unknown after restart whether matching object exists or is absent',async()=>{
  await seed();const session=await beginDocument(),metadata=storageMetadata(),bytes=Buffer.from('Lost response fixture')
  const barrier=await storageResponseBarrier('drop')
  try{
    await assert.rejects(session.writeStorage({filePath:metadata.filePath,content:bytes,mediaType:metadata.mediaType}),/DOCUMENT_STORAGE_OUTCOME_UNKNOWN/)
    assert.equal(barrier.count(),1)
  }finally{await barrier.close()}
  assert.equal((await bucket.file(metadata.filePath).exists())[0],true)
  const leaseRef=db.doc(`accountMutationLeases/${session.leaseId}`)
  assert.equal((await leaseRef.get()).data().storageWrite.state,'unknown')
  const restarted=await resumeDocument(session.leaseId)
  await assert.rejects(restarted.createDocument({recordId:'storage-proof',metadata}),/DOCUMENT_STORAGE_OUTCOME_UNKNOWN/)
  await assert.rejects(restarted.writeStorage({filePath:metadata.filePath,content:bytes,mediaType:metadata.mediaType}),/DOCUMENT_STORAGE_OUTCOME_UNKNOWN/)
  await bucket.file(metadata.filePath).delete() // Disposable LOCAL fixture only, not evidence that the original send drained.
  await assert.rejects((await resumeDocument(session.leaseId)).createDocument({recordId:'storage-proof',metadata}),/DOCUMENT_STORAGE_OUTCOME_UNKNOWN/)
  assert.equal((await leaseRef.get()).data().state,'active')
  assert.equal((await db.doc('documents/storage-proof').get()).exists,false)
})

test('document storage occupied-path preflight preserves existing content and holds the write',async()=>{
  await seed();const session=await beginDocument(),metadata=ingressMetadata()
  const [before]=await bucket.file(metadata.filePath).download()
  await assert.rejects(session.writeStorage({filePath:metadata.filePath,content:Buffer.from('Must not overwrite'),mediaType:metadata.mediaType}),/DOCUMENT_STORAGE_OUTCOME_UNKNOWN/)
  assert.deepEqual((await bucket.file(metadata.filePath).download())[0],before)
  assert.equal((await db.doc(`accountMutationLeases/${session.leaseId}`).get()).data().state,'active')
})

test('document storage concurrent sessions reserve one path without a second send',async()=>{
  await seed();const first=await beginDocument(),second=await beginDocument(),metadata=storageMetadata(),barrier=await storageResponseBarrier('hold')
  const writing=first.writeStorage({filePath:metadata.filePath,content:Buffer.from('First reserved write'),mediaType:metadata.mediaType})
  try{
    await Promise.race([barrier.entered,writing.then(()=>{throw Error('write finished before response barrier')})])
    await assert.rejects(second.writeStorage({filePath:metadata.filePath,content:Buffer.from('Competing write'),mediaType:metadata.mediaType}),/DOCUMENT_STORAGE_PATH_ALREADY_CLAIMED/)
    barrier.release();await writing;assert.equal(barrier.count(),1)
  }finally{barrier.release();await writing.catch(()=>{});await barrier.close()}
})

test('document storage rechecks the deletion lock after preflight and before the actual send',async()=>{
  await seed();const session=await beginDocument(),metadata=storageMetadata(),barrier=await storageResponseBarrier('freeze')
  try{
    await assert.rejects(session.writeStorage({filePath:metadata.filePath,content:Buffer.from('Must not send'),mediaType:metadata.mediaType}),/DOCUMENT_STORAGE_OUTCOME_UNKNOWN/)
    assert.equal(barrier.count(),0)
    assert.equal((await bucket.file(metadata.filePath).exists())[0],false)
    assert.equal((await db.doc(`accountMutationLeases/${session.leaseId}`).get()).data().state,'active')
  }finally{await barrier.close()}
})
