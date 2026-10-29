import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cloudFixtureScope,createCloudFixtureProcessor,createCloudFixtureRenewalDispatcher} from './qa/deletion-cloud-runtime.mjs'
import {digest} from '../api/_lib/deletion-plan.js'

const runId=`deletion-qa-${'a'.repeat(32)}`,uid=`qa-${runId}`
function fixture(){
 let writes=0,deletes=0
 const manifest={uid,runId,disposable:true,email:`${uid}@example.invalid`,authCreatedAt:'fixture-created-at',recordPaths:[`users/${uid}`,`dogs/${runId}-dog`],mediaPaths:[`documents/${uid}/proof.txt`]}
 const db={projectId:'idogs-app-staging',databaseId:'idogs-deletion-qa',collection(){},listCollections(){},doc:path=>({path,firestore:db,get:async()=>({data:()=>({qaManifest:manifest})})}),runTransaction:async fn=>fn({set(){writes++},get:async()=>({})})}
 const auth={app:{options:{projectId:'idogs-app-staging'}},getUser:async()=>({uid,email:manifest.email,metadata:{creationTime:manifest.authCreatedAt}}),deleteUser:async()=>{deletes++}}
 const bucket={name:'idogs-app-staging-deletion-qa',getFiles(){},file:path=>({name:path}),getMetadata:async()=>[{name:'idogs-app-staging-deletion-qa',projectNumber:'530003937245',location:'ASIA-SOUTHEAST1',softDeletePolicy:{retentionDurationSeconds:'0'},iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'}}]}
 const args={db,auth,bucket,manifest,runId,env:{}}
 return {args,manifest,db,auth,bucket,counts:()=>({writes,deletes})}
}
test('wrong project/default database/bucket/endpoint/manifest rejected before SDK calls',()=>{
 for(const mutate of [f=>f.db.projectId='idogs-app',f=>f.db.databaseId='(default)',f=>f.bucket.name='idogs-app-staging.firebasestorage.app',f=>f.args.env.FIRESTORE_EMULATOR_HOST='localhost:8080',f=>f.manifest.recordPaths.push('users/real-user'),f=>f.manifest.mediaPaths.push('documents/real-user/x')]){
  const f=fixture();mutate(f);assert.throws(()=>cloudFixtureScope(f.args));assert.deepEqual(f.counts(),{writes:0,deletes:0})
 }
})
test('transaction rejects foreign ref, mismatched database instance and foreign UID even after construction',async()=>{
 const f=fixture(),s=cloudFixtureScope(f.args)
 await assert.rejects(s.db.runTransaction(tx=>tx.set(f.db.doc('users/real-user'),{})),/FOREIGN_WRITE/)
 await assert.rejects(s.db.runTransaction(tx=>tx.set({path:`users/${uid}`,firestore:{}},{})),/FOREIGN_WRITE/)
 await assert.rejects(s.auth.deleteUser('real-user'),/FOREIGN_AUTH/)
 assert.throws(()=>s.bucket.file('documents/real-user/photo.jpg'),/FOREIGN_MEDIA/)
 assert.deepEqual(f.counts(),{writes:0,deletes:0})
 await s.db.runTransaction(tx=>tx.set(f.db.doc(`users/${uid}`),{}));assert.equal(f.counts().writes,1)
 f.db.databaseId='(default)';await assert.rejects(s.db.runTransaction(tx=>tx.set(f.db.doc(`users/${uid}`),{})),/TARGET/)
})
test('Auth replacement and manifest changes block destructive calls',async()=>{
 const f=fixture(),s=cloudFixtureScope(f.args)
 await s.assertRuntime(uid)
 f.auth.getUser=async()=>({uid,email:f.manifest.email,metadata:{creationTime:'recreated'}})
 await assert.rejects(s.auth.deleteUser(uid),/AUTH_BINDING_CHANGED/);assert.equal(f.counts().deletes,0)
 f.db.doc=()=>({get:async()=>({data:()=>({qaManifest:{...f.manifest,disposable:false}})})})
 await assert.rejects(s.assertRuntime(uid),/DURABLE_BINDING_CHANGED/)
})
test('isolated cloud wrapper rejects synthetic/live provider and explicit mismatch UID',async()=>{
 const f=fixture(),scope=cloudFixtureScope(f.args)
 for(const mode of ['synthetic','live','stripe-contract-unwired'])assert.throws(()=>createCloudFixtureProcessor({scope,provider:{mode}}),/PROVIDER_REQUIRED/)
 for(const mode of ['synthetic','live','stripe-contract-unwired'])assert.throws(()=>createCloudFixtureRenewalDispatcher({scope,provider:{mode}}),/PROVIDER_REQUIRED/)
 await assert.rejects(scope.assertRuntime('real-user'),/FOREIGN_UID/)
 assert.equal(digest(f.manifest),digest({...f.manifest}))
})

test('renewal receipt writes are restricted to this manifest account and bounded receipt IDs',async()=>{
 const f=fixture(),scope=cloudFixtureScope(f.args),receipt='a'.repeat(64)
 await scope.db.runTransaction(tx=>tx.set(f.db.doc(`accountDeletionRenewalTasks/${uid}_1/receipts/${receipt}`),{}))
 assert.equal(f.counts().writes,1)
 for(const path of [`accountDeletionRenewalTasks/real-user_1/receipts/${receipt}`,`accountDeletionRenewalTasks/${uid}_2/receipts/${receipt}`,`accountDeletionRenewalTasks/${uid}_1/receipts/not-a-hash`,`accountDeletionRenewalTasks/${uid}_1/other/${receipt}`])await assert.rejects(scope.db.runTransaction(tx=>tx.set(f.db.doc(path),{})),/FOREIGN_WRITE/)
 assert.equal(f.counts().writes,1)
})
test('seven-day runtime permits only its fixed private bucket and an explicit durable retention manifest',async()=>{
 const f=fixture();f.args.retentionMode='seven-day';f.bucket.name='idogs-app-staging-retention-qa'
 assert.throws(()=>cloudFixtureScope(f.args),/RETENTION_MANIFEST/)
 f.manifest.storageMode='seven-day';f.manifest.bucket=f.bucket.name
 f.bucket.getMetadata=async()=>[{name:f.bucket.name,projectNumber:'530003937245',location:'ASIA-SOUTHEAST1',softDeletePolicy:{retentionDurationSeconds:'604800'},versioning:{enabled:false},iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'}}]
 await cloudFixtureScope(f.args).assertRuntime(uid)
 assert.throws(()=>cloudFixtureScope({...f.args,retentionMode:'zero'}),/TARGET/)
 assert.throws(()=>cloudFixtureScope({...f.args,retentionMode:'production'}),/TARGET/)
 f.bucket.getMetadata=async()=>[{name:f.bucket.name}]
 await assert.rejects(cloudFixtureScope(f.args).assertRuntime(uid),/BUCKET_MISMATCH/)
})
