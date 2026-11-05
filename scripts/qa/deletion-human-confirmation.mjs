import {digest} from '../../api/_lib/deletion-plan.js'
const ensure=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code})}
// Prepared for one owner-selected human QA inbox. It cannot activate from the
// general cloud QA flag, and never derives a recipient from customer data.
export function createHumanQaConfirmation({env,scope,db,auth,manifest,fetchImpl=fetch}){
 ensure(env.IDOGS_HUMAN_EMAIL_QA_APPROVAL==='owner-selected-qa-inbox','HUMAN_QA_RECIPIENT_APPROVAL_REQUIRED')
 ensure(/^\d+$/.test(env.GITHUB_RUN_ID||''),'HUMAN_QA_RUN_REQUIRED')
 const recipient=env.IDOGS_DELETION_QA_RECIPIENT_EMAIL,key=env.IDOGS_DELETION_RESEND_QA_KEY
 ensure(typeof recipient==='string'&&recipient.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(recipient)&&!/@(?:resend\.dev|example\.(?:invalid|com))$/i.test(recipient),'HUMAN_QA_RECIPIENT_REQUIRED')
 ensure(/^re_[A-Za-z0-9_-]+$/.test(key||''),'DELETION_RESEND_QA_KEY_REQUIRED')
 const {uid,runId}=manifest,ref=db.doc(`accountDeletionJobs/${uid}`)
 const payload={from:'iDogs <noreply@idogs.com.au>',to:[recipient],subject:'iDogs QA: disposable account deletion completed',text:'This is an iDogs QA test. A disposable synthetic QA account and its test data have been deleted. Your own iDogs account has not been deleted. No action or payment is required.'}
 async function guard(){
  await scope.assertRuntime(uid)
  const j=(await ref.get()).data()
  ensure(j?.stage==='completed'&&j.authFrozen===true&&j.authRemovalAttempted===true&&digest(j.qaManifest)===digest(manifest),'HUMAN_QA_DELETION_INCOMPLETE')
  try{await auth.getUser(uid);throw Error('HUMAN_QA_AUTH_PRESENT')}catch(e){ensure(e.code==='auth/user-not-found','HUMAN_QA_AUTH_PRESENT')}
  for(const p of manifest.recordPaths)ensure(!(await db.doc(p).get()).exists,'HUMAN_QA_DATA_PRESENT')
  for(const p of manifest.mediaPaths)ensure(!(await scope.bucket.file(p).exists())[0],'HUMAN_QA_MEDIA_PRESENT')
  return j
 }
 async function api(path,body){
  const r=await fetchImpl(`https://api.resend.com${path}`,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(body?{'Idempotency-Key':`deletion-qa-human/${env.GITHUB_RUN_ID}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
  ensure(r.ok,`HUMAN_QA_RESEND_HTTP_${r.status}`);return r.json()
 }
 return {async send(){
  const j=await guard(),recipientHash=digest(recipient.toLowerCase());let id=j.humanEmailQa?.id
  if(id)ensure(j.humanEmailQa.recipientHash===recipientHash,'HUMAN_QA_RECIPIENT_CHANGED')
  if(!id){id=(await api('/emails',payload)).id;ensure(/^[a-f0-9-]{36}$/.test(id||''),'HUMAN_QA_RECEIPT_INVALID')
   await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();ensure(current.stage==='completed'&&digest(current.qaManifest)===digest(manifest),'HUMAN_QA_BINDING_CHANGED');tx.update(ref,{humanEmailQa:{id,recipientHash,acceptedAt:new Date().toISOString()}})})}
  return {accepted:true}
 },async verify(){
  const j=await guard(),id=j.humanEmailQa?.id;ensure(/^[a-f0-9-]{36}$/.test(id||'')&&j.humanEmailQa.recipientHash===digest(recipient.toLowerCase()),'HUMAN_QA_RECEIPT_INVALID')
  const message=await api(`/emails/${id}`);ensure(message.id===id&&message.to?.length===1&&message.to[0]===recipient&&message.from===payload.from&&message.subject===payload.subject,'HUMAN_QA_READBACK_MISMATCH')
  ensure(message.last_event==='delivered','HUMAN_QA_DELIVERY_PENDING');return {humanRecipientProviderDelivered:true,humanInboxOpened:false}
 }}
}
