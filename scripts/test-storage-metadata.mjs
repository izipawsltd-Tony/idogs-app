import test from 'node:test'
import assert from 'node:assert/strict'
import {inspectStorageMetadata,runStorageMetadata,target} from './qa/storage-metadata.mjs'
const metadata=()=>({name:target.bucket,projectNumber:target.projectNumber,location:'ASIA-SOUTHEAST1',metageneration:'12',versioning:{enabled:true},softDeletePolicy:{retentionDurationSeconds:'604800'},retentionPolicy:{retentionPeriod:'86400',isLocked:true},acl:[{secret:'do-not-output'}],labels:{secret:'do-not-output'}})
const inspect=meta=>inspectStorageMetadata({projectId:target.projectId,bucket:{name:target.bucket,getMetadata:async()=>[meta]},env:{},clock:()=>0})
test('reports retention without exposing unrelated metadata or claiming deletion',async()=>{
 const report=await inspect(metadata())
 assert.equal(report.softDeleteRetentionSeconds,'604800');assert.equal(report.versioning,true);assert.equal(report.retentionLocked,true)
 assert.equal(report.productionDeletionVerified,false);assert.ok(!JSON.stringify(report).includes('do-not-output'))
})
test('omitted policies stay unknown rather than declaring zero retention',async()=>{
 const m=metadata();delete m.softDeletePolicy;delete m.retentionPolicy;delete m.versioning
 const r=await inspect(m);assert.equal(r.softDeleteRetentionSeconds,null);assert.equal(r.bucketRetentionSeconds,null);assert.equal(r.versioning,null)
})
test('explicit zero and disabled versioning remain distinguishable',async()=>{
 const m=metadata();m.softDeletePolicy.retentionDurationSeconds=0;m.versioning.enabled=false
 const r=await inspect(m);assert.equal(r.softDeleteRetentionSeconds,'0');assert.equal(r.versioning,false)
})
test('wrong requested project or bucket rejected before any metadata request',async()=>{
 for(const args of [{projectId:'other',name:target.bucket},{projectId:target.projectId,name:'other'}]){
  await assert.rejects(inspectStorageMetadata({projectId:args.projectId,bucket:{name:args.name,getMetadata:()=>assert.fail('unexpected call')},env:{}}),{code:'WRONG_STORAGE_TARGET'})
 }
})
test('returned project number and bucket identity must both match',async()=>{
 for(const fields of [{projectNumber:'1'},{name:'other'},{projectNumber:undefined}])await assert.rejects(inspect({...metadata(),...fields}),{code:'BUCKET_IDENTITY_MISMATCH'})
})
test('malformed or missing metadata cannot pass',async()=>{
 for(const fields of [{location:null},{metageneration:null}])await assert.rejects(inspect({...metadata(),...fields}),{code:'INCOMPLETE_METADATA'})
 for(const v of ['-1','NaN','Infinity',{},'999999999999999999999']){
  const m=metadata();m.softDeletePolicy.retentionDurationSeconds=v;await assert.rejects(inspect(m),{code:'INVALID_METADATA'})
 }
})
test('endpoint overrides rejected before constructing client',async()=>{
 for(const key of ['STORAGE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','GOOGLE_CLOUD_UNIVERSE_DOMAIN'])await assert.rejects(runStorageMetadata({env:{[key]:'override'},loadClient:()=>assert.fail('unexpected client')}),{code:'UNSUPPORTED_STORAGE_ENDPOINT'})
})
test('SDK access errors do not manufacture reports',async()=>{
 await assert.rejects(inspectStorageMetadata({projectId:target.projectId,bucket:{name:target.bucket,getMetadata:async()=>{throw Object.assign(new Error('denied'),{code:403})}},env:{}}),{code:403})
})
