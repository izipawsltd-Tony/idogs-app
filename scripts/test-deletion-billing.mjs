import {test} from 'node:test'
import assert from 'node:assert/strict'
import {stopVerifiedDeletionRenewals,recordDeletionBillingAcceptance} from '../api/_lib/deletion-billing.js'
const uid='synthetic-owner',revision=3
function fixture(overrides={}){
  const calls=[]
  return {calls,provider:{discover:async()=>({uid,complete:true,subscriptions:[{id:'sub-one',ownerUid:uid}]}),stopRenewal:async(id,options)=>calls.push({id,...options}),verify:async id=>({id,ownerUid:uid,renewalStopped:true}),...overrides}}
}
test('stable cancellation key and readback; duplicate subscription ids never duplicate a call',async()=>{
  const {provider,calls}=fixture({discover:async()=>({uid,complete:true,subscriptions:[{id:'sub-one',ownerUid:uid},{id:'sub-one',ownerUid:uid}]})})
  assert.equal((await stopVerifiedDeletionRenewals({uid,revision,provider})).renewalStatus,'verified_stopped')
  assert.deepEqual(calls,[{id:'sub-one',uid,idempotencyKey:'deletion/synthetic-owner/3/sub-one'}])
})
test('complete empty provider inventory is required before claiming no subscription',async()=>{
  const {provider}=fixture({discover:async()=>({uid,complete:true,subscriptions:[]})})
  assert.equal((await stopVerifiedDeletionRenewals({uid,revision,provider})).renewalStatus,'verified_no_subscription')
})
for(const [name,discovery] of Object.entries({incomplete:{uid,complete:false,subscriptions:[]},wrongOwner:{uid,complete:true,subscriptions:[{id:'sub-one',ownerUid:'someone-else'}]},wrongAccount:{uid:'someone-else',complete:true,subscriptions:[]},invalidId:{uid,complete:true,subscriptions:[{id:'sub/one',ownerUid:uid}]},tooMany:{uid,complete:true,subscriptions:Array.from({length:201},()=>({id:'sub-one',ownerUid:uid}))}}))test(`discovery ${name} fails before mutation`,async()=>{
  const {provider,calls}=fixture({discover:async()=>discovery})
  await assert.rejects(stopVerifiedDeletionRenewals({uid,revision,provider}),/BILLING_DISCOVERY_UNCONFIRMED/);assert.equal(calls.length,0)
})
for(const [name,result] of Object.entries({unconfirmed:{id:'sub-one',ownerUid:uid,renewalStopped:false},wrongOwner:{id:'sub-one',ownerUid:'other',renewalStopped:true},wrongResource:{id:'sub-other',ownerUid:uid,renewalStopped:true}}))test(`provider readback ${name} is not success`,async()=>{
  const {provider}=fixture({verify:async()=>result})
  await assert.rejects(stopVerifiedDeletionRenewals({uid,revision,provider}),/BILLING_STOP_UNCONFIRMED/)
})
test('provider timeout cannot be converted to a verified stop',async()=>{
  const {provider}=fixture({stopRenewal:async()=>{throw Error('simulated timeout')}})
  await assert.rejects(stopVerifiedDeletionRenewals({uid,revision,provider}),/simulated timeout/)
})
test('billing acceptance requires the execution guard before accessing any service',async()=>{
  await assert.rejects(recordDeletionBillingAcceptance({uid,revision}),/BILLING_RUNTIME_GUARD_REQUIRED/)
  await assert.rejects(recordDeletionBillingAcceptance({uid,revision,assertRuntime:()=>{throw Error('blocked cloud target')}}),/blocked cloud target/)
})
