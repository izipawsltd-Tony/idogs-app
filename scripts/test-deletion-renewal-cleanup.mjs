import test from 'node:test'
import assert from 'node:assert/strict'
import {cleanupRenewalReceipts} from './qa/deletion-renewal-cleanup.mjs'
import {verifyRecoveryOrigin,RECOVERY} from './qa/deletion-renewal-recover.mjs'
import {digest} from '../api/_lib/deletion-plan.js'
import {deletionBillingIdentityHash} from '../api/_lib/account-deletion-policy.js'

function fixture(){
 const uid='qa-disposable',manifest={uid,disposable:true,stripeCustomerId:'cus_fixture',stripeSubscriptionId:'sub_fixture'}
 const t={uid,revision:1,policyVersion:'2026-10-21-v1',acceptedAt:'2026-10-29T00:00:00Z',cancellationMode:'period_end',scope:'verified_subscriptions_existing_at_acceptance',restartOnDeletionCancellation:false,billingIdentityHash:deletionBillingIdentityHash(manifest.stripeCustomerId),status:'verified_stopped',dispatchState:'completed',executionEnabled:false}
 const binding=digest([t.uid,t.revision,t.policyVersion,t.acceptedAt,t.cancellationMode,t.scope,t.restartOnDeletionCancellation,t.billingIdentityHash])
 t.verificationReceipt={uid,revision:1,mode:'isolated-cloud-qa',bindingHash:binding}
 const receipt={uid,revision:1,subscriptionId:'sub_fixture',mode:'isolated-cloud-qa',bindingHash:binding,inventoryHash:digest(['sub_fixture']),renewalStopped:true}
 const state={task:t,receipt,id:digest('sub_fixture'),deleted:0,collections:[{id:'receipts'}]}
 const taskRef={get:async()=>({exists:true,data:()=>structuredClone(state.task)}),listCollections:async()=>state.collections,collection:()=>({limit:()=>({get:async()=>({size:state.receipt?1:0,empty:!state.receipt,docs:state.receipt?[{id:state.id,data:()=>structuredClone(state.receipt),ref:receiptRef}]:[]})})})}
 const receiptRef={}
 const db={doc:()=>taskRef}
 const scope={uid,assertRuntime:async()=>{},db:{runTransaction:async fn=>fn({get:async ref=>ref===taskRef?taskRef.get():{exists:!!state.receipt,data:()=>structuredClone(state.receipt)},delete:ref=>{assert.equal(ref,receiptRef);state.deleted++;state.receipt=null}})}}
 return {scope,db,manifest,state}
}
test('explicit cleanup context deletes only the content-checked receipt and leaves the task',async()=>{
 const f=fixture();assert.deepEqual(await cleanupRenewalReceipts(f),{renewalReceiptCleanupVerified:true})
 assert.equal(f.state.deleted,1);assert.equal(f.state.task.uid,f.manifest.uid)
 assert.deepEqual(await cleanupRenewalReceipts(f),{renewalReceiptCleanupVerified:true})
 assert.equal(f.state.deleted,1)
})
test('missing scope, foreign receipt, changed customer or unknown subcollection stops cleanup',async()=>{
 for(const mutate of [f=>f.scope=undefined,f=>f.state.receipt.uid='other',f=>f.state.receipt.subscriptionId='sub_other',f=>f.state.task.billingIdentityHash='changed',f=>f.state.collections.push({id:'unknown'})]){
  const f=fixture();mutate(f);await assert.rejects(cleanupRenewalReceipts(f),/QA_CLEANUP_RENEWAL/);assert.equal(f.state.deleted,0)
 }
})
test('a receipt changed between inventory and transaction is never deleted',async()=>{
 const f=fixture(),original=f.scope.db.runTransaction
 f.scope.db.runTransaction=async fn=>{f.state.receipt.renewalStopped=false;return original(fn)}
 await assert.rejects(cleanupRenewalReceipts(f),/RECEIPT_CHANGED/);assert.equal(f.state.deleted,0)
})
function evidence(){return {run:{id:RECOVERY.run,head_sha:RECOVERY.sha,head_branch:'release/ios-app-store-20261025',path:'.github/workflows/deletion-cloud-permanent.yml',event:'push',status:'completed',conclusion:'failure'},job:{id:RECOVERY.job,run_id:RECOVERY.run,conclusion:'failure',steps:[{name:'Real isolated Firebase deletion and Stripe Test readback',conclusion:'failure'}]},logs:`"fixtureRunId": "${RECOVERY.fixture}"\n"durableRenewalDispatchVerified": true\n"renewalBeforeAuthRemovalVerified": true\n"cleanupVerified": false\n"step": "firebase_fixture",\n"status": "failed"`}}
test('one-time recovery accepts only the authenticated exact failed run/job/source/nonce evidence',()=>{
 verifyRecoveryOrigin(evidence())
 for(const mutate of [e=>e.run.head_sha='other',e=>e.job.run_id=1,e=>e.logs=e.logs.replace(RECOVERY.fixture,'other'),e=>e.run.conclusion='success',e=>e.logs='']){const e=evidence();mutate(e);assert.throws(()=>verifyRecoveryOrigin(e),/ORIGIN_UNVERIFIED/)}
})
