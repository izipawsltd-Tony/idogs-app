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

const PROJECT='demo-idogs-deletion'
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])if(!/^(localhost|127\.0\.0\.1):\d{4,5}$/.test(process.env[key]||''))throw Error('Expected local emulators')
if(process.env.GCLOUD_PROJECT!==PROJECT||process.env.ACCOUNT_DELETION_MODE!=='prototype-emulator')throw Error('Expected synthetic project opt-in')
let app,db,auth,bucket,rules,server,origin,owner,other,operator,processor,provider,counter=0
const reqBody={action:'request',confirmation:'DELETE MY ACCOUNT'}
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
async function seed({shared=false,media=true}={}){
  await db.collection('users').doc(owner.uid).set({email:owner.email,firstName:'Synthetic',lastName:'Departing',phone:'0400000000',address:'Synthetic only',role:'owner',plan:'free'})
  await db.collection('users').doc(other.uid).set({email:other.email,role:'owner',plan:'free'})
  const dog={tenantId:owner.uid,currentOwnerId:shared?other.uid:owner.uid,name:'Synthetic dog',passportId:'NNG-SYNTHETIC',status:'active'}
  await db.collection('dogs').doc('synthetic-dog').set(dog)
  const recordOwner=shared?other.uid:owner.uid
  await db.collection('vaccineRecords').doc('synthetic-vaccine').set({dogId:'synthetic-dog',createdBy:recordOwner,name:'Synthetic vaccine',dateGiven:'2026-01-01'})
  await db.collection('wormingRecords').doc('synthetic-worm').set({dogId:'synthetic-dog',createdBy:recordOwner,product:'Synthetic worming'})
  if(media){const path=`documents/${recordOwner}/synthetic-dog/proof.pdf`;await bucket.file(path).save(Buffer.from('Synthetic fixture only'));await db.collection('documents').doc('synthetic-document').set({dogId:'synthetic-dog',tenantId:recordOwner,filePath:path})}
  await db.collection('deletionSyntheticProviders').doc(owner.uid).set({discoveryComplete:true,subscriptions:[],retention:{verified:true,restoreReplayVerified:true,mediaIngressDrained:true}})
  await request()
}
before(async()=>{
  app=initializeApp({projectId:PROJECT,storageBucket:`${PROJECT}.firebasestorage.app`});db=getFirestore(app);auth=getAuth(app);bucket=getStorage(app).bucket()
  requireDeletionEmulators({projectId:PROJECT,db,auth,bucket})
  rules=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}})
  provider=syntheticDeletionProvider(db)
  processor=createEmulatorDeletionProcessor({projectId:PROJECT,db,auth,bucket,provider})
  const requestHandler=makeDeletionHandler({db,authenticate:t=>auth.verifyIdToken(t,true)})
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
test('concurrent workers never execute two destructive plans',async()=>{
  await seed();const r=await Promise.allSettled([processor.process({uid:owner.uid,revision:1}),processor.process({uid:owner.uid,revision:1})])
  assert.equal(r.filter(x=>x.status==='fulfilled'&&x.value.status==='completed'&&!x.value.duplicate).length,1)
  assert.ok(r.every(x=>x.status==='fulfilled'?x.value.status==='completed':x.reason.code==='DELETION_WORKER_BUSY'))
  assert.equal((await requestRef().get()).data().status,'completed')
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
  assert.equal((await call(owner,'/request','POST',{action:'cancel'})).status,409)
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
