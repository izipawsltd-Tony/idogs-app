import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createDeletionEmailSink} from './qa/deletion-email-sink.mjs'
const uid=`qa-deletion-qa-${'a'.repeat(32)}`,runId=`deletion-qa-${'a'.repeat(32)}`,id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
function fixture(){
 const manifest={uid,runId,recordPaths:[`users/${uid}`],mediaPaths:[`documents/${uid}/test`]}
 const job={qaManifest:manifest,authFrozen:true,authRemovalAttempted:true,planReady:true}
 const ref={get:async()=>({data:()=>job})}
 const db={doc:path=>path.startsWith('accountDeletionJobs/')?ref:{get:async()=>({exists:false})},runTransaction:async fn=>fn({get:ref.get,update:(_,data)=>Object.assign(job,data)})}
 const auth={getUser:async()=>{throw Object.assign(Error(),{code:'auth/user-not-found'})}}
 const scope={assertRuntime:async()=>{},bucket:{file:()=>({exists:async()=>[false]})}}
 const requests=[]
 const fetchImpl=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>options.method==='POST'?{id}:{id,from:'iDogs <noreply@idogs.com.au>',to:['delivered@resend.dev'],subject:'iDogs deletion QA confirmation — test sink only',last_event:'delivered'}}}
 return {args:{key:'re_fixture_only',scope,db,auth,manifest,fetchImpl},job,requests,auth,db}
}
test('no key or Auth still present never sends an email',async()=>{
 const f=fixture();assert.throws(()=>createDeletionEmailSink({...f.args,key:''}),/KEY_REQUIRED/)
 f.auth.getUser=async()=>({uid})
 await assert.rejects(createDeletionEmailSink(f.args).send(),/AUTH_NOT_REMOVED/);assert.equal(f.requests.length,0)
})
test('unverified deletion intent or residual record fails before sending',async()=>{
 const f=fixture();f.job.authRemovalAttempted=false
 await assert.rejects(createDeletionEmailSink(f.args).send(),/BEFORE_AUTH_REMOVAL/)
 f.job.authRemovalAttempted=true;f.db.doc=path=>path.startsWith('accountDeletionJobs/')?{get:async()=>({data:()=>f.job})}:{get:async()=>({exists:true})}
 await assert.rejects(createDeletionEmailSink(f.args).send(),/DATA_PRESENT/);assert.equal(f.requests.length,0)
})
test('fixed simulation sink, stable idempotency and persisted receipt prevent duplicate send',async()=>{
 const f=fixture(),sink=createDeletionEmailSink(f.args)
 await sink.send();await sink.send()
 assert.equal(f.requests.length,1)
 const sent=JSON.parse(f.requests[0].options.body)
 assert.deepEqual(sent.to,['delivered@resend.dev']);assert.equal(f.requests[0].options.headers['Idempotency-Key'],`deletion-qa/${runId}/confirmation`)
 assert.deepEqual(await sink.verify(),{providerSimulationDelivered:true,humanInboxVerified:false})
})
test('provider accepted response is not delivery proof and changed recipient is rejected',async()=>{
 const f=fixture();f.job.emailQa={id}
 const sink=createDeletionEmailSink({...f.args,fetchImpl:async()=>({ok:true,json:async()=>({id,from:'iDogs <noreply@idogs.com.au>',to:['wrong@example.invalid'],subject:'iDogs deletion QA confirmation — test sink only',last_event:'delivered'})})})
 await assert.rejects(sink.verify(),/READBACK_MISMATCH/)
 const pending=createDeletionEmailSink({...f.args,fetchImpl:async()=>({ok:true,json:async()=>({id,from:'iDogs <noreply@idogs.com.au>',to:['delivered@resend.dev'],subject:'iDogs deletion QA confirmation — test sink only',last_event:'sent'})})})
 await assert.rejects(pending.verify(),/DELIVERY_PENDING/)
})
