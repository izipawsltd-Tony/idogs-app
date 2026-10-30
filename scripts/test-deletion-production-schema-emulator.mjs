import {before,after,afterEach,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {initializeApp,deleteApp} from 'firebase-admin/app'
import {getFirestore} from 'firebase-admin/firestore'
import {getAuth} from 'firebase-admin/auth'
import {getStorage} from 'firebase-admin/storage'
import {requireDeletionEmulators} from '../api/_lib/deletion-fence.js'
import {buildDeletionInventory} from '../api/_lib/account-deletion-inventory.js'
import {buildEmulatorDeletionPlan,scanDeletionDocuments,digest,versionOf} from '../api/_lib/deletion-plan.js'
import {createEmulatorDeletionProcessor} from '../api/_lib/deletion-processor.js'
import {syntheticDeletionProvider} from '../api/_lib/deletion-synthetic-provider.js'

// Existing demo project only. No Auth creation, cloud provider, destructive plan,
// global cleanup, altered clock, external request, or resource provisioning.
const PROJECT='demo-idogs-deletion'
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])
  if(!/^(localhost|127\.0\.0\.1):[1-9][0-9]{3,4}$/.test(process.env[key]||''))throw Error('LOCAL_EMULATORS_REQUIRED')
if(process.env.GCLOUD_PROJECT!==PROJECT||process.env.ACCOUNT_DELETION_MODE!=='prototype-emulator')throw Error('SYNTHETIC_OPT_IN_REQUIRED')
let app,db,auth,bucket
const documents=new Map(),objects=new Map()
function runtime(){requireDeletionEmulators({projectId:PROJECT,db,auth,bucket})}
function scope(){const nonce=randomUUID();return {nonce,uid:`synthetic-schema-${nonce}`,other:`synthetic-other-${nonce}`,dog:`schema-dog-${nonce}`,second:`schema-otherdog-${nonce}`}}
async function put(path,data){
  runtime();assert.ok(path.includes(current.nonce),'Every write must include this test nonce')
  const ref=db.doc(path);assert.equal((await ref.get()).exists,false,'Never replace existing data')
  await ref.create(data);const snap=await ref.get();documents.set(path,{ref,hash:digest(snap.data()),version:versionOf(snap)});return ref
}
let current
async function seed(){current=scope();await put(`users/${current.uid}`,{email:`${current.uid}@example.invalid`,role:'owner',plan:'free'});return current}
async function media(path){
  runtime();assert.ok(path.includes(current.nonce));const file=bucket.file(path)
  assert.equal((await file.exists())[0],false);await file.save(Buffer.from(`Synthetic schema fixture ${current.nonce}`))
  const [metadata]=await file.getMetadata();objects.set(path,{file,generation:String(metadata.generation)});return path
}
async function unchanged(){
  for(const {ref,hash,version} of documents.values()){const snap=await ref.get();assert.equal(snap.exists,true);assert.equal(digest(snap.data()),hash);assert.equal(versionOf(snap),version)}
  for(const {file,generation} of objects.values()){const [metadata]=await file.getMetadata();assert.equal(String(metadata.generation),generation)}
}
async function workerHeld(){
  const s=current,requestPath=`accountDeletionRequests/${s.uid}`
  // A scoped source request fixture exercises the real worker's plan barrier.
  // It is not evidence of intake publication or elapsed retention time.
  await put(requestPath,{status:'requested',revision:1,requestedAt:new Date().toISOString(),targetAt:new Date().toISOString()})
  await put(`deletionSyntheticProviders/${s.uid}`,{discoveryComplete:true,subscriptions:[],retention:{verified:true,restoreReplayVerified:true,mediaIngressDrained:true,storageRetentionSeconds:0}})
  const worker=createEmulatorDeletionProcessor({db,auth,bucket,projectId:PROJECT,provider:syntheticDeletionProvider(db)})
  const result=await worker.process({uid:s.uid,revision:1})
  assert.deepEqual(result,{status:'held',code:'unclassified_record_review'})
  const request=await db.doc(requestPath).get()
  assert.equal(request.data().revision,1);assert.equal(request.data().status,'processing');assert.equal(request.data().issueCode,'unclassified_record_review')
  assert.equal((await db.collection('accountDeletionJobs').doc(s.uid).collection('operations').get()).empty,true,'No destructive operation may be staged')
  assert.equal((await db.collection('accountDeletionReceipts').doc(digest([s.uid,1])).get()).exists,false)
  for(const path of [requestPath,`accountDeletionJobs/${s.uid}`,`accountDeletionLocks/${s.uid}`]){
    const snap=await db.doc(path).get();assert.equal(snap.exists,true)
    assert.equal(snap.data().revision,1);documents.set(path,{ref:snap.ref,hash:digest(snap.data()),version:versionOf(snap)})
  }
}
before(()=>{app=initializeApp({projectId:PROJECT,storageBucket:`${PROJECT}.firebasestorage.app`},`schema-${randomUUID()}`);db=getFirestore(app);auth=getAuth(app);bucket=getStorage(app).bucket();runtime()})
afterEach(async()=>{
  // Only original exact test records/objects may be removed; changed evidence is
  // retained and fails cleanup rather than overwriting a concurrent writer.
  runtime();await unchanged()
  for(const {ref,version} of [...documents.values()].reverse()){const snap=await ref.get();assert.equal(versionOf(snap),version);await ref.delete({lastUpdateTime:snap.updateTime})}
  documents.clear()
  for(const {file,generation} of objects.values())await file.delete({ifGenerationMatch:generation})
  objects.clear()
})
after(async()=>{if(app)await deleteApp(app)})

test('former-owner story descendants hold while current-owner dog and media remain intact',async()=>{
  const s=await seed(),path=await media(`documents/${s.uid}/${s.dog}/story.pdf`)
  await put(`dogs/${s.dog}`,{tenantId:s.uid,currentOwnerId:s.other,name:'Synthetic inherited dog',status:'active'})
  await put(`puppyProfiles/${s.dog}`,{dogId:s.dog,sharingEnabled:true})
  const update=`puppyProfiles/${s.dog}/updates/update-${s.nonce}`,item=`puppyProfiles/${s.dog}/media/media-${s.nonce}`
  await put(update,{authorUid:s.uid,sourceDogId:s.dog,audience:'buyer',text:'Synthetic former owner story',media:[{id:`media-${s.nonce}`,path,kind:'photo'}]})
  await put(item,{authorUid:s.uid,sourceDogId:s.dog,path,kind:'photo'})
  const inventory=await buildDeletionInventory({db,uid:s.uid}),scan=await scanDeletionDocuments(db),plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  assert.equal(inventory.readyForDeletion,false);assert.ok(inventory.unknownCollections.includes('puppyProfiles'))
  assert.ok(scan.records.some(r=>r.path===update));assert.ok(scan.records.some(r=>r.path===item))
  assert.ok(plan.holds.includes('unclassified_record_review'))
  assert.equal(plan.operations.some(o=>[update,item,path].includes(o.path)),false)
  assert.equal(plan.operations.some(o=>o.kind==='delete'&&o.path===`dogs/${s.dog}`),false)
  assert.ok(plan.retained.some(r=>r.path===`dogs/${s.dog}`&&r.category==='current_owner_history'))
  await workerHeld()
  await unchanged()
})

test('owned-dog deletion cannot classify cross-dog descendant references as exclusive media',async()=>{
  const s=await seed(),path=await media(`documents/${s.uid}/${s.dog}/shared-story.pdf`)
  await put(`dogs/${s.dog}`,{tenantId:s.uid,currentOwnerId:s.uid,name:'Synthetic departing dog',status:'active'})
  await put(`dogs/${s.second}`,{tenantId:s.other,currentOwnerId:s.other,name:'Synthetic surviving dog',status:'active'})
  const own=`puppyProfiles/${s.dog}/updates/group-${s.nonce}`,surviving=`puppyProfiles/${s.second}/updates/group-${s.nonce}`
  for(const ref of [own,surviving])await put(ref,{authorUid:s.uid,sourceDogId:s.dog,audience:'buyer',media:[{id:`shared-${s.nonce}`,path,kind:'photo'}]})
  const scan=await scanDeletionDocuments(db),plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  assert.ok(scan.records.some(r=>r.path===surviving),'Scanner must discover subcollections under absent profile parent')
  assert.ok(plan.holds.includes('unclassified_record_review'))
  assert.equal(plan.operations.some(o=>[path,own,surviving].includes(o.path)),false,'Shared unknown descendants cannot authorize exclusive object deletion')
  assert.equal(plan.operations.some(o=>o.path===`dogs/${s.second}`),false)
  await workerHeld()
  await unchanged()
})

test('owner-scoped buyer contact is discovered while retention and worker holds remain',async()=>{
  const s=await seed(),contact=`buyerContacts/contact-${s.nonce}`,foreign=`buyerContacts/foreign-${s.nonce}`
  await put(contact,{ownerUid:s.uid,name:'Synthetic buyer',email:`buyer-${s.nonce}@example.invalid`,status:'enquiry'})
  await put(foreign,{ownerUid:s.other,name:'Other owner buyer',email:`foreign-${s.nonce}@example.invalid`,status:'enquiry'})
  const inventory=await buildDeletionInventory({db,uid:s.uid}),scan=await scanDeletionDocuments(db),plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  assert.equal(inventory.records.find(r=>r.path===contact)?.disposition,'review_buyer_contact_retention')
  assert.equal(inventory.records.some(r=>r.path===foreign),false,'A different owner is not admitted by the restored query')
  assert.equal(JSON.stringify(inventory).includes(`buyer-${s.nonce}@example.invalid`),false,'Manifest does not expose buyer contact contents')
  assert.ok(inventory.unknownCollections.includes('buyerContacts'));assert.ok(inventory.holds.includes('unclassified_collections'))
  assert.equal(inventory.complete,false);assert.equal(inventory.readyForDeletion,false)
  assert.ok(scan.records.some(r=>r.path===contact));assert.ok(plan.holds.includes('unclassified_record_review'))
  assert.equal(plan.operations.some(o=>[contact,foreign].includes(o.path)),false);await workerHeld();await unchanged()
})

test('bounded buyer contact discovery reports truncation without widening owner scope',async()=>{
  const s=await seed(),paths=[`buyerContacts/contact-a-${s.nonce}`,`buyerContacts/contact-b-${s.nonce}`],foreign=`buyerContacts/contact-foreign-${s.nonce}`
  for(const path of paths)await put(path,{ownerUid:s.uid,name:'Synthetic bounded buyer'})
  await put(foreign,{ownerUid:s.other,name:'Synthetic unrelated buyer'})
  const inventory=await buildDeletionInventory({db,uid:s.uid,limit:1}),contacts=inventory.records.filter(r=>r.path.startsWith('buyerContacts/'))
  assert.equal(contacts.length,1);assert.ok(paths.includes(contacts[0].path))
  assert.ok(inventory.truncated.includes('buyerContacts:ownerUid'));assert.ok(inventory.holds.includes('query_truncated'))
  assert.ok(inventory.unknownCollections.includes('buyerContacts'));assert.equal(inventory.readyForDeletion,false)
  assert.equal(contacts[0].disposition,'review_buyer_contact_retention');await unchanged()
})

test('buyer retention review is not replaced by an associated dog disposition',async()=>{
  const s=await seed(),contact=`buyerContacts/linked-${s.nonce}`
  await put(`dogs/${s.dog}`,{tenantId:s.uid,currentOwnerId:s.uid,name:'Synthetic owned buyer dog'})
  await put(contact,{ownerUid:s.uid,dogId:s.dog,name:'Synthetic linked buyer'})
  const inventory=await buildDeletionInventory({db,uid:s.uid}),plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  assert.equal(inventory.records.find(r=>r.path===contact)?.disposition,'review_buyer_contact_retention')
  assert.ok(inventory.unknownCollections.includes('buyerContacts'));assert.ok(plan.holds.includes('unclassified_record_review'))
  assert.equal(plan.operations.some(o=>o.path===contact),false);await workerHeld();await unchanged()
})

test('UID-only orphan follower ancestor forces quarantine without authorizing cleanup',async()=>{
  const s=await seed(),follow=`puppyFollowers/${s.uid}/dogs/${s.second}`
  // Production follow records need not repeat actor UID or dogId in their data.
  // The identity is carried by the ancestor path, unlike current related(data).
  await put(follow,{followedAt:new Date().toISOString()})
  const scan=await scanDeletionDocuments(db),inventory=await buildDeletionInventory({db,uid:s.uid}),plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  assert.ok(scan.records.some(r=>r.path===follow))
  assert.equal(plan.operations.some(o=>o.path===follow),false)
  assert.ok(plan.holds.includes('unclassified_record_review'),'Exact ancestor UID must quarantine unsupported descendants without payload identity')
  assert.equal(inventory.readyForDeletion,false,'Read-only inventory never authorizes execution despite this gap')
  await workerHeld();await unchanged()
})

test('other account follower ancestor with UID prefix collision is not treated as departing actor',async()=>{
  const s=await seed(),follow=`puppyFollowers/${s.uid}-collision/dogs/${s.second}`
  await put(follow,{followedAt:new Date().toISOString()})
  const scan=await scanDeletionDocuments(db),plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  assert.ok(scan.records.some(r=>r.path===follow))
  assert.equal(plan.operations.some(o=>o.path===follow),false)
  assert.equal(plan.holds.includes('unclassified_record_review'),false,'Prefix similarity is not an exact ancestor actor match')
  await unchanged()
})

test('same-ID follower dog cannot replace an owned root dog authority',async()=>{
  const s=await seed(),root=`dogs/${s.dog}`,follow=`puppyFollowers/${s.other}/dogs/${s.dog}`
  await put(root,{tenantId:s.uid,currentOwnerId:s.uid,name:'Synthetic owned root'})
  await put(follow,{tenantId:s.other,currentOwnerId:s.other,followedAt:new Date().toISOString()})
  const scan=await scanDeletionDocuments(db),plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  assert.ok(scan.records.findIndex(r=>r.path===follow)>scan.records.findIndex(r=>r.path===root),'Actual recursive scanner encounters the colliding nested dog after the root')
  assert.ok(plan.operations.some(o=>o.kind==='delete'&&o.path===root),'Only exact root ownership determines the root dog disposition')
  assert.equal(plan.retained.some(r=>r.path===root),false)
  assert.ok(plan.holds.includes('unclassified_record_review'))
  assert.equal(plan.operations.some(o=>o.path===follow),false)
  await workerHeld();await unchanged()
})

test('same-ID follower dog cannot authorize deletion of another current owner root dog',async()=>{
  const s=await seed(),root=`dogs/${s.dog}`,follow=`puppyFollowers/${s.other}/dogs/${s.dog}`,record=`documents/document-${s.nonce}`
  await put(root,{tenantId:s.uid,currentOwnerId:s.other,name:'Synthetic inherited root'})
  await put(follow,{tenantId:s.uid,currentOwnerId:s.uid,followedAt:new Date().toISOString()})
  await put(record,{dogId:s.dog,tenantId:s.uid,name:'Synthetic inherited record'})
  const scan=await scanDeletionDocuments(db),plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  assert.ok(scan.records.findIndex(r=>r.path===follow)>scan.records.findIndex(r=>r.path===root))
  for(const path of [root,record]){
    assert.equal(plan.operations.some(o=>o.kind==='delete'&&o.path===path),false,'Nested ownership must not override the current owner of the root or its linked record')
    assert.ok(plan.retained.some(r=>r.path===path&&r.category==='current_owner_history'))
  }
  assert.ok(plan.holds.includes('unclassified_record_review'));assert.equal(plan.operations.some(o=>o.path===follow),false)
  await workerHeld();await unchanged()
})

test('payload-free exact dog descendants quarantine without granting deletion',async()=>{
  const s=await seed(),root=`dogs/${s.dog}`
  await put(root,{tenantId:s.uid,currentOwnerId:s.uid,name:'Synthetic scoped root'})
  const paths=[`puppyProfiles/${s.dog}/updates/update-${s.nonce}`,`${root}/unknownDetails/detail-${s.nonce}`,`puppyFollowers/${s.other}/dogs/${s.dog}`]
  for(const path of paths)await put(path,{createdAt:new Date().toISOString()})
  const scan=await scanDeletionDocuments(db),plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  for(const path of paths){assert.ok(scan.records.some(r=>r.path===path));assert.equal(plan.operations.some(o=>o.path===path),false)}
  assert.ok(plan.operations.some(o=>o.kind==='delete'&&o.path===root))
  assert.ok(plan.holds.includes('unclassified_record_review'),'Path-only dog identity must remain held even without payload references')
  await workerHeld();await unchanged()
})

test('dog ID prefix collision in another account descendants is not exact scoped dog identity',async()=>{
  const s=await seed(),root=`dogs/${s.dog}`,paths=[`puppyProfiles/${s.dog}-collision/updates/update-${s.nonce}`,`puppyFollowers/${s.other}/dogs/${s.dog}-collision`]
  await put(root,{tenantId:s.uid,currentOwnerId:s.uid,name:'Synthetic scoped root'})
  for(const path of paths)await put(path,{createdAt:new Date().toISOString()})
  const plan=await buildEmulatorDeletionPlan({db,bucket,uid:s.uid})
  assert.equal(plan.holds.includes('unclassified_record_review'),false,'Only exact dog path segments scope payload-free descendants')
  for(const path of paths)assert.equal(plan.operations.some(o=>o.path===path),false)
  assert.ok(plan.operations.some(o=>o.kind==='delete'&&o.path===root));await unchanged()
})
