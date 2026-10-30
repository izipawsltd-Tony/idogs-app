import {randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {stagingDeletionConfiguration} from './deletion-staging-readiness.mjs'
import {QA_RESOURCES as target,verifyQaDatabase,verifyQaBucket} from './provision-deletion-resources.mjs'
import {cloudFixtureScope,createCloudFixtureProcessor,createCloudFixtureRenewalDispatcher,createCloudFixtureRenewalQueue} from './deletion-cloud-runtime.mjs'
import {signInCloudFixture,loopbackDeletionApi,protectedPreviewDeletionApi} from './deletion-cloud-http.mjs'
import {createCloudStripeReadback} from './deletion-cloud-stripe-readback.mjs'
import {createDeletionEmailSink} from './deletion-email-sink.mjs'
import {createHumanQaConfirmation} from './deletion-human-confirmation.mjs'
import {createStripeDeletionRenewalContract} from '../../api/_lib/deletion-stripe-contract.js'
import {digest,scanDeletionDocuments} from '../../api/_lib/deletion-plan.js'
import {rehearseDeletedRecordRestore} from './deletion-restore-replay.mjs'
import {cleanupRenewalReceipts} from './deletion-renewal-cleanup.mjs'

const ensure=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code})}
const runId=`deletion-qa-${randomUUID().replaceAll('-','')}`,uid=`qa-${runId}`,email=`qa-${runId}@example.invalid`
let app,db,auth,bucket,stripe,customer,product,subscription,manifest,scope,httpApi,idToken,emailSink,authCreated=false,fixtureCreated=false,passed=false,phase='configuration',error,cleanupVerified=true,storageCasPending=false
const evidence={},cleanup=[]
try{
 const config=stagingDeletionConfiguration(process.env);ensure(config.status==='configured','CLOUD_QA_CREDENTIALS_REQUIRED')
 const [{initializeApp,cert},{getFirestore},{getAuth},{Storage,IdempotencyStrategy},{default:Stripe}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/firestore'),import('firebase-admin/auth'),import('@google-cloud/storage'),import('stripe')])
 const credential=cert(config.credential)
 app=initializeApp({credential,projectId:target.projectId},runId);db=getFirestore(app,target.databaseId);auth=getAuth(app)
 bucket=new Storage({projectId:target.projectId,credentials:config.credential}).bucket(target.bucket)
 stripe=new Stripe(config.stripeKey,{timeout:15000,maxNetworkRetries:0})
 const cloudRead=async url=>{
  ensure(new URL(url).origin==='https://firestore.googleapis.com','QA_API_ORIGIN_REJECTED')
  const token=await credential.getAccessToken(),r=await fetch(url,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(30000)})
  ensure(r.ok,`QA_METADATA_HTTP_${r.status}`);return r.json()
 }
 phase='verify_isolation'
 verifyQaBucket((await bucket.getMetadata())[0])
 const databaseUrl=`https://firestore.googleapis.com/v1/projects/${target.projectId}/databases/${target.databaseId}`
 const metadata=await cloudRead(databaseUrl);verifyQaDatabase(metadata)
 ensure(metadata.pointInTimeRecoveryEnablement==='POINT_IN_TIME_RECOVERY_DISABLED','QA_PITR_REVIEW_REQUIRED')
 const schedules=await cloudRead(`${databaseUrl}/backupSchedules`)
 ensure(!(schedules.backupSchedules?.length)&&!schedules.nextPageToken,'QA_BACKUP_SCHEDULE_REVIEW_REQUIRED')
 ensure(!(await db.doc('accountDeletionJobs/qa-deletion-qa-afe48e556bfa43a595c6276939440179').get()).exists,'QA_PRIOR_FIXTURE_CLEANUP_REQUIRED')
 ensure((await stripe.accounts.retrieve()).id==='acct_1TiU0IGHgBd6ZgJE','STRIPE_ACCOUNT_MISMATCH')
 phase='create_nonce_fixtures'
 const providerMetadata={deletionQaRunId:runId,firebaseUid:uid}
 customer=await stripe.customers.create({name:'Disposable permanent-deletion QA',metadata:providerMetadata},{idempotencyKey:`${runId}/customer`})
 ensure(customer.livemode===false,'STRIPE_TEST_REQUIRED')
 product=await stripe.products.create({name:'Disposable deletion QA',metadata:providerMetadata},{idempotencyKey:`${runId}/product`})
 subscription=await stripe.subscriptions.create({customer:customer.id,items:[{price_data:{currency:'aud',unit_amount:100,recurring:{interval:'month'},product:product.id}}],trial_period_days:2,trial_settings:{end_behavior:{missing_payment_method:'cancel'}},metadata:providerMetadata},{idempotencyKey:`${runId}/subscription`})
 ensure(subscription.livemode===false&&subscription.customer===customer.id&&!subscription.cancel_at_period_end,'STRIPE_TEST_FIXTURE_MISMATCH')
 const user=await auth.createUser({uid,email,emailVerified:true,displayName:runId});authCreated=true
 const mediaPaths=[`documents/${uid}/proof.txt`,`documents/${uid}/orphan.txt`]
 const recordPaths=[`users/${uid}`,`dogs/${runId}-dog`,`vaccineRecords/${runId}-vaccine`,`wormingRecords/${runId}-worm`,`documents/${runId}-document`]
 manifest={uid,email,runId,disposable:true,authCreatedAt:user.metadata.creationTime,recordPaths,mediaPaths,stripeCustomerId:customer.id,stripeSubscriptionId:subscription.id}
 const batch=db.batch()
 batch.create(db.doc(`accountDeletionJobs/${uid}`),{revision:1,leaseUntil:0,qaManifest:manifest})
 batch.create(db.doc(recordPaths[0]),{email,role:'owner',plan:'free',stripeCustomerId:customer.id,deletionQaRunId:runId})
 batch.create(db.doc(recordPaths[1]),{tenantId:uid,currentOwnerId:uid,name:'Disposable dog',deletionQaRunId:runId})
 for(const path of recordPaths.slice(2))batch.create(db.doc(path),{tenantId:uid,dogId:`${runId}-dog`,deletionQaRunId:runId,...(path.startsWith('documents/')?{filePath:mediaPaths[0]}:{})})
 batch.create(db.doc(`dogs/${runId}-sentinel`),{currentOwnerId:`qa-other-${runId}`,tenantId:`qa-other-${runId}`,name:'Unrelated QA sentinel',deletionQaRunId:runId})
 await batch.commit();fixtureCreated=true
 const restoreRecords=await Promise.all(recordPaths.slice(0,2).map(async path=>({path,data:(await db.doc(path).get()).data()})))
 const generations={}
 for(const path of mediaPaths){await bucket.file(path).save(Buffer.from('Disposable fixture, no personal data'),{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{metadata:{deletionQaRunId:runId}}});generations[path]=String((await bucket.file(path).getMetadata())[0].generation)}
 const sentinelBefore=digest((await db.doc(`dogs/${runId}-sentinel`).get()).data())
 scope=cloudFixtureScope({db,auth,bucket,runId,manifest})
 phase='private_stripe_test_readback'
 const stripeReadback=await createCloudStripeReadback({db,auth,bucket,runId,manifest,stripeKey:config.stripeKey,executionEnabled:true})
 evidence.privateStripeTestReadback=await stripeReadback.read()
 phase='storage_create_only_precondition'
 await scope.assertRuntime(uid)
 // One negative CAS probe on this exact disposable manifest object. Never
 // use the original seven-day fixture or infer provider CAS from an emulator.
 const casPath=manifest.mediaPaths[0],casOriginal=bucket.file(casPath)
 const [casBefore]=await casOriginal.getMetadata(),[casBytes]=await casOriginal.download()
 ensure(String(casBefore.generation)===generations[casPath]&&casBefore.metadata?.deletionQaRunId===runId,'QA_STORAGE_CAS_BINDING_CHANGED')
 const casClient=new Storage({projectId:target.projectId,credentials:config.credential,
  retryOptions:{autoRetry:false,maxRetries:0,idempotencyStrategy:IdempotencyStrategy.RetryNever}})
 casClient.retryOptions.maxRetries=0
 ensure(casClient.apiEndpoint==='https://storage.googleapis.com'&&casClient.retryOptions.autoRetry===false,'QA_STORAGE_CAS_TARGET_REQUIRED')
 const casProof={schema:1,uid,runId,path:casPath,generation:String(casBefore.generation),metageneration:String(casBefore.metageneration),contentHash:digest(casBytes)}
 const casJob=db.doc(`accountDeletionJobs/${uid}`)
 await scope.db.runTransaction(async tx=>{const j=(await tx.get(casJob)).data();ensure(digest(j?.qaManifest)===digest(manifest)&&!j.storageCasProbe,'QA_STORAGE_CAS_MANIFEST_CHANGED');tx.update(casJob,{storageCasProbe:{...casProof,state:'dispatching'}})})
 const casHandoff=state=>writeFileSync('storage-cas-handoff.json',JSON.stringify({schema:1,githubRunId:process.env.GITHUB_RUN_ID||null,
  sourceSha:process.env.GITHUB_SHA||null,projectId:target.projectId,databaseId:target.databaseId,bucket:target.bucket,
  manifest:{uid,email,runId,disposable:true,authCreatedAt:manifest.authCreatedAt,recordPaths:[...manifest.recordPaths],mediaPaths:[...manifest.mediaPaths],
   stripeCustomerId:manifest.stripeCustomerId,stripeSubscriptionId:manifest.stripeSubscriptionId},probe:{...casProof,state}},null,2))
 casHandoff('dispatching')
 storageCasPending=true
 let casRejected=false
 try{await casClient.bucket(target.bucket).file(casPath).save(Buffer.from('Create-only CAS must reject this replacement'),{
  resumable:false,timeout:15000,preconditionOpts:{ifGenerationMatch:0},metadata:{metadata:{deletionQaRunId:runId}}})}
 catch(e){ensure(e.code===412,'QA_STORAGE_CAS_UNEXPECTED_FAILURE');casRejected=true}
 await scope.db.runTransaction(async tx=>{const j=(await tx.get(casJob)).data();ensure(digest(j?.storageCasProbe)===digest({...casProof,state:'dispatching'}),'QA_STORAGE_CAS_RECEIPT_CHANGED');tx.update(casJob,{storageCasProbe:{...casProof,state:casRejected?'terminal_rejected_412':'terminal_unexpected_success'}})})
 storageCasPending=false
 casHandoff(casRejected?'terminal_rejected_412':'terminal_unexpected_success')
 const [casAfter]=await casOriginal.getMetadata(),[casAfterBytes]=await casOriginal.download()
 ensure(casRejected&&String(casAfter.generation)===String(casBefore.generation)
  &&String(casAfter.metageneration)===String(casBefore.metageneration)&&Buffer.compare(casBytes,casAfterBytes)===0,'QA_STORAGE_CREATE_ONLY_CAS_NOT_VERIFIED')
 evidence.storageCreateOnlyCasVerified=true
 if(process.env.IDOGS_DELETION_RESEND_QA_KEY)emailSink=createDeletionEmailSink({key:process.env.IDOGS_DELETION_RESEND_QA_KEY,scope,db:scope.db,auth,manifest})
 const provider=()=>{
  const contract=createStripeDeletionRenewalContract({stripe,assertRuntime:scope.assertTarget,expectedAccountId:'acct_1TiU0IGHgBd6ZgJE',expectedLivemode:false,loadOwnership:async id=>{
   ensure(id===uid,'QA_PROVIDER_UID_MISMATCH')
   const job=(await db.doc(`accountDeletionJobs/${uid}`).get()).data()
   ensure(digest(job?.qaManifest)===digest(manifest),'QA_PROVIDER_MANIFEST_CHANGED')
   const c=await stripe.customers.retrieve(customer.id)
   ensure(!c.deleted&&c.livemode===false&&c.metadata?.deletionQaRunId===runId&&c.metadata?.firebaseUid===uid,'QA_PROVIDER_CUSTOMER_CHANGED')
   const owners=await db.collection('users').where('stripeCustomerId','==',customer.id).limit(2).get()
   const profile=await db.doc(`users/${uid}`).get()
   ensure(owners.size===1&&owners.docs[0].id===uid&&profile.data()?.deletionQaRunId===runId||owners.empty&&!profile.exists&&job.authFrozen===true&&job.planReady===true,'QA_PROVIDER_REVERSE_BINDING_CHANGED')
   return {customerId:customer.id,ownerUids:[uid],knownSubscriptionIds:[subscription.id]}
  }})
  return {...contract,mode:'isolated-cloud-qa',retention:async id=>{
   ensure(id===uid,'QA_PROVIDER_UID_MISMATCH');await scope.assertRuntime(uid)
   // This controlled fixture run issues no signed upload URLs, exports,
   // backups or restore operations. These attestations are QA scope only.
   return {uid,verified:true,restoreReplayVerified:true,mediaIngressDrained:true,storageRetentionSeconds:0}
  },confirm:async id=>{
   ensure(id===uid,'QA_CONFIRMATION_UID_MISMATCH')
   try{await auth.getUser(uid);throw Error('QA_AUTH_STILL_PRESENT')}catch(e){ensure(e.code==='auth/user-not-found','QA_AUTH_REMOVAL_NOT_VERIFIED')}
   for(const path of recordPaths)ensure(!(await db.doc(path).get()).exists,'QA_DATA_STILL_PRESENT')
   for(const path of mediaPaths)ensure(!(await bucket.file(path).exists())[0],'QA_MEDIA_STILL_PRESENT')
   if(emailSink){await emailSink.send();evidence.emailSimulationAcceptedAfterAuthRemoval=true}
   // Operational QA ledger only. No email delivery is asserted.
   return {uid,accepted:true,mode:'qa-ledger'}
  }}
 }
 phase='real_firebase_auth_http_request'
 idToken=await signInCloudFixture({auth,uid,credential})
 httpApi=process.env.IDOGS_DELETION_HTTP_QA_ORIGIN?protectedPreviewDeletionApi({origin:process.env.IDOGS_DELETION_HTTP_QA_ORIGIN,bypass:process.env.IDOGS_DELETION_HTTP_QA_BYPASS}):await loopbackDeletionApi({db:scope.db,auth,uid})
 ensure((await httpApi.call()).status===401,'QA_HTTP_ANONYMOUS_ACCEPTED')
 ensure((await httpApi.call({token:'invalid-qa-token'})).status===401,'QA_HTTP_INVALID_TOKEN_ACCEPTED')
 const initial=await httpApi.call({token:idToken})
 ensure(initial.status===200&&initial.cacheControl==='private, no-store'&&initial.body.status==='none','QA_HTTP_INITIAL_STATUS_INVALID')
 const receipt=await httpApi.call({token:idToken,method:'POST',body:{action:'request',confirmation:'DELETE MY ACCOUNT'}})
 ensure(receipt.status===200&&receipt.body.status==='requested','QA_REQUEST_NOT_SAVED')
 const duplicateRequest=await httpApi.call({token:idToken,method:'POST',body:{action:'request',confirmation:'DELETE MY ACCOUNT'}})
 ensure(duplicateRequest.status===200&&duplicateRequest.body.requestedAt===receipt.body.requestedAt,'QA_HTTP_DUPLICATE_REQUEST_CHANGED')
 evidence.realFirebaseTokenHttpVerified=true
 phase='durable_renewal_dispatch'
 // Trusted QA activation of this one disposable task only. Public requests and
 // Production tasks still default to executionEnabled:false; no live switch.
 const renewalRef=db.doc(`accountDeletionRenewalTasks/${uid}_1`)
 await scope.assertRuntime(uid)
 await scope.db.runTransaction(async tx=>{
  const task=await tx.get(renewalRef),t=task.data()
  ensure(t?.uid===uid&&t.revision===1&&t.executionEnabled===false&&t.status==='pending_verification','QA_RENEWAL_TASK_CHANGED')
  tx.update(renewalRef,{executionEnabled:true})
 })
 const acceptedAt=(await db.doc(`accountDeletionRequests/${uid}`).get()).data().acceptedAt
 const dispatched=await createCloudFixtureRenewalQueue({scope,provider:provider(),acceptedAt}).run({limit:1,executionEnabled:true})
 ensure(dispatched.status==='completed'&&dispatched.cursor===1&&dispatched.total===1,'QA_RENEWAL_DISPATCH_NOT_VERIFIED')
 const durable=(await renewalRef.get()).data()
 ensure(durable.executionEnabled===false&&durable.dispatchState==='completed'&&durable.verificationReceipt?.mode==='isolated-cloud-qa','QA_RENEWAL_RECEIPT_MISSING')
 ensure((await auth.getUser(uid)).disabled===false&&(await db.doc(`users/${uid}`).get()).exists,'QA_RENEWAL_REMOVED_ACCOUNT')
 const replay=await createCloudFixtureRenewalDispatcher({scope,provider:provider()}).execute({uid,revision:1})
 ensure(replay.status==='completed'&&replay.duplicate===true,'QA_RENEWAL_DUPLICATE_NOT_IDEMPOTENT')
 const queueReplay=await createCloudFixtureRenewalQueue({scope,provider:provider(),acceptedAt}).run({limit:1,executionEnabled:true})
 ensure(queueReplay.status==='completed'&&queueReplay.cursor===1,'QA_RENEWAL_QUEUE_RECOVERY_FAILED')
 evidence.boundedRenewalQueueVerified=true
 evidence.durableRenewalDispatchVerified=true
 evidence.renewalBeforeAuthRemovalVerified=true
 phase='interrupt_after_real_media_removal'
 let interrupted=false
 try{await createCloudFixtureProcessor({scope,provider:provider()}).process({uid,revision:1,afterOperation:async({kind})=>{if(kind==='media'){interrupted=true;throw Object.assign(new Error('QA_INJECTED_INTERRUPTION'),{code:'QA_INJECTED_INTERRUPTION'})}}});throw Error('QA_INTERRUPTION_NOT_REACHED')}
 catch(e){ensure(e.code==='QA_INJECTED_INTERRUPTION'&&interrupted,'QA_UNEXPECTED_PROCESSOR_FAILURE')}
 ensure((await auth.getUser(uid)).disabled===true,'QA_AUTH_NOT_FROZEN')
 ensure((await httpApi.call({token:idToken})).status===401,'QA_HTTP_FROZEN_TOKEN_ACCEPTED')
 ensure((await db.doc(`users/${uid}`).get()).exists,'QA_PROFILE_REMOVED_BEFORE_INTERRUPTION')
 ensure((await db.doc(`accountDeletionRequests/${uid}`).get()).data()?.status!=='completed','QA_PREMATURE_COMPLETION')
 ensure((await stripe.subscriptions.retrieve(subscription.id)).cancel_at_period_end===true,'QA_RENEWAL_NOT_STOPPED')
 evidence.interruptionAndFreezeVerified=true
 if(process.env.IDOGS_DELETION_SIGNED_WEBHOOK_QA_REQUIRED==='true'){
  phase='actual_signed_stripe_event_receipt'
  let found=false
  for(let attempt=0;attempt<24;attempt++){
   const receipts=await db.doc(`accountDeletionJobs/${uid}`).collection('providerEvents').get()
   found=receipts.docs.some(d=>{const r=d.data();return /^evt_[A-Za-z0-9]+$/.test(r.eventId||'')&&r.subscriptionId===subscription.id&&r.type==='customer.subscription.updated'&&r.livemode===false&&r.renewalStopped===true})
   if(found)break
   await new Promise(resolve=>setTimeout(resolve,5000))
  }
  ensure(found,'QA_SIGNED_WEBHOOK_RECEIPT_MISSING')
  evidence.actualSignedStripeWebhookVerified=true
 }
 phase='retry_new_worker'
 const result=await createCloudFixtureProcessor({scope,provider:provider()}).process({uid,revision:1})
 ensure(result.status==='completed','QA_PROCESSOR_NOT_COMPLETED')
 phase='independent_cloud_readback'
 for(const path of recordPaths)ensure(!(await db.doc(path).get()).exists,'QA_RECORD_REMAINS')
 const scan=await scanDeletionDocuments(db)
 ensure(!scan.holds.length&&!scan.records.some(r=>r.path.includes(uid)||JSON.stringify(r.data).includes(uid)||JSON.stringify(r.data).includes(email)),'QA_RESIDUAL_IDENTITY')
 for(const path of mediaPaths){
  ensure(!(await bucket.file(path).exists())[0],'QA_LIVE_MEDIA_REMAINS')
  try{await bucket.file(path,{generation:generations[path]}).getMetadata();throw Error('QA_GENERATION_REMAINS')}catch(e){ensure(Number(e.code)===404,'QA_GENERATION_NOT_REMOVED')}
  const [versions,next]=await bucket.getFiles({prefix:path,versions:true,autoPaginate:false,maxResults:100})
  ensure(!versions.some(f=>f.name===path)&&!next,'QA_VERSION_REMAINS')
 }
 // A zero-retention bucket can reject softDeleted listing with 400 because
 // soft delete is disabled. Only that documented precondition is accepted;
 // unknown errors/403 fail. Metadata and exact generation 404 remain required.
 try{const [soft,next]=await bucket.getFiles({prefix:`documents/${uid}/`,softDeleted:true,autoPaginate:false,maxResults:100});ensure(soft.length===0&&!next,'QA_SOFT_DELETED_COPY_REMAINS');evidence.softDeletedListing='empty'}
 catch(e){ensure(Number(e.code)===400&&/soft.?delete/i.test(e.message||''),'QA_SOFT_DELETED_INVENTORY_FAILED');verifyQaBucket((await bucket.getMetadata())[0]);evidence.softDeletedListing='disabled_bucket_400'}
 try{await auth.getUser(uid);throw Error('QA_AUTH_REMAINS')}catch(e){ensure(e.code==='auth/user-not-found','QA_AUTH_REMAINS')}
 ensure((await httpApi.call({token:idToken})).status===401,'QA_HTTP_DELETED_TOKEN_ACCEPTED')
 evidence.revokedAndDeletedTokenRejected=true
 ensure(digest((await db.doc(`dogs/${runId}-sentinel`).get()).data())===sentinelBefore,'QA_SENTINEL_CHANGED')
 ensure((await stripe.subscriptions.retrieve(subscription.id)).cancel_at_period_end===true,'QA_RENEWAL_RESTARTED')
 const final=(await db.doc(`accountDeletionRequests/${uid}`).get()).data(),audit=(await db.doc(`accountDeletionReceipts/${digest([uid,1])}`).get()).data()
 ensure(final.status==='completed'&&final.renewalStatus==='verified_stopped'&&audit.confirmation==='qa-ledger-no-email','QA_COMPLETION_RECEIPT_INVALID')
 const duplicate=await createCloudFixtureProcessor({scope,provider:provider()}).process({uid,revision:1})
 ensure(duplicate.status==='completed'&&duplicate.duplicate===true,'QA_DUPLICATE_NOT_IDEMPOTENT')
 phase='controlled_restored_record_replay'
 evidence.restoreReplay=await rehearseDeletedRecordRestore({scope,manifest,records:restoreRecords})
 ensure(digest((await db.doc(`dogs/${runId}-sentinel`).get()).data())===sentinelBefore,'QA_RESTORE_SENTINEL_CHANGED')
 if(emailSink){
  phase='resend_simulation_delivery_readback'
  for(let attempt=0;attempt<8;attempt++){
   try{Object.assign(evidence,await emailSink.verify());break}catch(e){if(e.code!=='QA_RESEND_DELIVERY_PENDING'||attempt===7)throw e;await new Promise(resolve=>setTimeout(resolve,5000))}
  }
 }
 if(process.env.IDOGS_HUMAN_EMAIL_QA_APPROVAL){
  phase='owner_selected_human_email_qa'
  const human=createHumanQaConfirmation({env:process.env,scope,db:scope.db,auth,manifest});await human.send()
  for(let attempt=0;attempt<8;attempt++){try{Object.assign(evidence,await human.verify());break}catch(e){if(e.code!=='HUMAN_QA_DELIVERY_PENDING'||attempt===7)throw e;await new Promise(resolve=>setTimeout(resolve,5000))}}
 }
 Object.assign(evidence,{firestoreRemoval:true,exactStorageGenerationsRemoved:true,authRemoval:true,stripeTestRenewalStopped:true,otherOwnerSentinelUnchanged:true,newWorkerRetry:true,duplicateIdempotent:true})
 passed=true
}catch(e){error={code:/^[A-Za-z0-9_/-]{1,100}$/.test(String(e.code||''))?String(e.code):'CLOUD_PERMANENT_QA_FAILED',httpStatus:Number.isInteger(e.statusCode)?e.statusCode:undefined};}
finally{
 const clean=async(name,fn)=>{try{await fn();cleanup.push({step:name,status:'success'})}catch(e){cleanupVerified=false;cleanup.push({step:name,status:'failed',code:/^[A-Za-z0-9_/-]{1,100}$/.test(String(e.code||''))?String(e.code):'CLEANUP_FAILED'})}}
 if(httpApi)await clean('http_shutdown',()=>httpApi.close())
 if(storageCasPending){cleanupVerified=false;cleanup.push({step:'firebase_fixture',status:'held',code:'QA_STORAGE_CAS_OUTCOME_UNKNOWN'})}
 if(manifest&&db&&!storageCasPending)await clean('firebase_fixture',async()=>{
  const job=db.doc(`accountDeletionJobs/${uid}`),j=(await job.get()).data();ensure(digest(j?.qaManifest)===digest(manifest),'QA_CLEANUP_BINDING_CHANGED')
  await cleanupRenewalReceipts({scope:scope||cloudFixtureScope({db,auth,bucket,runId,manifest}),db,manifest})
  for(const path of manifest.mediaPaths){const file=bucket.file(path);if((await file.exists())[0]){const [m]=await file.getMetadata();ensure(m.metadata?.deletionQaRunId===runId,'QA_CLEANUP_MEDIA_CHANGED');await file.delete({ifGenerationMatch:m.generation})}}
  const paths=[...manifest.recordPaths,`dogs/${runId}-sentinel`,`accountDeletionRequests/${uid}`,`accountDeletionLocks/${uid}`,`accountDeletionReceipts/${digest([uid,1])}`,`accountDeletionRenewalTasks/${uid}_1`,`supportConversations/account_deletion_${uid}`,`supportMessages/account_deletion_${uid}_1_request`]
  if(fixtureCreated){const batch=db.batch();for(const path of paths)batch.delete(db.doc(path));await batch.commit();await db.recursiveDelete(job)}
 })
 if(authCreated&&!storageCasPending)await clean('auth_fixture',async()=>{try{const u=await auth.getUser(uid);ensure(u.email===email&&u.displayName===runId,'QA_CLEANUP_AUTH_CHANGED');await auth.deleteUser(uid)}catch(e){if(e.code!=='auth/user-not-found')throw e}})
 if(subscription)await clean('stripe_subscription_prices',async()=>{
  const s=await stripe.subscriptions.retrieve(subscription.id);ensure(s.livemode===false&&s.customer===customer.id&&s.metadata?.deletionQaRunId===runId,'QA_CLEANUP_SUB_CHANGED')
  if(s.status!=='canceled')await stripe.subscriptions.cancel(s.id,{}, {idempotencyKey:`${runId}/cleanup-sub`})
  for(const item of s.items.data){const p=await stripe.prices.retrieve(item.price.id);ensure(p.livemode===false&&p.product===product.id,'QA_CLEANUP_PRICE_CHANGED');if(p.active)await stripe.prices.update(p.id,{active:false});ensure((await stripe.prices.retrieve(p.id)).active===false,'QA_CLEANUP_PRICE_ACTIVE')}
 })
 if(product)await clean('stripe_product',async()=>{const p=await stripe.products.retrieve(product.id);ensure(p.livemode===false&&p.metadata?.deletionQaRunId===runId,'QA_CLEANUP_PRODUCT_CHANGED');await stripe.products.update(p.id,{active:false})})
 if(customer)await clean('stripe_customer',async()=>{const c=await stripe.customers.retrieve(customer.id);ensure(!c.deleted&&c.livemode===false&&c.metadata?.deletionQaRunId===runId,'QA_CLEANUP_CUSTOMER_CHANGED');await stripe.customers.del(c.id)})
 if(app)await clean('sdk_shutdown',async()=>{const {deleteApp}=await import('firebase-admin/app');await deleteApp(app)})
}
console.log(JSON.stringify({status:passed&&cleanupVerified?'isolated_cloud_permanent_deletion_pass':'blocked',phase,error,storageCasProbePending:storageCasPending,fixtureRunId:runId,evidence,cleanupVerified,cleanup,httpAuthenticationVerified:evidence.realFirebaseTokenHttpVerified===true,httpTransport:process.env.IDOGS_DELETION_HTTP_QA_ORIGIN?'protected-preview-https':'runner-loopback-actual-handler',publicDeploymentVerified:passed&&!!process.env.IDOGS_DELETION_HTTP_QA_ORIGIN,signedWebhookVerified:evidence.actualSignedStripeWebhookVerified===true,emailSimulationVerified:evidence.providerSimulationDelivered===true,emailGate:emailSink?'configured':'IDOGS_DELETION_RESEND_QA_KEY_MISSING',emailDeliveryVerified:evidence.humanRecipientProviderDelivered===true,humanInboxOpened:false,productionReady:false},null,2))
if(!passed||!cleanupVerified)process.exitCode=2
