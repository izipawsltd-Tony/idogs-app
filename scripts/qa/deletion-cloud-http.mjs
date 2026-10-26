import {createServer} from 'node:http'
import {makeDeletionHandler} from '../../api/account-deletion.js'
const ensure=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code})}
const project='idogs-app-staging',projectNumber='530003937245'

export async function signInCloudFixture({auth,uid,credential,fetchImpl=fetch}){
 ensure(auth.app.options.projectId===project&&/^qa-deletion-qa-[a-f0-9]{32}$/.test(uid),'QA_HTTP_TARGET_REQUIRED')
 const access=await credential.getAccessToken()
 async function firebaseRead(path){
  ensure(path.startsWith(`projects/${project}/webApps`),'QA_CONFIG_PATH_REJECTED')
  const r=await fetchImpl(`https://firebase.googleapis.com/v1beta1/${path}`,{headers:{Authorization:`Bearer ${access.access_token}`},signal:AbortSignal.timeout(30000)})
  ensure(r.ok,`QA_WEB_CONFIG_HTTP_${r.status}`);return r.json()
 }
 const apps=await firebaseRead(`projects/${project}/webApps?pageSize=100`)
 ensure(!apps.nextPageToken&&apps.apps?.length>0,'QA_WEB_APP_INVENTORY_INCOMPLETE')
 const app=apps.apps.find(a=>a.appId?.startsWith(`1:${projectNumber}:web:`))
 ensure(app,'QA_WEB_APP_IDENTITY_MISMATCH')
 const config=await firebaseRead(`projects/${project}/webApps/${app.appId}/config`)
 ensure(config.projectId===project&&config.appId===app.appId&&config.messagingSenderId===projectNumber&&/^AIza[A-Za-z0-9_-]+$/.test(config.apiKey||''),'QA_WEB_CONFIG_IDENTITY_MISMATCH')
 const custom=await auth.createCustomToken(uid)
 const r=await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(config.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true}),signal:AbortSignal.timeout(30000)})
 ensure(r.ok,`QA_SIGN_IN_HTTP_${r.status}`)
 // This endpoint returns an ID token, not a localId field. Bind UID to the
 // cryptographically verified Firebase token below, never an unverified body.
 const result=await r.json();ensure(typeof result.idToken==='string'&&result.idToken.length>0,'QA_SIGN_IN_TOKEN_MISSING')
 const verified=await auth.verifyIdToken(result.idToken,true)
 ensure(verified.uid===uid&&verified.aud===project&&verified.iss===`https://securetoken.google.com/${project}`,'QA_SIGN_IN_TOKEN_IDENTITY_MISMATCH')
 return result.idToken
}

export async function loopbackDeletionApi({db,auth,uid}){
 ensure(db.projectId===project&&db.databaseId==='idogs-deletion-qa'&&auth.app.options.projectId===project&&/^qa-deletion-qa-[a-f0-9]{32}$/.test(uid),'QA_HTTP_TARGET_REQUIRED')
 const handler=makeDeletionHandler({db,authenticate:async token=>{
  const decoded=await auth.verifyIdToken(token,true)
  ensure(decoded.uid===uid,'QA_HTTP_FOREIGN_UID');return decoded
 }})
 const server=createServer(async(req,res)=>{
  res.status=code=>{res.statusCode=code;return res};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res}
  if(req.url!=='/api/account-deletion')return res.status(404).json({error:'Not found'})
  try{let body='';for await(const chunk of req){body+=chunk;ensure(body.length<=2048,'QA_HTTP_BODY_TOO_LARGE')};req.body=body?JSON.parse(body):undefined;await handler(req,res)}
  catch{if(!res.headersSent)res.status(400).json({error:'Invalid request'})}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const origin=`http://127.0.0.1:${server.address().port}`
 return {call:async({token,method='GET',body}={})=>{
  const r=await fetch(`${origin}/api/account-deletion`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
  return {status:r.status,cacheControl:r.headers.get('cache-control'),body:await r.json()}
 },close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
}

export function protectedPreviewDeletionApi({origin,bypass,fetchImpl=fetch}){
 ensure(/^https:\/\/idogs-app-staging-[a-z0-9-]+\.vercel\.app$/.test(origin||'')&&typeof bypass==='string'&&bypass.length>=16,'QA_PUBLIC_HTTP_TARGET_REQUIRED')
 return {call:async({token,method='GET',body}={})=>{
  const r=await fetchImpl(`${origin}/api/qa/deletion-account`,{method,redirect:'error',headers:{'Content-Type':'application/json','x-vercel-protection-bypass':bypass,...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
  return {status:r.status,cacheControl:r.headers.get('cache-control'),body:await r.json()}
 },close:async()=>{}}
}
