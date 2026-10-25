import {createHash} from 'node:crypto'
import {digest} from './deletion-plan.js'
const fail=(code,status=409)=>Object.assign(new Error(code),{code,status})
export function assertDeletionQaWebhookRuntime(env,now=Date.now()){
 for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','STORAGE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','GOOGLE_CLOUD_UNIVERSE_DOMAIN'])if(env[key])throw fail('QA_WEBHOOK_ENDPOINT_OVERRIDE',503)
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_PROJECT_ID!=='prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o'||env.VERCEL_GIT_COMMIT_REF!=='release/ios-app-store-20261025'||env.FIREBASE_PROJECT_ID!=='idogs-app-staging')throw fail('QA_WEBHOOK_TARGET_DISABLED',503)
 if(!env.FIREBASE_CLIENT_EMAIL?.endsWith('@idogs-app-staging.iam.gserviceaccount.com')||!env.FIREBASE_PRIVATE_KEY?.startsWith('-----BEGIN PRIVATE KEY-----'))throw fail('QA_WEBHOOK_FIREBASE_IDENTITY_REQUIRED',503)
 const expires=Date.parse(env.IDOGS_DELETION_WEBHOOK_QA_EXPIRES_AT)
 if(!Number.isFinite(expires)||expires<=now||expires>now+86400000)throw fail('QA_WEBHOOK_TIME_WINDOW_INVALID',503)
 if(!/^(rk|sk)_test_[A-Za-z0-9]+$/.test(env.IDOGS_DELETION_STRIPE_TEST_KEY||'')||!/^whsec_[A-Za-z0-9]+$/.test(env.IDOGS_DELETION_WEBHOOK_SECRET||''))throw fail('QA_WEBHOOK_CREDENTIAL_REQUIRED',503)
}
// Records only verified Test renewal evidence in the isolated QA job. Does not
// grant entitlement, process deletion, send mail or write the default database.
export function makeDeletionQaWebhook({db,stripe,secret,assertRuntime}){
 if(db.projectId!=='idogs-app-staging'||db.databaseId!=='idogs-deletion-qa'||typeof assertRuntime!=='function')throw fail('QA_WEBHOOK_DATABASE_MISMATCH')
 return async(raw,signature)=>{
  assertRuntime()
  if(!Buffer.isBuffer(raw)||raw.length>262144)return {status:400,body:{error:'Invalid webhook body'}}
  let event
  try{event=stripe.webhooks.constructEvent(raw,signature,secret)}catch{return {status:400,body:{error:'Invalid webhook signature'}}}
  if(event.livemode!==false||!/^evt_[A-Za-z0-9]+$/.test(event.id||''))return {status:400,body:{error:'Test event required'}}
  if(event.type!=='customer.subscription.updated')return {status:200,body:{ignored:true}}
  const s=event.data?.object,runId=s?.metadata?.deletionQaRunId,uid=s?.metadata?.firebaseUid
  if(!/^deletion-qa-[a-f0-9]{32}$/.test(runId||'')||uid!==`qa-${runId}`)return {status:200,body:{ignored:true}}
  if(s.livemode!==false||s.cancel_at_period_end!==true||!/^sub_[A-Za-z0-9]+$/.test(s.id||'')||!/^cus_[A-Za-z0-9]+$/.test(s.customer||''))return {status:200,body:{ignored:true}}
  const ref=db.doc(`accountDeletionJobs/${uid}`),job=(await ref.get()).data(),m=job?.qaManifest
  if(!m)return {status:200,body:{ignored:true}}
  if(m.disposable!==true||m.runId!==runId||m.uid!==uid||m.stripeCustomerId!==s.customer||m.stripeSubscriptionId!==s.id)throw fail('QA_WEBHOOK_FIXTURE_MISMATCH')
  if((await stripe.accounts.retrieve()).id!=='acct_1TiU0IGHgBd6ZgJE')throw fail('QA_WEBHOOK_ACCOUNT_MISMATCH')
  const current=await stripe.subscriptions.retrieve(s.id)
  if(current.id!==s.id||current.customer!==s.customer||current.livemode!==false||current.cancel_at_period_end!==true||current.metadata?.deletionQaRunId!==runId||current.metadata?.firebaseUid!==uid)throw fail('QA_WEBHOOK_PROVIDER_READBACK_MISMATCH')
  const receipt=ref.collection('providerEvents').doc(event.id)
  const payloadHash=createHash('sha256').update(raw).digest('hex')
  const duplicate=await db.runTransaction(async tx=>{
   const [latest,prior]=await Promise.all([tx.get(ref),tx.get(receipt)])
   if(digest(latest.data()?.qaManifest)!==digest(m))throw fail('QA_WEBHOOK_MANIFEST_CHANGED')
   if(prior.exists){if(prior.data().payloadHash!==payloadHash)throw fail('QA_WEBHOOK_EVENT_CONFLICT');return true}
   assertRuntime()
   tx.create(receipt,{eventId:event.id,type:event.type,subscriptionId:s.id,renewalStopped:true,livemode:false,payloadHash,receivedAt:new Date().toISOString()});return false
  })
  return {status:200,body:{received:true,duplicate}}
 }
}
