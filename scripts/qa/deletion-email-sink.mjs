import {digest} from '../../api/_lib/deletion-plan.js'
const ensure=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code})}
// Only Resend's documented simulation sink. No recipient parameter, human
// inbox, marketing content, credential output or Production activation.
export function createDeletionEmailSink({key,scope,db,auth,manifest,fetchImpl=fetch}){
 ensure(/^re_[A-Za-z0-9_-]+$/.test(key||''),'DELETION_RESEND_QA_KEY_REQUIRED')
 const {uid,runId}=manifest,ref=db.doc(`accountDeletionJobs/${uid}`)
 const payload={from:'iDogs <noreply@idogs.com.au>',to:['delivered@resend.dev'],subject:'iDogs deletion QA confirmation — test sink only',text:`Controlled QA ${runId}: the disposable account and its fixture data have been removed. This is a provider simulation test, not a customer email.`}
 async function guard(){
  await scope.assertRuntime(uid)
  const j=(await ref.get()).data()
  ensure(j?.authRemovalAttempted===true&&j.authFrozen===true&&j.planReady===true&&digest(j.qaManifest)===digest(manifest),'QA_EMAIL_BEFORE_AUTH_REMOVAL')
  try{await auth.getUser(uid);throw Error('QA_EMAIL_AUTH_PRESENT')}catch(e){ensure(e.code==='auth/user-not-found','QA_EMAIL_AUTH_NOT_REMOVED')}
  for(const path of manifest.recordPaths)ensure(!(await db.doc(path).get()).exists,'QA_EMAIL_DATA_PRESENT')
  for(const path of manifest.mediaPaths)ensure(!(await scope.bucket.file(path).exists())[0],'QA_EMAIL_MEDIA_PRESENT')
  return j
 }
 async function api(path,{method='GET',body}={}){
  ensure(/^\/emails(?:\/[a-f0-9-]{36})?$/.test(path),'QA_EMAIL_PATH_REJECTED')
  const r=await fetchImpl(`https://api.resend.com${path}`,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(method==='POST'?{'Idempotency-Key':`deletion-qa/${runId}/confirmation`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
  ensure(r.ok,`QA_RESEND_HTTP_${r.status}`);return r.json()
 }
 return {async send(){
  const job=await guard();let id=job.emailQa?.id
  if(!id){const result=await api('/emails',{method:'POST',body:payload});ensure(/^[a-f0-9-]{36}$/.test(result.id||''),'QA_RESEND_RESPONSE_INVALID');id=result.id
   await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();ensure(digest(current.qaManifest)===digest(manifest)&&current.authRemovalAttempted===true,'QA_EMAIL_BINDING_CHANGED');tx.update(ref,{emailQa:{id,mode:'resend-simulation-sink',acceptedAt:new Date().toISOString()}})})}
  return {accepted:true,mode:'resend-simulation-sink'}
 },async verify(){
  const job=await guard(),id=job.emailQa?.id;ensure(/^[a-f0-9-]{36}$/.test(id||''),'QA_EMAIL_RECEIPT_MISSING')
  const email=await api(`/emails/${id}`)
  ensure(email.id===id&&email.to?.length===1&&email.to[0]==='delivered@resend.dev'&&email.subject===payload.subject&&email.from===payload.from,'QA_RESEND_READBACK_MISMATCH')
  ensure(email.last_event==='delivered','QA_RESEND_DELIVERY_PENDING')
  return {providerSimulationDelivered:true,humanInboxVerified:false}
 }}
}
