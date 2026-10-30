import {test} from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import {createCloudStripeReadback} from './qa/deletion-cloud-stripe-readback.mjs'

// Synthetic CI identity for no-network contract tests; no credential lookup.
Object.assign(process.env,{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'izipawsltd-Tony/idogs-app',GITHUB_REF:'refs/heads/release/ios-app-store-20261025',GITHUB_SHA:'b'.repeat(40),GITHUB_RUN_ID:'12345'})
const runId=`deletion-qa-${'a'.repeat(32)}`,uid=`qa-${runId}`
function fixture(){
 const manifest={uid,runId,disposable:true,email:`${uid}@example.invalid`,authCreatedAt:'fixture-created-at',recordPaths:[`users/${uid}`],mediaPaths:[`documents/${uid}/proof.txt`],stripeCustomerId:'cus_FixtureOnly',stripeSubscriptionId:'sub_FixtureOnly'}
 let profile={stripeCustomerId:manifest.stripeCustomerId,deletionQaRunId:runId},job={revision:1,qaManifest:structuredClone(manifest)}
 const db={projectId:'idogs-app-staging',databaseId:'idogs-deletion-qa',collection(){},listCollections(){},runTransaction(){throw Error('NO_WRITES')},doc:path=>({get:async()=>({data:()=>path.startsWith('users/')?profile:job})})}
 const auth={app:{options:{projectId:'idogs-app-staging'}},getUser:async()=>({uid,email:manifest.email,metadata:{creationTime:manifest.authCreatedAt}})}
 const bucket={name:'idogs-app-staging-deletion-qa',getFiles(){},getMetadata:async()=>[{name:bucket.name,projectNumber:'530003937245',location:'ASIA-SOUTHEAST1',softDeletePolicy:{retentionDurationSeconds:'0'},iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'}}]}
 const args={db,auth,bucket,runId,manifest,stripeKey:['sk','test','FixtureOnly'].join('_'),executionEnabled:true}
 const metadata={deletionQaRunId:runId,firebaseUid:uid}
 const values=[{id:'acct_1TiU0IGHgBd6ZgJE'},{id:manifest.stripeCustomerId,livemode:false,metadata},{id:manifest.stripeSubscriptionId,customer:manifest.stripeCustomerId,livemode:false,metadata}]
 return {args,values,job,profile}
}
function transport(t,respond){
 const calls=[]
 t.mock.method(Stripe,'createNodeHttpClient',()=>({makeRequest:async(...args)=>{
  calls.push(args);const value=await respond(args,calls.length)
  return {getRawResponse:()=>({}),getStatusCode:()=>200,getHeaders:()=>({'request-id':`req_fixture${calls.length}`}),toJSON:async()=>value}
 }}))
 return calls
}
test('default disabled, live context and wrong runtime are rejected before provider IO',async t=>{
 const calls=transport(t,()=>assert.fail('no provider IO'))
 for(const change of [a=>a.executionEnabled=false,a=>a.stripeKey='not-a-test-context',a=>a.db.databaseId='(default)',a=>a.bucket.name='idogs-app-staging-retention-qa',a=>a.manifest.stripeSubscriptionId='sub_foreign/path']){
  const f=fixture();change(f.args);await assert.rejects(createCloudStripeReadback(f.args))
 }
 assert.equal(calls.length,0)
})
test('actual SDK serializes only three exact GETs and returns no client, key or provider payload',async t=>{
 const f=fixture(),calls=transport(t,(_,n)=>f.values[n-1])
 const reader=await createCloudStripeReadback(f.args),result=await reader.read()
 assert.deepEqual(Object.keys(reader),['mode','read'])
 assert.equal(result.httpAttempts,3);assert.equal(result.realTestBindingVerified,true);assert.equal(result.signedWebhookVerified,false);assert.equal(result.productionReady,false)
 assert.deepEqual(calls.map(a=>[a[0],Number(a[1]),a[2],a[3],a[6]]),['/v1/account','/v1/customers/cus_FixtureOnly','/v1/subscriptions/sub_FixtureOnly'].map(p=>['api.stripe.com',443,p,'GET','https']))
 assert.ok(!JSON.stringify(result).includes(f.args.stripeKey));assert.ok(!JSON.stringify(result).includes('firebaseUid'))
 await assert.rejects(reader.read(),/ALREADY_STARTED/);assert.equal(calls.length,3)
})
test('wrong account cannot trigger customer or subscription reads',async t=>{
 const f=fixture(),calls=transport(t,()=>({id:'acct_foreign'})),reader=await createCloudStripeReadback(f.args)
 await assert.rejects(reader.read(),/ACCOUNT_CHANGED/);assert.equal(calls.length,1)
})
test('provider mode/customer/UID/run substitution fails closed at the exact response',async t=>{
 for(const [index,change] of [[1,v=>v.livemode=true],[1,v=>v.deleted=true],[2,v=>v.customer='cus_foreign'],[2,v=>v.metadata={...v.metadata,firebaseUid:'foreign'}],[2,v=>v.metadata={...v.metadata,deletionQaRunId:'foreign'}]]){
  const f=fixture();change(f.values[index]);const calls=transport(t,(_,n)=>f.values[n-1])
  try{await assert.rejects((await createCloudStripeReadback(f.args)).read(),/CHANGED/);assert.equal(calls.length,index+1)}finally{t.mock.restoreAll()}
 }
})
test('profile, input manifest, durable revision and Auth replacement are rechecked before next wire',async t=>{
 for(const change of [f=>f.profile.stripeCustomerId='cus_foreign',f=>f.args.manifest.stripeSubscriptionId='sub_foreign',f=>f.job.revision=2,f=>f.args.auth.getUser=async()=>({uid,email:f.args.manifest.email,metadata:{creationTime:'replacement'}})]){
  const f=fixture(),calls=transport(t,(_,n)=>{if(n===1)change(f);return f.values[n-1]})
  try{const reader=await createCloudStripeReadback(f.args);await assert.rejects(reader.read());assert.equal(calls.length,1)}finally{t.mock.restoreAll()}
 }
})
test('ECONNRESET and EPIPE have one actual SDK transport attempt and no same-reader restart',async t=>{
 for(const code of ['ECONNRESET','EPIPE']){
  const f=fixture(),calls=transport(t,()=>{throw Object.assign(Error('fixture drop'),{code})})
  try{const reader=await createCloudStripeReadback(f.args);await assert.rejects(reader.read());await assert.rejects(reader.read(),/ALREADY_STARTED/);assert.equal(calls.length,1)}finally{t.mock.restoreAll()}
 }
})


test('CI repository/ref/source drift and expired actor fail before the first wire',async t=>{
 const calls=transport(t,()=>assert.fail('no network'))
 for(const [key,value] of [['GITHUB_ACTIONS','false'],['GITHUB_REPOSITORY','foreign/repo'],['GITHUB_REF','refs/heads/main'],['GITHUB_SHA','not-a-source']]){
  const old=process.env[key];process.env[key]=value
  try{await assert.rejects(createCloudStripeReadback(fixture().args),/CI_CONTEXT_REQUIRED/)}finally{process.env[key]=old}
 }
 const f=fixture(),reader=await createCloudStripeReadback(f.args)
 f.job.authRemovalAttempted=true;await assert.rejects(reader.read(),/JOB_CHANGED/)
 assert.equal(calls.length,0)
})
test('SDK wrappers preserve guard classification and expose only fixed diagnostic fields',async t=>{
 const f=fixture(),calls=transport(t,()=>{throw Object.assign(Error('private response must not escape'),{code:'ECONNRESET'})})
 const reader=await createCloudStripeReadback(f.args)
 await assert.rejects(reader.read(),e=>{
  assert.equal(e.code,'STRIPE_READBACK_OUTCOME_UNKNOWN')
  assert.equal(e.readbackDiagnostic.step,'account');assert.equal(e.readbackDiagnostic.httpAttempts,1);assert.equal(e.readbackDiagnostic.errorType,'StripeConnectionError');assert.equal(e.readbackDiagnostic.errorName,'Error');assert.ok(e.readbackDiagnostic.sourceLocation===null||/^deletion-cloud-stripe-readback[.]mjs:[0-9]+:[0-9]+$/.test(e.readbackDiagnostic.sourceLocation))
  assert.equal(JSON.stringify(e.readbackDiagnostic).includes('private response'),false)
  return true
 })
 assert.equal(calls.length,1)
})
