import Stripe from 'stripe'
import {cloudFixtureScope} from './deletion-cloud-runtime.mjs'
import {QA_RESOURCES} from './provision-deletion-resources.mjs'
import {digest} from '../../api/_lib/deletion-plan.js'

const ensure=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code})}
const accountId='acct_1TiU0IGHgBd6ZgJE'
// CI-only, read-only companion to the existing disposable cloud fixture.
// The credential stays private to this client; no SDK or provider object escapes.
export async function createCloudStripeReadback({db,auth,bucket,runId,manifest,stripeKey,executionEnabled=false}){
 ensure(executionEnabled===true,'STRIPE_READBACK_DISABLED')
 ensure(typeof stripeKey==='string'&&/^(rk|sk)_test_[A-Za-z0-9]+$/.test(stripeKey),'STRIPE_READBACK_TEST_CONTEXT_REQUIRED')
 const ci={sourceSha:process.env.GITHUB_SHA,githubRunId:process.env.GITHUB_RUN_ID}
 const ciRuntime=()=>ensure(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='izipawsltd-Tony/idogs-app'
  &&process.env.GITHUB_REF==='refs/heads/release/ios-app-store-20261025'&&/^[a-f0-9]{40}$/.test(ci.sourceSha||'')&&/^[1-9][0-9]+$/.test(ci.githubRunId||'')
  &&process.env.GITHUB_SHA===ci.sourceSha&&process.env.GITHUB_RUN_ID===ci.githubRunId,'STRIPE_READBACK_CI_CONTEXT_REQUIRED')
 ciRuntime()
 const original=structuredClone(manifest),manifestHash=digest(original)
 ensure(bucket.name===QA_RESOURCES.bucket&&!original.storageMode,'STRIPE_READBACK_ZERO_RETENTION_REQUIRED')
 ensure(/^cus_[A-Za-z0-9]+$/.test(original.stripeCustomerId||'')&&/^sub_[A-Za-z0-9]+$/.test(original.stripeSubscriptionId||''),'STRIPE_READBACK_PROVIDER_SCOPE_REQUIRED')
 const scope=cloudFixtureScope({db,auth,bucket,runId,manifest:original})
 const jobRef=db.doc(`accountDeletionJobs/${scope.uid}`),profileRef=db.doc(`users/${scope.uid}`)
 await scope.assertRuntime(scope.uid)
 const profile=(await profileRef.get()).data()
 ensure(profile?.stripeCustomerId===original.stripeCustomerId&&profile.deletionQaRunId===runId,'STRIPE_READBACK_PROFILE_CHANGED')
 const profileHash=digest(profile)
 async function runtime(){
  ciRuntime()
  ensure(digest(manifest)===manifestHash,'STRIPE_READBACK_INPUT_CHANGED')
  await scope.assertRuntime(scope.uid)
  const job=(await jobRef.get()).data()
  ensure(job?.revision===1&&!job.authRemovalAttempted&&job.stage!=='completed','STRIPE_READBACK_JOB_CHANGED')
  ensure(digest((await profileRef.get()).data())===profileHash,'STRIPE_READBACK_PROFILE_CHANGED')
 }
 await runtime()
 const paths=['/v1/account',`/v1/customers/${original.stripeCustomerId}`,`/v1/subscriptions/${original.stripeSubscriptionId}`]
 const attempted=new Set(),responses=[]
 const native=Stripe.createNodeHttpClient()
 let client,started=false,accountVerified=false
 const pinned=()=>ensure(client.getMaxNetworkRetries()===0&&client.getApiField('host')==='api.stripe.com'&&client.getApiField('protocol')==='https'
  &&Number(client.getApiField('port'))===443&&client.getApiField('timeout')===5000,'STRIPE_READBACK_SETTINGS_CHANGED')
 const httpClient={getClientName:()=> 'manifest-bound-test-readback',makeRequest:async(host,port,path,method,headers,body,protocol,timeout)=>{
  pinned()
  ensure(host==='api.stripe.com'&&Number(port)===443&&protocol==='https'&&method==='GET'&&paths.includes(path)&&!body&&timeout>0&&timeout<=5000,'STRIPE_READBACK_WIRE_REJECTED')
  const h=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]))
  ensure(h.authorization===`Bearer ${stripeKey}`&&!h['stripe-account']&&!h['stripe-context'],'STRIPE_READBACK_CONTEXT_CHANGED')
  ensure(path===paths[0]||accountVerified,'STRIPE_READBACK_ACCOUNT_REQUIRED')
  await runtime();pinned()
  ensure(!attempted.has(path),'STRIPE_READBACK_ALREADY_ATTEMPTED');attempted.add(path)
  try{return await native.makeRequest(host,port,path,method,headers,body,protocol,timeout)}
  catch(cause){throw Object.assign(new Error('STRIPE_READBACK_OUTCOME_UNKNOWN',{cause}),{code:'STRIPE_READBACK_OUTCOME_UNKNOWN'})}
 }}
 client=new Stripe(stripeKey,{host:'api.stripe.com',port:443,protocol:'https',timeout:5000,maxNetworkRetries:0,telemetry:false,httpClient})
 pinned()
 const binding=value=>ensure(value?.livemode===false&&value.metadata?.deletionQaRunId===runId&&value.metadata?.firebaseUid===scope.uid,'STRIPE_READBACK_RESPONSE_CHANGED')
 return Object.freeze({mode:'isolated-cloud-test-read-only',read:async()=>{
  ensure(!started,'STRIPE_READBACK_ALREADY_STARTED');started=true
  await runtime()
  const account=await client.accounts.retrieve()
  ensure(account.id===accountId,'STRIPE_READBACK_ACCOUNT_CHANGED');accountVerified=true
  responses.push(digest({id:account.id}))
  const customer=await client.customers.retrieve(original.stripeCustomerId)
  binding(customer);ensure(customer.id===original.stripeCustomerId&&!customer.deleted,'STRIPE_READBACK_CUSTOMER_CHANGED')
  responses.push(digest(customer))
  const subscription=await client.subscriptions.retrieve(original.stripeSubscriptionId)
  binding(subscription);ensure(subscription.id===original.stripeSubscriptionId&&subscription.customer===original.stripeCustomerId,'STRIPE_READBACK_SUBSCRIPTION_CHANGED')
  responses.push(digest(subscription))
  await runtime()
  return Object.freeze({schema:1,...ci,manifestHash,accountId,providerBindingHash:digest(responses),readOnly:true,httpAttempts:attempted.size,
   realTestBindingVerified:true,signedWebhookVerified:false,authorizationDrainVerified:false,productionReady:false})
 }})
}
