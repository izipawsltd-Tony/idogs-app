import { randomUUID } from 'node:crypto'
import { stagingDeletionConfiguration,STAGING_DELETION_TARGET as target } from './deletion-staging-readiness.mjs'
import { createStagingDeletionBilling } from '../../api/_lib/deletion-staging-billing.js'
import { changeDeletionRequest } from '../../api/_lib/account-deletion.js'

// Disposable Stripe TEST + Firestore staging fixture only. This does not test
// cloud permanent deletion, public HTTP authentication or signed webhooks.
let phase='configuration',stripe,db,app,runId,uid,customer,product,subscription,fixtureCreated=false,passed=false,cleanupOk=true,errorCode
const cleanupSteps=[]
const cleanupFailure=(step,e)=>{cleanupOk=false;cleanupSteps.push({step,status:'failed',code:/^[a-zA-Z0-9_/-]{1,80}$/.test(String(e?.code||''))?e.code:'CLEANUP_FAILED',httpStatus:Number.isInteger(e?.statusCode)?e.statusCode:undefined})}
const ensure=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code})}
try{
 const config=stagingDeletionConfiguration(process.env)
 ensure(config.status==='configured','STAGING_CREDENTIALS_MISSING')
 const [{initializeApp,cert},{getFirestore},{default:Stripe}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/firestore'),import('stripe')])
 runId=`deletion-qa-${randomUUID().replaceAll('-','')}`;uid=`qa-${runId}`
 app=initializeApp({credential:cert(config.credential),projectId:target.projectId},runId);db=getFirestore(app)
 stripe=new Stripe(config.stripeKey,{timeout:15000,maxNetworkRetries:0})
 const worker=createStagingDeletionBilling({db,stripe,projectId:target.projectId,stripeKey:config.stripeKey,runId})
 phase='verify_account';ensure((await stripe.accounts.retrieve()).id===target.stripeAccount,'STRIPE_ACCOUNT_MISMATCH')
 const metadata={deletionQaRunId:runId,firebaseUid:uid}
 phase='create_test_customer';customer=await stripe.customers.create({name:'Disposable iDogs deletion QA',metadata},{idempotencyKey:`${runId}/customer`})
 ensure(customer.livemode===false&&customer.metadata?.deletionQaRunId===runId,'TEST_CUSTOMER_MISMATCH')
 phase='create_test_product';product=await stripe.products.create({name:'Disposable deletion QA fixture',metadata},{idempotencyKey:`${runId}/product`})
 phase='create_test_subscription'
 subscription=await stripe.subscriptions.create({customer:customer.id,items:[{price_data:{currency:'aud',unit_amount:100,recurring:{interval:'month'},product:product.id}}],trial_period_days:2,trial_settings:{end_behavior:{missing_payment_method:'cancel'}},metadata},{idempotencyKey:`${runId}/subscription`})
 ensure(subscription.livemode===false&&subscription.customer===customer.id&&subscription.cancel_at_period_end===false,'TEST_SUBSCRIPTION_MISMATCH')
 phase='create_staging_fixture'
 const batch=db.batch()
 batch.create(db.doc(`deletionQaFixtures/${runId}`),{runId,uid,disposable:true,stripeCustomerId:customer.id})
 batch.create(db.doc(`users/${uid}`),{deletionQaRunId:runId,stripeCustomerId:customer.id,stripeSubscriptionId:subscription.id,role:'owner',plan:'free'})
 await batch.commit();fixtureCreated=true
 const token={uid,auth_time:Math.floor(Date.now()/1000)}
 phase='request_and_stop_renewal'
 const receipt=await changeDeletionRequest({db,token,body:{action:'request',confirmation:'DELETE MY ACCOUNT'},onRequestAccepted:job=>worker.accept(job)})
 ensure(receipt.status==='requested'&&receipt.renewalStatus==='verified_stopped','STAGING_RENEWAL_RECEIPT_UNCONFIRMED')
 const stopped=await stripe.subscriptions.retrieve(subscription.id)
 ensure(stopped.livemode===false&&stopped.customer===customer.id&&stopped.cancel_at_period_end===true,'STRIPE_RENEWAL_READBACK_FAILED')
 phase='cancel_request_never_restarts_renewal'
 const cancelled=await changeDeletionRequest({db,token,body:{action:'cancel'}})
 const after=await stripe.subscriptions.retrieve(subscription.id)
 ensure(cancelled.status==='cancelled'&&cancelled.renewalStatus==='verified_stopped'&&after.cancel_at_period_end===true,'STAGING_CANCELLATION_RESTARTED_RENEWAL')
 passed=true
}catch(e){
 errorCode=Number(e.statusCode)===403?'STRIPE_TEST_PERMISSION_REQUIRED':Number(e.statusCode)===401?'STRIPE_TEST_AUTHENTICATION_FAILED':'STAGING_RENEWAL_QA_BLOCKED'
}finally{
 // Only fresh nonce-owned fixtures are eligible for cleanup. Preserve anything
 // whose binding changed, and report cleanup failure instead of claiming PASS.
 if(fixtureCreated){try{
  await db.runTransaction(async tx=>{
   const f=await tx.get(db.doc(`deletionQaFixtures/${runId}`)),p=await tx.get(db.doc(`users/${uid}`))
   ensure(f.data()?.runId===runId&&f.data()?.uid===uid&&f.data()?.disposable===true&&p.data()?.deletionQaRunId===runId,'CLEANUP_BINDING_CHANGED')
   for(const path of [`users/${uid}`,`deletionQaFixtures/${runId}`,`accountDeletionRequests/${uid}`,`accountDeletionRenewalTasks/${uid}_1`,`supportConversations/account_deletion_${uid}`,`supportMessages/account_deletion_${uid}_1_request`,`supportMessages/account_deletion_${uid}_1_cancel`])tx.delete(db.doc(path))
  })
  cleanupSteps.push({step:'firestore_fixture',status:'success'})
 }catch(e){cleanupFailure('firestore_fixture',e)}}
 if(subscription){try{
  const s=await stripe.subscriptions.retrieve(subscription.id)
  ensure(s.livemode===false&&s.customer===customer.id&&s.metadata?.deletionQaRunId===runId,'CLEANUP_SUBSCRIPTION_MISMATCH')
  await stripe.subscriptions.cancel(s.id,{}, {idempotencyKey:`${runId}/cleanup-subscription`})
  cleanupSteps.push({step:'stripe_subscription',status:'success'})
  for(const item of s.items.data){
   const price=await stripe.prices.retrieve(item.price.id)
   ensure(price.livemode===false&&price.product===product.id,'CLEANUP_PRICE_MISMATCH')
   // Inline price_data prices can already be inactive and are not editable.
   // Do not issue an unsupported update for a price already unavailable for sale.
   if(price.active!==false)await stripe.prices.update(price.id,{active:false})
   const archived=await stripe.prices.retrieve(price.id)
   ensure(archived.livemode===false&&archived.product===product.id&&archived.active===false,'CLEANUP_PRICE_ARCHIVE_UNCONFIRMED')
  }
  cleanupSteps.push({step:'stripe_prices',status:'success'})
 }catch(e){cleanupFailure('stripe_subscription_or_prices',e)}}
 if(product){try{
  const p=await stripe.products.retrieve(product.id)
  ensure(p.livemode===false&&p.metadata?.deletionQaRunId===runId,'CLEANUP_PRODUCT_MISMATCH')
  await stripe.products.update(p.id,{active:false})
  cleanupSteps.push({step:'stripe_product',status:'success'})
 }catch(e){cleanupFailure('stripe_product',e)}}
 if(customer){try{
  const c=await stripe.customers.retrieve(customer.id)
  ensure(c.livemode===false&&c.metadata?.deletionQaRunId===runId,'CLEANUP_CUSTOMER_MISMATCH')
  await stripe.customers.del(c.id)
  cleanupSteps.push({step:'stripe_customer',status:'success'})
 }catch(e){cleanupFailure('stripe_customer',e)}}
 if(app){try{const {deleteApp}=await import('firebase-admin/app');await deleteApp(app)}catch(e){cleanupFailure('sdk_shutdown',e)}}
}
console.log(JSON.stringify({status:passed&&cleanupOk?'staging_renewal_contract_pass':'blocked',phase,code:errorCode,cleanupVerified:cleanupOk,cleanupSteps,fixtureRunId:runId,fixtureCreated,
 permanentDeletionVerified:false,signedWebhookVerified:false,httpAuthenticationVerified:false,
 requiredTestPermissions:['Accounts: Read','Customers: Write','Products: Write','Prices: Write','Subscriptions: Write','Subscription schedules: Read','Checkout Sessions: Read']},null,2))
if(!passed||!cleanupOk)process.exitCode=2
