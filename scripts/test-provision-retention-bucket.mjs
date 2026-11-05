import {test} from 'node:test'
import assert from 'node:assert/strict'
import {provisionRetentionBucket,verifyRetentionBucket} from './qa/provision-retention-bucket.mjs'
const env={IDOGS_RETENTION_QA_APPROVAL:'2026-10-26-new-seven-day-qa-bucket',IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:'idogs-app-staging',client_email:'qa@idogs-app-staging.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----fixture'})}
function fixture(){
 const base={projectNumber:'530003937245',location:'ASIA-SOUTHEAST1',metageneration:'1',versioning:{enabled:false},iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'}}
 const metadata=new Map([['idogs-app-staging-deletion-qa',{...base,name:'idogs-app-staging-deletion-qa',softDeletePolicy:{retentionDurationSeconds:'0'}}],['idogs-app-staging.firebasestorage.app',{...base,name:'idogs-app-staging.firebasestorage.app',softDeletePolicy:{retentionDurationSeconds:'604800'}}]])
 const created=[]
 const storage={projectId:'idogs-app-staging',bucket:name=>({getMetadata:async()=>{if(!metadata.has(name))throw Object.assign(Error(),{code:404});return [metadata.get(name)]}}),createBucket:async(name,options)=>{created.push({name,options});metadata.set(name,{...base,...options,location:'ASIA-SOUTHEAST1',name})}}
 return {storage,metadata,created,loadStorage:async()=>storage}
}
test('owner approval and staging identity are required before SDK initialization',async()=>{
 for(const patch of [{IDOGS_RETENTION_QA_APPROVAL:''},{IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON:'{}'},{STORAGE_EMULATOR_HOST:'localhost:9199'}]){let loaded=false;await assert.rejects(provisionRetentionBucket({env:{...env,...patch},loadStorage:async()=>{loaded=true}}));assert.equal(loaded,false)}
})
test('creates only the new seven-day bucket and never changes existing bucket policy',async()=>{
 const f=fixture(),report=await provisionRetentionBucket({env,...f})
 assert.equal(report.status,'retention_qa_bucket_verified');assert.equal(report.actualSevenDayLifecyclePassed,false)
 assert.equal(f.created.length,1);assert.equal(f.created[0].name,'idogs-app-staging-retention-qa');assert.equal(f.created[0].options.softDeletePolicy.retentionDurationSeconds,604800)
 assert.equal(f.metadata.get('idogs-app-staging-deletion-qa').softDeletePolicy.retentionDurationSeconds,'0')
})
test('an existing mismatched target is refused, never patched or replaced',async()=>{
 const f=fixture();f.metadata.set('idogs-app-staging-retention-qa',{name:'idogs-app-staging-retention-qa',softDeletePolicy:{retentionDurationSeconds:'0'}})
 await assert.rejects(provisionRetentionBucket({env,...f}),/BUCKET_MISMATCH/);assert.equal(f.created.length,0)
})
test('unknown or zero soft-delete evidence cannot pass as seven-day recovery',()=>{
 for(const policy of [undefined,{retentionDurationSeconds:'0'},{retentionDurationSeconds:'604800'}])assert.throws(()=>verifyRetentionBucket({name:'idogs-app-staging-retention-qa',softDeletePolicy:policy}))
})
