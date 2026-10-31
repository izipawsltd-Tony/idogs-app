import {randomUUID} from 'node:crypto'
import {RETENTION_QA as target,retentionCredential,verifyRetentionBucket} from './provision-retention-bucket.mjs'
import {cloudFixtureScope,createCloudFixtureProcessor} from './deletion-cloud-runtime.mjs'
import {digest} from '../../api/_lib/deletion-plan.js'
const ensure=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code})}
let app,db,phase='configuration';const report={status:'blocked',actualSevenDayLifecyclePassed:false,productionReady:false}
try{
 const credential=retentionCredential(process.env),session=process.env.GITHUB_RUN_ID
 ensure(/^\d+$/.test(session||''),'RETENTION_SESSION_REQUIRED')
 const [{initializeApp,cert},{getFirestore},{getAuth},{Storage}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/firestore'),import('firebase-admin/auth'),import('@google-cloud/storage')])
 app=initializeApp({projectId:target.projectId,credential:cert(credential)},`retention-${session}`)
 db=getFirestore(app,target.databaseId);const auth=getAuth(app),bucket=new Storage({projectId:target.projectId,credentials:credential}).bucket(target.bucket)
 verifyRetentionBucket((await bucket.getMetadata())[0])
 const master=db.doc(`accountDeletionJobs/retention-session-${session}`)
 await db.runTransaction(async tx=>{if(!(await tx.get(master)).exists)tx.create(master,{runId:`deletion-qa-${randomUUID().replaceAll('-','')}`,source:process.env.GITHUB_SHA,status:'allocated'})})
 let state=(await master.get()).data();ensure(state.source===process.env.GITHUB_SHA,'RETENTION_SOURCE_CHANGED')
 if(state.status==='completed'){report.status='seven_day_lifecycle_pass';report.actualSevenDayLifecyclePassed=true}
 else{
 const runId=state.runId,uid=`qa-${runId}`,email=`${uid}@example.invalid`,jobRef=db.doc(`accountDeletionJobs/${uid}`)
 ensure(/^deletion-qa-[a-f0-9]{32}$/.test(runId),'RETENTION_MANIFEST_INVALID')
 const save=async update=>{await master.update(update);state={...state,...update}}
 phase='seed_fixture'
 if(!state.manifest){
  let user;try{user=await auth.getUser(uid)}catch(e){if(e.code!=='auth/user-not-found')throw e;user=await auth.createUser({uid,email,displayName:runId})}
  ensure(user.email===email&&user.displayName===runId,'RETENTION_AUTH_CHANGED')
  const manifest={uid,email,runId,disposable:true,storageMode:'seven-day',bucket:target.bucket,authCreatedAt:user.metadata.creationTime,recordPaths:[`users/${uid}`,`dogs/${runId}-dog`,`documents/${runId}-document`],mediaPaths:[`documents/${uid}/proof.txt`]}
  await save({manifest})
 }
 const manifest=state.manifest;ensure(manifest.uid===uid&&manifest.bucket===target.bucket,'RETENTION_BINDING_CHANGED')
 const file=bucket.file(manifest.mediaPaths[0]),bytes=Buffer.from('Disposable seven-day QA fixture; no personal data')
 if(!state.seeded){
  ensure(!(await jobRef.get()).data()?.planReady,'RETENTION_RESEED_REJECTED')
  const batch=db.batch();batch.set(jobRef,{revision:1,leaseUntil:0,qaManifest:manifest})
  batch.set(db.doc(manifest.recordPaths[0]),{email,role:'owner',plan:'free',deletionQaRunId:runId})
  batch.set(db.doc(manifest.recordPaths[1]),{tenantId:uid,currentOwnerId:uid,name:'Disposable retention dog',deletionQaRunId:runId})
  batch.set(db.doc(manifest.recordPaths[2]),{tenantId:uid,dogId:`${runId}-dog`,filePath:file.name,deletionQaRunId:runId})
  batch.set(db.doc(`accountDeletionRequests/${uid}`),{uid,revision:1,status:'requested',requestedAt:new Date().toISOString()});await batch.commit()
  if(!(await file.exists())[0])await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{metadata:{deletionQaRunId:runId}}})
  const [m]=await file.getMetadata();ensure(m.metadata?.deletionQaRunId===runId,'RETENTION_FILE_CHANGED')
  await save({seeded:true,originalGeneration:String(m.generation)})
 }
 const scope=cloudFixtureScope({db,auth,bucket,runId,manifest,retentionMode:'seven-day'})
 const inventory=async()=>{const [files,next]=await bucket.getFiles({prefix:`documents/${uid}/`,softDeleted:true,autoPaginate:false,maxResults:100});ensure(!next,'RETENTION_INVENTORY_TRUNCATED');return files.map(f=>{const m=f.metadata;ensure(f.name===file.name&&m.metadata?.deletionQaRunId===runId&&Number.isFinite(Date.parse(m.hardDeleteTime))&&Number.isFinite(Date.parse(m.softDeleteTime)),'RETENTION_COPY_INVALID');return {generation:String(m.generation),softDeleteTime:m.softDeleteTime,hardDeleteTime:m.hardDeleteTime}})}
 let recoveryVerified=false
 const provider={mode:'isolated-cloud-qa',discover:async id=>{ensure(id===uid,'RETENTION_UID_CHANGED');return {uid,complete:true,subscriptions:[]}},retention:async()=>({uid,verified:true,restoreReplayVerified:true,mediaIngressDrained:true,storageRetentionSeconds:604800,storageRecoveryVerified:recoveryVerified}),confirm:async()=>{ensure(recoveryVerified,'RETENTION_RECOVERY_NOT_VERIFIED');try{await auth.getUser(uid);throw Error('RETENTION_AUTH_REMAINS')}catch(e){ensure(e.code==='auth/user-not-found','RETENTION_AUTH_REMAINS')}return {uid,accepted:true,mode:'qa-ledger'}}}
 const processFixture=()=>createCloudFixtureProcessor({scope,provider}).process({uid,revision:1})
 const incomplete=async()=>{ensure((await auth.getUser(uid)).disabled===true,'RETENTION_AUTH_NOT_FROZEN');ensure((await db.doc(`accountDeletionRequests/${uid}`).get()).data()?.status!=='completed','RETENTION_PREMATURE_COMPLETION');ensure(!(await db.doc(`accountDeletionReceipts/${digest([uid,1])}`).get()).exists,'RETENTION_PREMATURE_RECEIPT')}
 if(!state.restoreVerified){
  phase='initial_soft_delete'
  if(!(await jobRef.get()).data()?.planReady){const first=await processFixture();ensure(first.status==='held'&&first.code==='storage_retention_pending','RETENTION_INITIAL_HOLD_MISSING')}
  await incomplete()
  const copies=await inventory();ensure(copies.some(c=>c.generation===state.originalGeneration),'RETENTION_ORIGINAL_COPY_MISSING');await save({copies})
  phase='restore_and_replay'
  if(!(await file.exists())[0]){const generation=Number(state.originalGeneration);ensure(Number.isSafeInteger(generation)&&String(generation)===state.originalGeneration,'RETENTION_GENERATION_INVALID');await file.restore({generation,ifGenerationMatch:0})}
  const [restored]=await file.getMetadata();ensure(restored.metadata?.deletionQaRunId===runId&&String(restored.generation)!==state.originalGeneration,'RETENTION_RESTORE_INVALID')
  ensure((await file.download())[0].equals(bytes),'RETENTION_RESTORE_CONTENT_CHANGED')
  await save({restoredGeneration:String(restored.generation)})
  let rejected=false;try{await processFixture()}catch(e){ensure(e.code==='MEDIA_REMOVAL_UNCONFIRMED','RETENTION_REPLAY_UNEXPECTED');rejected=true}ensure(rejected,'RETENTION_RESTORE_NOT_BLOCKED');await incomplete()
  await file.delete({ifGenerationMatch:restored.generation})
  const all=await inventory();ensure(all.some(c=>c.generation===state.originalGeneration)&&all.some(c=>c.generation===state.restoredGeneration),'RETENTION_REDELETE_COPY_MISSING')
  const dueAt=new Date(Math.max(...all.map(c=>Date.parse(c.hardDeleteTime)))).toISOString()
  await save({restoreVerified:true,copies:all,dueAt,status:'waiting_for_cloud_expiry'})
 }
 phase='verify_real_retention'
 const copies=await inventory();await incomplete()
 if(copies.length||Date.now()<=Date.parse(state.dueAt)){
  const held=await processFixture();ensure(held.status==='held','RETENTION_EXPECTED_HOLD');await incomplete()
  Object.assign(report,{status:'waiting_for_cloud_expiry',dueAt:state.dueAt,restoreReplayVerified:true,recoverableCopies:copies.length,accountFrozen:true,completionWithheld:true})
 }else{
  ensure(!(await file.exists())[0],'RETENTION_LIVE_COPY_REMAINS')
  for(const c of state.copies){try{await bucket.file(file.name,{generation:c.generation}).getMetadata();throw Error('RETENTION_GENERATION_REMAINS')}catch(e){ensure(Number(e.code)===404,'RETENTION_GENERATION_REMAINS')}
   try{await file.get({generation:Number(c.generation),softDeleted:true});throw Error('RETENTION_SOFT_COPY_REMAINS')}catch(e){ensure(Number(e.code)===404,'RETENTION_SOFT_COPY_REMAINS')}}
  recoveryVerified=true;ensure((await processFixture()).status==='completed','RETENTION_FINAL_NOT_COMPLETED')
  for(const p of manifest.recordPaths)ensure(!(await db.doc(p).get()).exists,'RETENTION_RECORD_REMAINS')
  const receipt=(await db.doc(`accountDeletionReceipts/${digest([uid,1])}`).get()).data();ensure(receipt?.confirmation==='qa-ledger-no-email','RETENTION_RECEIPT_INVALID')
  await save({status:'completed',completedAt:new Date().toISOString()});Object.assign(report,{status:'seven_day_lifecycle_pass',actualSevenDayLifecyclePassed:true,dueAt:state.dueAt})
 }
 }
}catch(e){report.code=/^[A-Za-z0-9_/-]{1,100}$/.test(String(e.code||''))?String(e.code):'RETENTION_LIFECYCLE_FAILED'}
finally{if(app){const {deleteApp}=await import('firebase-admin/app');await deleteApp(app)}}
console.log(JSON.stringify({...report,phase},null,2));if(report.status==='blocked')process.exitCode=2
