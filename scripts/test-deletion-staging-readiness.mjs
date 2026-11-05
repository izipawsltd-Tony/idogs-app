import test from 'node:test'
import assert from 'node:assert/strict'
import {checkStagingDeletionReadiness,STAGING_DELETION_TARGET as target} from './qa/deletion-staging-readiness.mjs'
const env=()=>({IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:target.projectId,client_email:`synthetic@${target.projectId}.iam.gserviceaccount.com`,private_key:'-----BEGIN PRIVATE KEY----- synthetic fixture'}),IDOGS_DELETION_STRIPE_TEST_KEY:'rk_test_SyntheticOnly'})
const clients=()=>({projectId:target.projectId,bucket:{name:target.bucket,getMetadata:async()=>[{name:target.bucket,location:'ASIA-SOUTHEAST1'}]},stripe:{accounts:{retrieve:async()=>({id:target.stripeAccount})},subscriptions:{list:async()=>({data:[{livemode:false}]})}},firestoreProbe:async()=>{},authProbe:async()=>{}})
test('missing credentials produce explicit gate before SDK initialization',async()=>{
 const r=await checkStagingDeletionReadiness({env:{},loadClients:()=>assert.fail('unexpected client')})
 assert.equal(r.code,'STAGING_CREDENTIALS_MISSING');assert.equal(r.missing.length,2)
})
test('production credential and live Stripe key are rejected before IO',async()=>{
 for(const patch of [{IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'idogs-app'})},{IDOGS_DELETION_STRIPE_TEST_KEY:'rk_live_SyntheticOnly'}])await assert.rejects(checkStagingDeletionReadiness({env:{...env(),...patch},loadClients:()=>assert.fail('unexpected client')}))
})
test('successful metadata inspection never claims deletion or renewal write QA',async()=>{
 const r=await checkStagingDeletionReadiness({env:env(),loadClients:async()=>clients()})
 assert.equal(r.status,'read_access_verified');assert.equal(r.permanentDeletionReady,false);assert.equal(r.renewalWriteVerified,false)
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE KEY|rk_test_|synthetic@/)
})
test('wrong SDK project, bucket, Stripe account and live response fail closed',async()=>{
 const variants=[c=>{c.projectId='idogs-app'},c=>{c.bucket.name='other'},c=>{c.stripe.accounts.retrieve=async()=>({id:'acct_other'})},c=>{c.stripe.subscriptions.list=async()=>({data:[{livemode:true}]})}]
 for(const mutate of variants){const c=clients();mutate(c);await assert.rejects(checkStagingDeletionReadiness({env:env(),loadClients:async()=>c}))}
})
test('endpoint overrides are rejected and permission errors never produce success',async()=>{
 await assert.rejects(checkStagingDeletionReadiness({env:{...env(),STORAGE_EMULATOR_HOST:'localhost:9199'},loadClients:()=>assert.fail('unexpected client')}),{code:'STAGING_ENDPOINT_OVERRIDE'})
 const c=clients();c.firestoreProbe=async()=>{throw new Error('permission denied')}
 await assert.rejects(checkStagingDeletionReadiness({env:env(),loadClients:async()=>c}))
})
