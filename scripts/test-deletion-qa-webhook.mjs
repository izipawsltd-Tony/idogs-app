import {test} from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import {makeDeletionQaWebhook,assertDeletionQaWebhookRuntime} from '../api/_lib/deletion-qa-webhook.js'
const secret='whsec_fixtureonly',signer=new Stripe('sk_test_fixtureonly'),runId=`deletion-qa-${'a'.repeat(32)}`,uid=`qa-${runId}`
function fixture(){
 const manifest={uid,runId,disposable:true,stripeCustomerId:'cus_fixture',stripeSubscriptionId:'sub_fixture'},receipts=new Map();let writes=0,reads=0
 const subscription={id:'sub_fixture',customer:'cus_fixture',livemode:false,cancel_at_period_end:true,metadata:{deletionQaRunId:runId,firebaseUid:uid}}
 const event={id:'evt_fixture',type:'customer.subscription.updated',livemode:false,data:{object:subscription}}
 const job={path:`accountDeletionJobs/${uid}`,get:async()=>{reads++;return {data:()=>({qaManifest:manifest})}},collection:()=>({doc:id=>({path:id})})}
 const db={projectId:'idogs-app-staging',databaseId:'idogs-deletion-qa',doc:()=>job,runTransaction:async fn=>fn({get:async ref=>ref===job?{data:()=>({qaManifest:manifest})}:{exists:receipts.has(ref.path),data:()=>receipts.get(ref.path)},create:(ref,data)=>{writes++;receipts.set(ref.path,data)}})}
 const stripe={webhooks:signer.webhooks,accounts:{retrieve:async()=>({id:'acct_1TiU0IGHgBd6ZgJE'})},subscriptions:{retrieve:async()=>subscription}}
 const handler=makeDeletionQaWebhook({db,stripe,secret,assertRuntime:()=>{}})
 const call=async(value=event)=>{const raw=Buffer.from(JSON.stringify(value)),signature=signer.webhooks.generateTestHeaderString({payload:raw.toString(),secret});return handler(raw,signature)}
 return {handler,call,event,subscription,manifest,stripe,counts:()=>({writes,reads}),db}
}
test('deployment, credential and 24-hour runtime guards reject Production and wrong project',()=>{
 const now=Date.now(),env={VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o',VERCEL_GIT_COMMIT_REF:'release/ios-app-store-20261025',FIREBASE_PROJECT_ID:'idogs-app-staging',FIREBASE_CLIENT_EMAIL:'fixture@idogs-app-staging.iam.gserviceaccount.com',FIREBASE_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----fixture',IDOGS_DELETION_WEBHOOK_QA_EXPIRES_AT:new Date(now+3600000).toISOString(),IDOGS_DELETION_STRIPE_TEST_KEY:'sk_test_fixture',IDOGS_DELETION_WEBHOOK_SECRET:'whsec_fixture'}
 assertDeletionQaWebhookRuntime(env,now)
 for(const patch of [{VERCEL_ENV:'production'},{FIREBASE_PROJECT_ID:'idogs-app'},{VERCEL_PROJECT_ID:'prj_other'},{IDOGS_DELETION_STRIPE_TEST_KEY:'sk_live_fixture'},{IDOGS_DELETION_WEBHOOK_QA_EXPIRES_AT:new Date(now-1).toISOString()},{IDOGS_DELETION_WEBHOOK_QA_EXPIRES_AT:new Date(now+90000000).toISOString()},{FIREBASE_CLIENT_EMAIL:'fixture@idogs-app.iam.gserviceaccount.com'}])assert.throws(()=>assertDeletionQaWebhookRuntime({...env,...patch},now))
})
test('invalid signatures and live envelopes never reach the database',async()=>{
 const f=fixture();assert.equal((await f.handler(Buffer.from('{}'),'invalid')).status,400)
 assert.equal((await f.call({...f.event,livemode:true})).status,400);assert.deepEqual(f.counts(),{reads:0,writes:0})
})
test('signed synthetic Test fixture records one receipt and redelivery is idempotent',async()=>{
 const f=fixture();assert.deepEqual((await f.call()).body,{received:true,duplicate:false});assert.deepEqual((await f.call()).body,{received:true,duplicate:true});assert.equal(f.counts().writes,1)
})
test('unrelated fixtures ignored and a changed provider customer is blocked without writes',async()=>{
 const f=fixture();assert.equal((await f.call({...f.event,data:{object:{...f.subscription,metadata:{}}}})).body.ignored,true)
 f.manifest.stripeCustomerId='cus_foreign';await assert.rejects(f.call(),/FIXTURE_MISMATCH/);assert.equal(f.counts().writes,0)
})
test('wrong database rejected before creating a receiver',()=>{
 const f=fixture();assert.throws(()=>makeDeletionQaWebhook({db:{...f.db,databaseId:'(default)'},stripe:{},secret,assertRuntime:()=>{}}),/DATABASE_MISMATCH/)
})
test('wrong Stripe account or unconfirmed provider readback cannot create a receipt',async()=>{
 const f=fixture();f.stripe.accounts.retrieve=async()=>({id:'acct_foreign'})
 await assert.rejects(f.call(),/ACCOUNT_MISMATCH/);assert.equal(f.counts().writes,0)
 const g=fixture();g.stripe.subscriptions.retrieve=async()=>({...g.subscription,cancel_at_period_end:false})
 await assert.rejects(g.call(),/PROVIDER_READBACK_MISMATCH/);assert.equal(g.counts().writes,0)
})
