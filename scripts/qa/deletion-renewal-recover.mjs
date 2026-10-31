import {pathToFileURL} from 'node:url'
import {writeFile} from 'node:fs/promises'
import {stagingDeletionConfiguration} from './deletion-staging-readiness.mjs'
import {QA_RESOURCES,verifyQaBucket,verifyQaDatabase} from './provision-deletion-resources.mjs'
import {cloudFixtureScope} from './deletion-cloud-runtime.mjs'
import {cleanupRenewalReceipts} from './deletion-renewal-cleanup.mjs'
import {digest} from '../../api/_lib/deletion-plan.js'

export const RECOVERY=Object.freeze({run:40843318324,job:123344697039,sha:'e55c4d6adfa60335d7e1f7b578cc2daa87a2e017',fixture:'deletion-qa-afe48e556bfa43a595c6276939440179'})
const ensure=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code})}
export function verifyRecoveryOrigin({run,job,logs}){
 ensure(run?.id===RECOVERY.run&&run.head_sha===RECOVERY.sha&&run.head_branch==='release/ios-app-store-20261025'
  &&run.path==='.github/workflows/deletion-cloud-permanent.yml'&&run.event==='push'&&run.status==='completed'&&run.conclusion==='failure'
  &&job?.id===RECOVERY.job&&job.run_id===run.id&&job.conclusion==='failure'
  &&job.steps?.some(s=>s.name==='Real isolated Firebase deletion and Stripe Test readback'&&s.conclusion==='failure')
  &&typeof logs==='string'&&logs.includes(`"fixtureRunId": "${RECOVERY.fixture}"`)
  &&logs.includes('"durableRenewalDispatchVerified": true')&&logs.includes('"renewalBeforeAuthRemovalVerified": true')
  &&logs.includes('"cleanupVerified": false')&&/"step": "firebase_fixture",[\s\S]{0,1000}"status": "failed"/.test(logs),'QA_RECOVERY_ORIGIN_UNVERIFIED')
}

export async function recoverOriginalRenewalFixture({db,auth,bucket,evidence,save}){
 verifyRecoveryOrigin(evidence)
 const runId=RECOVERY.fixture,uid=`qa-${runId}`,jobRef=db.doc(`accountDeletionJobs/${uid}`),jobSnap=await jobRef.get(),j=jobSnap.data(),manifest=j?.qaManifest
 const recordPaths=[`users/${uid}`,`dogs/${runId}-dog`,`vaccineRecords/${runId}-vaccine`,`wormingRecords/${runId}-worm`,`documents/${runId}-document`]
 ensure(manifest?.uid===uid&&manifest.runId===runId&&manifest.disposable===true&&manifest.email===`${uid}@example.invalid`
  &&digest(manifest.recordPaths)===digest(recordPaths)&&digest(manifest.mediaPaths)===digest([`documents/${uid}/proof.txt`,`documents/${uid}/orphan.txt`])
  &&j.stage==='completed'&&j.mode==='isolated-cloud-qa'&&j.revision===1&&j.leaseUntil===0,'QA_RECOVERY_MANIFEST_CHANGED')
 const scope=cloudFixtureScope({db,auth,bucket,manifest,runId})
 await scope.assertRuntime(uid)
 await save({manifest,origin:RECOVERY,jobHash:digest(j),status:'verified_before_cleanup'})
 for(const path of recordPaths)ensure(!(await db.doc(path).get()).exists,'QA_RECOVERY_RECORD_REAPPEARED')
 for(const path of manifest.mediaPaths)ensure(!(await bucket.file(path).exists())[0],'QA_RECOVERY_MEDIA_REAPPEARED')
 try{await auth.getUser(uid);throw Object.assign(new Error(),{code:'QA_RECOVERY_AUTH_REAPPEARED'})}catch(e){ensure(e.code==='auth/user-not-found','QA_RECOVERY_AUTH_REAPPEARED')}
 const request=db.doc(`accountDeletionRequests/${uid}`),lock=db.doc(`accountDeletionLocks/${uid}`)
 const [rs,ls]=await Promise.all([request.get(),lock.get()])
 ensure(rs.data()?.uid===uid&&rs.data().revision===1&&rs.data().status==='completed'&&ls.data()?.revision===1&&ls.data().state==='completed','QA_RECOVERY_LEDGER_CHANGED')
 ensure(Number.isSafeInteger(j.operationCount)&&j.operationCount>0&&j.operationCount<=200&&j.operationHashes?.length===j.operationCount,'QA_RECOVERY_OPERATIONS_CHANGED')
 const collections=await jobRef.listCollections()
 ensure(collections.every(c=>['operations','receipts'].includes(c.id)),'QA_RECOVERY_COLLECTION_CHANGED')
 const [ops,receipts]=await Promise.all(['operations','receipts'].map(name=>jobRef.collection(name).limit(201).get()))
 ensure(ops.size===j.operationCount&&receipts.size===j.operationCount,'QA_RECOVERY_OPERATIONS_CHANGED')
 for(const snap of ops.docs){
  const {index,revision,...op}=snap.data()
  ensure(Number.isSafeInteger(index)&&index>=0&&index<j.operationCount&&snap.id===String(index).padStart(6,'0')&&revision===1
   &&digest(op)===j.operationHashes[index]&&(op.kind==='media'?manifest.mediaPaths.includes(op.path):scope.allowed(op.path)),'QA_RECOVERY_OPERATION_CHANGED')
 }
 for(const snap of receipts.docs){const op=ops.docs.find(o=>o.id===snap.id)?.data(),r=snap.data();ensure(op&&r.revision===1&&r.kind===op.kind&&Number.isFinite(Date.parse(r.at)),'QA_RECOVERY_OPERATION_RECEIPT_CHANGED')}
 const sentinel=db.doc(`dogs/${runId}-sentinel`),ss=await sentinel.get()
 ensure(ss.exists&&digest(ss.data())===digest({currentOwnerId:`qa-other-${runId}`,tenantId:`qa-other-${runId}`,name:'Unrelated QA sentinel',deletionQaRunId:runId}),'QA_RECOVERY_SENTINEL_CHANGED')
 const taskBefore=await db.doc(`accountDeletionRenewalTasks/${uid}_1`).get()
 ensure(taskBefore.exists&&taskBefore.data().uid===uid&&taskBefore.data().revision===1&&taskBefore.data().dispatchState==='completed','QA_RECOVERY_RENEWAL_TASK_CHANGED')
 await cleanupRenewalReceipts({scope,db,manifest})
 const roots=[jobRef,request,lock,sentinel,db.doc(`accountDeletionReceipts/${digest([uid,1])}`),db.doc(`accountDeletionRenewalTasks/${uid}_1`),
  db.doc(`supportConversations/account_deletion_${uid}`),db.doc(`supportMessages/account_deletion_${uid}_1_request`)]
 const snapshots=await Promise.all(roots.map(ref=>ref.get())),all=[...snapshots,...ops.docs,...receipts.docs]
 ensure(digest(snapshots[0].data())===digest(j)&&digest(snapshots[1].data())===digest(rs.data())
  &&digest(snapshots[2].data())===digest(ls.data())&&digest(snapshots[3].data())===digest(ss.data())
  &&snapshots[4].data()?.revision===1&&snapshots[4].data().fingerprint===j.fingerprint
  &&digest(snapshots[5].data())===digest(taskBefore.data()),'QA_RECOVERY_LEDGER_CHANGED')
 ensure(all.length<=450,'QA_RECOVERY_DELETE_LIMIT')
 for(const snap of snapshots){if(snap.exists&&snap.ref.path.startsWith('support')){const d=snap.data();ensure(d.ownerUid===uid||d.senderUid===uid,'QA_RECOVERY_SUPPORT_CHANGED')}}
 // One atomic, content-checked delete set. No recursive delete or resource list.
 await db.runTransaction(async tx=>{
  const latest=await Promise.all(all.map(s=>tx.get(s.ref)))
  for(let i=0;i<all.length;i++)ensure(latest[i].exists===all[i].exists&&(!all[i].exists||digest(latest[i].data())===digest(all[i].data())),'QA_RECOVERY_CONTENT_CHANGED')
  for(const snap of all)if(snap.exists)tx.delete(snap.ref)
 })
 for(const ref of roots)ensure(!(await ref.get()).exists,'QA_RECOVERY_ROOT_REMAINS')
 for(const name of ['operations','receipts'])ensure((await jobRef.collection(name).limit(1).get()).empty,'QA_RECOVERY_OPERATION_REMAINS')
 ensure((await db.doc(`accountDeletionRenewalTasks/${uid}_1`).collection('receipts').limit(1).get()).empty,'QA_RECOVERY_RENEWAL_RECEIPT_REMAINS')
 return {status:'original_fixture_cleanup_pass',originRun:RECOVERY.run,cleanupVerified:true,productionReady:false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let app
 try{
  ensure(process.env.GH_TOKEN,'QA_RECOVERY_GITHUB_AUTH_REQUIRED')
  const get=async(path,raw=false)=>{const r=await fetch(`https://api.github.com/repos/izipawsltd-Tony/idogs-app/${path}`,{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});ensure(r.ok,'QA_RECOVERY_EVIDENCE_UNAVAILABLE');return raw?r.text():r.json()}
  const [run,job,logs]=await Promise.all([get(`actions/runs/${RECOVERY.run}`),get(`actions/jobs/${RECOVERY.job}`),get(`actions/jobs/${RECOVERY.job}/logs`,true)])
  verifyRecoveryOrigin({run,job,logs})
  const config=stagingDeletionConfiguration(process.env);ensure(config.status==='configured','QA_RECOVERY_CREDENTIALS_REQUIRED')
  const [{initializeApp,cert},{getFirestore},{getAuth},{Storage}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/firestore'),import('firebase-admin/auth'),import('@google-cloud/storage')])
  const credential=cert(config.credential)
  app=initializeApp({credential,projectId:QA_RESOURCES.projectId},'original-renewal-cleanup')
  const db=getFirestore(app,QA_RESOURCES.databaseId),auth=getAuth(app),bucket=new Storage({projectId:QA_RESOURCES.projectId,credentials:config.credential}).bucket(QA_RESOURCES.bucket)
  verifyQaBucket((await bucket.getMetadata())[0])
  const token=await credential.getAccessToken(),r=await fetch(`https://firestore.googleapis.com/v1/projects/${QA_RESOURCES.projectId}/databases/${QA_RESOURCES.databaseId}`,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(30000)})
  ensure(r.ok,'QA_RECOVERY_METADATA_UNAVAILABLE');verifyQaDatabase(await r.json())
  const result=await recoverOriginalRenewalFixture({db,auth,bucket,evidence:{run,job,logs},save:data=>writeFile('renewal-cleanup-recovery-manifest.json',JSON.stringify(data,null,2))})
  await writeFile('renewal-cleanup-recovery-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
 }catch(e){const result={status:'blocked',code:/^[A-Z_0-9]{3,100}$/.test(e.code||'')?e.code:'QA_RECOVERY_FAILED',productionReady:false};await writeFile('renewal-cleanup-recovery-result.json',JSON.stringify(result));console.log(JSON.stringify(result));process.exitCode=2}
 finally{if(app){const {deleteApp}=await import('firebase-admin/app');await deleteApp(app)}}
}
