import {createGuardedDeletionProcessor} from '../../api/_lib/deletion-processor.js'
import {digest} from '../../api/_lib/deletion-plan.js'
import {QA_RESOURCES,verifyQaBucket} from './provision-deletion-resources.mjs'

const fail=code=>Object.assign(new Error(code),{code})
export function cloudFixtureScope({db,auth,bucket,runId,manifest,env=process.env}){
 const uid=`qa-${runId}`
 function target(){
  if(!/^deletion-qa-[a-f0-9]{32}$/.test(runId||'')||db.projectId!==QA_RESOURCES.projectId||db.databaseId!==QA_RESOURCES.databaseId||auth.app.options.projectId!==QA_RESOURCES.projectId||bucket.name!==QA_RESOURCES.bucket)throw fail('CLOUD_QA_TARGET_REQUIRED')
  for(const k of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','STORAGE_EMULATOR_HOST','GOOGLE_CLOUD_UNIVERSE_DOMAIN'])if(env[k])throw fail('CLOUD_QA_ENDPOINT_OVERRIDE')
  if(manifest.uid!==uid||manifest.runId!==runId||manifest.disposable!==true||manifest.email!==`${uid}@example.invalid`||!manifest.authCreatedAt||!Array.isArray(manifest.recordPaths)||!Array.isArray(manifest.mediaPaths))throw fail('CLOUD_QA_MANIFEST_REQUIRED')
  if(manifest.recordPaths.some(p=>!new RegExp(`^(users/${uid}|(dogs|vaccineRecords|wormingRecords|documents|activityNotes)/${runId}-[a-z]+)$`).test(p))||manifest.mediaPaths.some(p=>!p.startsWith(`documents/${uid}/`)||p.includes('..')))throw fail('CLOUD_QA_MANIFEST_SCOPE')
 }
 target()
 const exact=new Set([...manifest.recordPaths,`accountDeletionRequests/${uid}`,`accountDeletionLocks/${uid}`,`accountDeletionJobs/${uid}`,`accountDeletionReceipts/${digest([uid,1])}`,`accountDeletionRenewalTasks/${uid}_1`,`supportConversations/account_deletion_${uid}`,`supportMessages/account_deletion_${uid}_1_request`,`supportMessages/account_deletion_${uid}_1_cancel`])
 const allowed=path=>exact.has(path)||new RegExp(`^accountDeletionJobs/${uid}/(operations|receipts)/[0-9]{6}$`).test(path)
 function write(ref){target();if(ref.firestore!==db||!allowed(ref.path))throw fail('CLOUD_QA_FOREIGN_WRITE_REJECTED')}
 // All worker writes go through a checked transaction. Query/inventory reads
 // stay inside the fixed isolated database. No generic batch/delete API exposed.
 const scopedDb={projectId:db.projectId,databaseId:db.databaseId,collection:db.collection.bind(db),doc:db.doc.bind(db),listCollections:db.listCollections.bind(db),runTransaction:fn=>db.runTransaction(tx=>fn(new Proxy(tx,{get(t,key){
  if(['set','update','delete','create'].includes(key))return (ref,...args)=>{write(ref);return t[key](ref,...args)}
  const value=t[key];return typeof value==='function'?value.bind(t):value
 }})))}
 async function boundAuth(id,{allowMissing=false}={}){
  target();if(id!==uid)throw fail('CLOUD_QA_FOREIGN_AUTH_REJECTED')
  try{const user=await auth.getUser(id);if(user.uid!==uid||user.email!==manifest.email||user.metadata.creationTime!==manifest.authCreatedAt)throw fail('CLOUD_QA_AUTH_BINDING_CHANGED');return user}
  catch(e){if(allowMissing&&e.code==='auth/user-not-found')return null;throw e}
 }
 const scopedAuth={app:auth.app,getUser:async id=>{const u=await boundAuth(id);return u},updateUser:async(id,changes)=>{await boundAuth(id);if(Object.keys(changes).join()!=='disabled'||changes.disabled!==true)throw fail('CLOUD_QA_AUTH_UPDATE_REJECTED');return auth.updateUser(id,changes)},revokeRefreshTokens:async id=>{await boundAuth(id);return auth.revokeRefreshTokens(id)},deleteUser:async id=>{await boundAuth(id);return auth.deleteUser(id)}}
 const scopedBucket={name:bucket.name,getFiles:bucket.getFiles.bind(bucket),file:path=>{target();if(!manifest.mediaPaths.includes(path))throw fail('CLOUD_QA_FOREIGN_MEDIA_REJECTED');return bucket.file(path)}}
 async function assertRuntime(id){
  target();if(id!==uid)throw fail('CLOUD_QA_FOREIGN_UID_REJECTED')
  const job=(await db.doc(`accountDeletionJobs/${uid}`).get()).data()
  if(!job||digest(job.qaManifest)!==digest(manifest))throw fail('CLOUD_QA_DURABLE_BINDING_CHANGED')
  verifyQaBucket((await bucket.getMetadata())[0])
  await boundAuth(uid,{allowMissing:job.authRemovalAttempted===true||job.stage==='completed'})
 }
 return {uid,db:scopedDb,auth:scopedAuth,bucket:scopedBucket,assertRuntime,assertTarget:target,boundAuth,allowed}
}

export function createCloudFixtureProcessor({scope,provider,...options}){
 if(provider?.mode!=='isolated-cloud-qa')throw fail('CLOUD_QA_PROVIDER_REQUIRED')
 return createGuardedDeletionProcessor({...options,db:scope.db,auth:scope.auth,bucket:scope.bucket,provider,assertRuntime:scope.assertRuntime,mode:'isolated-cloud-qa',confirmationMode:'qa-ledger'})
}
