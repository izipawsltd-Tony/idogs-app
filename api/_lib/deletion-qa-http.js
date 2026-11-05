import {makeDeletionHandler} from '../account-deletion.js'
import {assertDeletionQaWebhookRuntime} from './deletion-qa-webhook.js'
const fail=()=>Object.assign(new Error('QA_HTTP_BINDING_REQUIRED'),{status:503})
export function assertDeletionQaHttpRuntime(env){
 assertDeletionQaWebhookRuntime(env)
 if(env.IDOGS_DELETION_HTTP_QA_ENABLED!=='2026-10-26-isolated-https-fixture')throw fail()
}
// Protected Preview only. No worker, Storage, Stripe write or default DB access.
export function makePublicDeletionQaHandler({db,auth,assertRuntime}){
 if(db.projectId!=='idogs-app-staging'||db.databaseId!=='idogs-deletion-qa'||auth.app.options.projectId!=='idogs-app-staging'||typeof assertRuntime!=='function')throw fail()
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store')
  try{assertRuntime()}catch{return res.status(503).json({error:'Isolated QA unavailable'})}
  const authenticate=async token=>{
   const decoded=await auth.verifyIdToken(token,true),uid=decoded.uid
   if(!/^qa-deletion-qa-[a-f0-9]{32}$/.test(uid||''))throw fail()
   const runId=uid.slice(3),m=(await db.doc(`accountDeletionJobs/${uid}`).get()).data()?.qaManifest
   const user=await auth.getUser(uid)
   if(!m||m.disposable!==true||m.uid!==uid||m.runId!==runId||m.email!==`${uid}@example.invalid`||user.email!==m.email||user.metadata.creationTime!==m.authCreatedAt)throw fail()
   assertRuntime();return decoded
  }
  let activeUid
  const scopedDb={collection:db.collection.bind(db),runTransaction:fn=>db.runTransaction(tx=>fn(new Proxy(tx,{get(t,key){
   if(['set','update','create','delete'].includes(key))return(ref,...args)=>{
    assertRuntime()
    const allowed=new Set([`accountDeletionRequests/${activeUid}`,`accountDeletionRenewalTasks/${activeUid}_1`,`supportConversations/account_deletion_${activeUid}`,`supportMessages/account_deletion_${activeUid}_1_request`,`supportMessages/account_deletion_${activeUid}_1_cancel`])
    if(ref.firestore!==db||!allowed.has(ref.path))throw fail()
    return t[key](ref,...args)
   }
   const value=t[key];return typeof value==='function'?value.bind(t):value
  }})))}
  return makeDeletionHandler({db:scopedDb,authenticate:async token=>{const decoded=await authenticate(token);activeUid=decoded.uid;return decoded}})(req,res)
 }
}
