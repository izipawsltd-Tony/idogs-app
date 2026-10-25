import test from 'node:test'
import assert from 'node:assert/strict'
import {provisionQaResources,provisioningCredential,QA_RESOURCES as q,QA_DENY_RULES,verifyQaBucket,verifyQaDatabase} from './qa/provision-deletion-resources.mjs'
const env=()=>({IDOGS_QA_RESOURCE_APPROVAL:'2026-10-25-isolated-deletion-qa',IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:q.projectId,client_email:`synthetic@${q.projectId}.iam.gserviceaccount.com`,private_key:'-----BEGIN PRIVATE KEY----- fixture'})})
function fixture(){
 const state={writes:[],db:null,bucket:null,release:null}
 const database={name:`projects/${q.projectId}/databases/${q.databaseId}`,locationId:q.location,type:'FIRESTORE_NATIVE',databaseEdition:'STANDARD',deleteProtectionState:'DELETE_PROTECTION_ENABLED'}
 const oldDb={...database,name:`projects/${q.projectId}/databases/(default)`,uid:'default-synthetic'}
 const oldBucket={name:`${q.projectId}.firebasestorage.app`,projectNumber:q.projectNumber,metageneration:'1',softDeletePolicy:{retentionDurationSeconds:'604800'}}
 const storage={bucket:name=>({getMetadata:async()=>{if(name===oldBucket.name)return[oldBucket];if(state.bucket)return[state.bucket];throw Object.assign(new Error('missing'),{code:404})}}),createBucket:async(name,metadata)=>{state.writes.push({kind:'bucket',name,metadata});state.bucket={...metadata,name,projectNumber:q.projectNumber}}}
 const api=async(url,opts={})=>{
  if(opts.method){state.writes.push({kind:'api',url,...opts})
   if(url.endsWith(':testIamPermissions'))return{permissions:opts.body.permissions}
   if(url.includes('/databases?')){state.db=database;return{name:`${database.name}/operations/synthetic`}}
   if(url.endsWith(':test'))return{testResults:opts.body.testSuite.testCases.map(()=>({state:'SUCCESS'}))}
   if(url.endsWith('/rulesets'))return{name:`projects/${q.projectId}/rulesets/synthetic`}
   if(url.endsWith('/releases')){state.release=opts.body;return state.release}
   throw new Error('unexpected mutation')
  }
  if(url.endsWith('/databases/(default)'))return oldDb
  if(url.endsWith('/releases/cloud.firestore'))return{rulesetName:'unchanged-default'}
  if(url.endsWith(`/databases/${q.databaseId}`))return state.db
  if(url.endsWith('/operations/synthetic'))return{done:true}
  if(url.endsWith(`/releases/cloud.firestore/${q.databaseId}`))return state.release
  if(url.endsWith('/rulesets/synthetic'))return{source:{files:[{content:QA_DENY_RULES}]}}
  throw new Error('unexpected read')
 }
 return {state,loadClients:async()=>({api,storage,wait:async()=>{}}),database}
}
test('exact approved isolated resources are created and read back without mutation of defaults',async()=>{
 const f=fixture();const result=await provisionQaResources({env:env(),loadClients:f.loadClients})
 assert.equal(result.status,'qa_resources_verified');assert.equal(result.defaultResourcesUnchanged,true);assert.equal(result.permanentDeletionQaPassed,false)
 assert.equal(f.state.writes.filter(x=>x.kind==='bucket').length,1)
 assert.ok(f.state.writes.every(x=>!x.url?.includes('/databases/(default)')&&!x.url?.endsWith('/releases/cloud.firestore')))
 assert.equal(f.state.bucket.iamConfiguration.publicAccessPrevention,'enforced');assert.equal(f.state.bucket.softDeletePolicy.retentionDurationSeconds,'0')
})
test('approval, project identity and endpoints are checked before any client initialization',async()=>{
 for(const change of [{IDOGS_QA_RESOURCE_APPROVAL:''},{STORAGE_EMULATOR_HOST:'localhost:9199'},{IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'idogs-app'})}])await assert.rejects(provisionQaResources({env:{...env(),...change},loadClients:()=>assert.fail('unexpected SDK')}))
})
test('unknown/existing unsafe bucket settings are rejected rather than silently patched',()=>{
 const m={name:q.bucket,projectNumber:q.projectNumber,location:'ASIA-SOUTHEAST1',softDeletePolicy:{retentionDurationSeconds:'0'},versioning:{enabled:false},iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'}}
 verifyQaBucket(m)
 for(const change of [{projectNumber:'404409556051'},{name:'idogs-app.firebasestorage.app'},{softDeletePolicy:{retentionDurationSeconds:'604800'}},{retentionPolicy:{retentionPeriod:'1'}},{iamConfiguration:{}}])assert.throws(()=>verifyQaBucket({...m,...change}))
})
test('wrong database mode, edition, name or deletion protection is rejected',()=>{
 const f=fixture();verifyQaDatabase(f.database)
 for(const patch of [{databaseEdition:'ENTERPRISE'},{type:'DATASTORE_MODE'},{name:'projects/idogs-app/databases/(default)'},{deleteProtectionState:'DELETE_PROTECTION_DISABLED'}])assert.throws(()=>verifyQaDatabase({...f.database,...patch}))
})
test('API permission failure stops provisioning without trying another project',async()=>{
 const f=fixture();f.loadClients=async()=>({storage:{bucket:()=>({getMetadata:async()=>{throw Object.assign(new Error('denied'),{code:403})}})}})
 await assert.rejects(provisionQaResources({env:env(),loadClients:f.loadClients}));assert.equal(f.state.writes.length,0)
})
test('all missing provisioning permissions are reported before resource creation',async()=>{
 const f=fixture(),load=f.loadClients;const report={}
 await assert.rejects(provisionQaResources({env:env(),report,loadClients:async c=>{
  const clients=await load(c),api=clients.api
  clients.api=(url,opts)=>url.endsWith(':testIamPermissions')?Promise.resolve({permissions:['datastore.databases.get']}):api(url,opts)
  return clients
 }}),/QA_PROVISIONING_PERMISSIONS_MISSING/)
 assert.ok(report.missingPermissions.includes('datastore.databases.create'));assert.ok(report.missingPermissions.includes('storage.buckets.create'))
 assert.equal(f.state.db,null);assert.equal(f.state.bucket,null)
})
