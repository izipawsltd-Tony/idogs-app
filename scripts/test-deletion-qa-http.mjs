import {test} from 'node:test'
import assert from 'node:assert/strict'
import {makePublicDeletionQaHandler,assertDeletionQaHttpRuntime} from '../api/_lib/deletion-qa-http.js'
function fixture(){
 const uid=`qa-deletion-qa-${'a'.repeat(32)}`,runId=uid.slice(3),email=`${uid}@example.invalid`,docs=new Map(),writes=[]
 const manifest={uid,runId,email,disposable:true,authCreatedAt:'fixture-time'}
 docs.set(`accountDeletionJobs/${uid}`,{qaManifest:manifest})
 const snap=path=>({exists:docs.has(path),data:()=>docs.get(path)})
 const db={projectId:'idogs-app-staging',databaseId:'idogs-deletion-qa',doc:path=>({path,id:path.split('/').at(-1),firestore:db,get:async()=>snap(path)}),collection:name=>({doc:id=>db.doc(`${name}/${id}`)}),runTransaction:async fn=>fn({get:async ref=>snap(ref.path),set:(ref,value)=>{writes.push(ref.path);docs.set(ref.path,value)}})}
 const auth={app:{options:{projectId:'idogs-app-staging'}},verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);if(token!=='valid')throw Error();return {uid,email,auth_time:Math.floor(Date.now()/1000)}},getUser:async()=>({email,metadata:{creationTime:'fixture-time'}})}
 let enabled=true
 const handler=makePublicDeletionQaHandler({db,auth,assertRuntime:()=>{if(!enabled)throw Error()}})
 const call=async({method='GET',token='valid',body}={})=>{const result={headers:{}};const res={setHeader:(k,v)=>result.headers[k]=v,status:code=>{result.status=code;return res},json:value=>{result.body=value;return res}};await handler({method,headers:{authorization:token?`Bearer ${token}`:''},body},res);return result}
 return {uid,db,auth,docs,writes,manifest,call,disable:()=>enabled=false}
}
test('QA HTTPS target refuses default database and Production identity',()=>{
 const f=fixture();for(const patch of [{databaseId:'(default)'},{projectId:'idogs-app'}])assert.throws(()=>makePublicDeletionQaHandler({db:{...f.db,...patch},auth:f.auth,assertRuntime:()=>{}}))
 assert.throws(()=>assertDeletionQaHttpRuntime({VERCEL_ENV:'production'}))
})
test('anonymous, bad token, foreign UID and recreated Auth are rejected without writes',async()=>{
 for(const change of [f=>{f.auth.verifyIdToken=async()=>{throw Error()}},f=>{f.auth.verifyIdToken=async()=>({uid:'real-user'})},f=>{f.auth.getUser=async()=>({email:f.manifest.email,metadata:{creationTime:'recreated'}})},f=>{f.manifest.disposable=false}]){
  const f=fixture();change(f);const result=await f.call({token:'valid'});assert.equal(result.status,401);assert.equal(f.writes.length,0)
 }
 const f=fixture();assert.equal((await f.call({token:null})).status,401)
})
test('expiry blocks even a valid token before any write',async()=>{const f=fixture();f.disable();assert.equal((await f.call()).status,503);assert.equal(f.writes.length,0)})
test('request duplicate and cancel use only the bound fixture control records',async()=>{
 const f=fixture(),body={action:'request',confirmation:'DELETE MY ACCOUNT'}
 const first=await f.call({method:'POST',body});assert.equal(first.status,200);assert.equal(first.body.status,'requested')
 const count=f.writes.length;const duplicate=await f.call({method:'POST',body});assert.equal(duplicate.body.requestedAt,first.body.requestedAt);assert.equal(f.writes.length,count)
 const cancel=await f.call({method:'POST',body:{action:'cancel'}});assert.equal(cancel.status,200);assert.equal(cancel.body.status,'cancelled')
 assert(f.writes.every(path=>path.includes(f.uid)));assert.equal(first.headers['Cache-Control'],'private, no-store')
})
test('unapproved second revision is refused by the write fence',async()=>{
 const f=fixture();f.docs.set(`accountDeletionRequests/${f.uid}`,{uid:f.uid,revision:1,status:'cancelled',updatedAt:new Date(Date.now()-120000).toISOString()})
 assert.equal((await f.call({method:'POST',body:{action:'request',confirmation:'DELETE MY ACCOUNT'}})).status,503)
 assert(!f.writes.some(p=>p.endsWith('_2')))
})
