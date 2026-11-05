import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createStripeDeletionRenewalContract} from '../api/_lib/deletion-stripe-contract.js'
import {stopVerifiedDeletionRenewals} from '../api/_lib/deletion-billing.js'
const uid='synthetic-owner',page=data=>({data,has_more:false})
function fixture(){
  const state={updates:[],subs:[{id:'sub_one',customer:'cus_one',livemode:false,status:'trialing',cancel_at_period_end:false,schedule:null}],ownership:{customerId:'cus_one',ownerUids:[uid],knownSubscriptionIds:['sub_one']},schedules:[],sessions:[],account:'acct_synthetic',guards:0}
  const stripe={accounts:{retrieve:async()=>({id:state.account})},customers:{retrieve:async()=>({id:'cus_one',livemode:false})},subscriptions:{list:async()=>page(state.subs),retrieve:async id=>state.subs.find(s=>s.id===id),update:async(id,params,options)=>{state.updates.push({id,params,options});Object.assign(state.subs.find(s=>s.id===id),params)}},subscriptionSchedules:{list:async()=>page(state.schedules)},checkout:{sessions:{list:async()=>page(state.sessions)}}}
  const adapter=createStripeDeletionRenewalContract({stripe,loadOwnership:async()=>state.ownership,assertRuntime:()=>{state.guards++},expectedAccountId:'acct_synthetic',expectedLivemode:false})
  return {state,stripe,adapter}
}
test('mock Stripe trial renewal uses stable key, customer ownership and readback; retry sends no reversal',async()=>{
  const {state,adapter}=fixture()
  assert.equal(adapter.mode,'stripe-contract-unwired')
  for(let i=0;i<2;i++)assert.equal((await stopVerifiedDeletionRenewals({uid,revision:1,provider:adapter})).renewalStatus,'verified_stopped')
  assert.deepEqual(state.updates,[{id:'sub_one',params:{cancel_at_period_end:true},options:{idempotencyKey:'deletion/synthetic-owner/1/sub_one'}}])
  assert.ok(state.guards>5)
})
for(const [name,change,code] of [
  ['wrong Stripe account',f=>f.state.account='acct_other','ACCOUNT_MISMATCH'],
  ['shared customer',f=>f.state.ownership.ownerUids.push('other'),'OWNERSHIP_UNCONFIRMED'],
  ['foreign customer subscription',f=>f.state.subs[0].customer='cus_other','SUBSCRIPTION_MISMATCH'],
  ['live object in mock test context',f=>f.state.subs[0].livemode=true,'SUBSCRIPTION_MISMATCH'],
  ['missing legacy linked subscription',f=>f.state.ownership.knownSubscriptionIds.push('sub_missing'),'LINKED_SUBSCRIPTION_MISSING'],
  ['future schedule',f=>f.state.schedules.push({id:'sub_sched',customer:'cus_one',livemode:false,status:'not_started'}),'SCHEDULE_REVIEW'],
  ['open Checkout',f=>f.state.sessions.push({id:'cs_open',customer:'cus_one',livemode:false,status:'open'}),'CHECKOUT_REVIEW'],
  ['pending async payment',f=>f.state.sessions.push({id:'cs_pending',customer:'cus_one',livemode:false,status:'complete',payment_status:'unpaid'}),'CHECKOUT_REVIEW'],
])test(`${name} holds before any Stripe mutation`,async()=>{
  const f=fixture();change(f);await assert.rejects(f.adapter.discover(uid),new RegExp(code));assert.equal(f.state.updates.length,0)
})
test('paginated subscription inventory follows the cursor and retains legacy/SMS subscriptions',async()=>{
  const {stripe,adapter,state}=fixture();const first=state.subs[0],second={...first,id:'sub_sms'};state.subs.push(second)
  const cursors=[];stripe.subscriptions.list=async params=>{cursors.push(params.starting_after);assert.equal(params.status,'all');assert.equal(params.customer,'cus_one');return params.starting_after?page([second]):{data:[first],has_more:true}}
  await stopVerifiedDeletionRenewals({uid,revision:2,provider:adapter})
  assert.deepEqual(cursors,[undefined,'sub_one']);assert.equal(state.updates.length,2)
})
test('repeated pagination page fails closed',async()=>{
  const {stripe,adapter,state}=fixture();stripe.subscriptions.list=async()=>({data:state.subs,has_more:true})
  await assert.rejects(adapter.discover(uid),/PAGINATION_INVALID/)
})
test('ownership change between discovery and mutation blocks cancellation',async()=>{
  const {adapter,state}=fixture();await adapter.discover(uid);state.ownership.customerId='cus_other'
  await assert.rejects(adapter.stopRenewal('sub_one',{uid,idempotencyKey:`deletion/${uid}/1/sub_one`}),/UNDISCOVERED_SUBSCRIPTION/);assert.equal(state.updates.length,0)
})
test('provider false readback and lost response never invent verified cancellation',async()=>{
  const {stripe,adapter}=fixture();stripe.subscriptions.update=async()=>({})
  await assert.rejects(stopVerifiedDeletionRenewals({uid,revision:1,provider:adapter}),/BILLING_STOP_UNCONFIRMED/)
  stripe.subscriptions.update=async()=>{throw Error('mock timeout')}
  await assert.rejects(stopVerifiedDeletionRenewals({uid,revision:1,provider:adapter}),/mock timeout/)
})
test('already canceled subscription has no mutation; active schedule is never silently canceled',async()=>{
  const {adapter,state}=fixture();state.subs[0].status='canceled'
  await stopVerifiedDeletionRenewals({uid,revision:1,provider:adapter});assert.equal(state.updates.length,0)
  state.subs[0].schedule='sub_sched'
  await assert.rejects(stopVerifiedDeletionRenewals({uid,revision:1,provider:adapter}),/SCHEDULE_REVIEW/)
})
test('mismatched retrieved resource and failed rediscovery cannot reuse stale scope',async()=>{
  const {adapter,state,stripe}=fixture();await adapter.discover(uid)
  stripe.subscriptions.retrieve=async()=>({...state.subs[0],id:'sub_other'})
  await assert.rejects(adapter.stopRenewal('sub_one',{uid,idempotencyKey:`deletion/${uid}/1/sub_one`}),/SUBSCRIPTION_MISMATCH/)
  state.sessions.push({id:'cs_open',customer:'cus_one',livemode:false,status:'open'})
  await assert.rejects(adapter.discover(uid),/CHECKOUT_REVIEW/)
  await assert.rejects(adapter.verify('sub_one'),/UNDISCOVERED_SUBSCRIPTION/)
})

test('asynchronous runtime refusal prevents all Stripe reads and mutations',async()=>{
  const f=fixture();let calls=0
  const stripe=new Proxy({}, {get(){calls++;throw Error('unexpected Stripe access')}})
  const adapter=createStripeDeletionRenewalContract({stripe,loadOwnership:async()=>f.state.ownership,
    assertRuntime:async()=>{await Promise.resolve();throw Error('runtime revoked')},expectedAccountId:'acct_synthetic',expectedLivemode:false})
  await assert.rejects(adapter.discover(uid),/runtime revoked/)
  assert.equal(calls,0)
})

test('runtime revoked during subscription read holds before cancellation',async()=>{
  const f=fixture();let allowed=true
  const original=f.stripe.subscriptions.retrieve
  f.stripe.subscriptions.retrieve=async id=>{const value=await original(id);allowed=false;return value}
  const adapter=createStripeDeletionRenewalContract({stripe:f.stripe,loadOwnership:async()=>f.state.ownership,
    assertRuntime:async()=>{await Promise.resolve();if(!allowed)throw Error('runtime revoked')},expectedAccountId:'acct_synthetic',expectedLivemode:false})
  await adapter.discover(uid)
  await assert.rejects(adapter.stopRenewal('sub_one',{uid,idempotencyKey:`deletion/${uid}/1/sub_one`}),/runtime revoked/)
  assert.equal(f.state.updates.length,0)
})

test('ownership changed while subscription read was in flight blocks cancellation',async()=>{
  const f=fixture(),original=f.stripe.subscriptions.retrieve
  await f.adapter.discover(uid)
  f.stripe.subscriptions.retrieve=async id=>{const value=await original(id);f.state.ownership={...f.state.ownership,customerId:'cus_replacement'};return value}
  await assert.rejects(f.adapter.stopRenewal('sub_one',{uid,idempotencyKey:`deletion/${uid}/1/sub_one`}),/OWNERSHIP_CHANGED/)
  assert.equal(f.state.updates.length,0)
})

test('an empty inventory cannot verify no subscription after ownership changes during discovery',async()=>{
  const f=fixture();f.state.subs=[];f.state.ownership.knownSubscriptionIds=[]
  f.stripe.checkout.sessions.list=async()=>{f.state.ownership={...f.state.ownership,customerId:'cus_replacement'};return page([])}
  await assert.rejects(stopVerifiedDeletionRenewals({uid,revision:1,provider:f.adapter}),/OWNERSHIP_CHANGED/)
  assert.equal(f.state.updates.length,0)
})

test('verification cannot report a stopped renewal after customer binding changes during readback',async()=>{
  const f=fixture();await f.adapter.discover(uid)
  f.stripe.subscriptions.retrieve=async()=>{f.state.ownership={...f.state.ownership,customerId:'cus_replacement'};return {...f.state.subs[0],cancel_at_period_end:true}}
  await assert.rejects(f.adapter.verify('sub_one'),/OWNERSHIP_CHANGED/)
})

test('Stripe discovery preserves provider creation evidence for acceptance-scoped renewal dispatch',async()=>{
  const f=fixture();f.state.subs[0].created=1700000000
  const discovery=await f.adapter.discover(uid)
  assert.equal(discovery.subscriptions[0].createdAt,'2023-11-14T22:13:20.000Z')
  delete f.state.subs[0].created
  assert.equal((await f.adapter.discover(uid)).subscriptions[0].createdAt,undefined)
})

test('dispatcher lease revoked during Stripe lookup blocks the final cancellation mutation',async()=>{
  const f=fixture();await f.adapter.discover(uid)
  let lease=true
  const original=f.stripe.subscriptions.retrieve
  f.stripe.subscriptions.retrieve=async id=>{const value=await original(id);lease=false;return value}
  await assert.rejects(f.adapter.stopRenewal('sub_one',{uid,idempotencyKey:`deletion/${uid}/1/sub_one`,assertExecution:async()=>{if(!lease)throw Object.assign(Error('stale attempt'),{code:'RENEWAL_STALE_ATTEMPT'})}}),/stale attempt/)
  assert.equal(f.state.updates.length,0)
})
