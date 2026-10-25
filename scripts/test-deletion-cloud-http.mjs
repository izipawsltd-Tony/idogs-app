import {test} from 'node:test'
import assert from 'node:assert/strict'
import {signInCloudFixture,loopbackDeletionApi} from './qa/deletion-cloud-http.mjs'
const uid=`qa-deletion-qa-${'a'.repeat(32)}`,project='idogs-app-staging'
test('real token acquisition rejects wrong target and wrong web config before minting token',async()=>{
 let minted=0
 const auth={app:{options:{projectId:project}},createCustomToken:async()=>{minted++;return 'not-used'}}
 const credential={getAccessToken:async()=>({access_token:'fixture-only'})}
 const appId='1:530003937245:web:qa'
 const fetchImpl=async url=>({ok:true,json:async()=>url.includes('/config')?{projectId:'idogs-app',appId,apiKey:'AIza-qa',messagingSenderId:'530003937245'}:{apps:[{appId}]}})
 await assert.rejects(signInCloudFixture({auth,uid,credential,fetchImpl}),/CONFIG_IDENTITY/)
 await assert.rejects(signInCloudFixture({auth,uid:'real-user',credential,fetchImpl}),/TARGET/)
 assert.equal(minted,0)
})
test('HTTP adapter denies anonymous, invalid and foreign tokens without database reads',async()=>{
 let reads=0
 const db={projectId:project,databaseId:'idogs-deletion-qa',collection:()=>({doc:()=>({get:async()=>{reads++;return {exists:false}}})})}
 const auth={app:{options:{projectId:project}},verifyIdToken:async t=>{if(t==='invalid')throw Error('invalid');return {uid:t==='foreign'?'other-user':uid}}}
 const api=await loopbackDeletionApi({db,auth,uid})
 try{
  for(const token of [undefined,'invalid','foreign'])assert.equal((await api.call({token})).status,401)
  assert.equal(reads,0)
  const ok=await api.call({token:'fixture-only'});assert.equal(ok.status,200);assert.equal(ok.body.status,'none');assert.equal(ok.cacheControl,'private, no-store');assert.equal(reads,1)
  assert.equal((await api.call({token:'fixture-only',method:'DELETE'})).status,405)
 }finally{await api.close()}
})
test('custom-token REST response needs no localId; verified token must bind UID, audience and issuer',async()=>{
 const appId='1:530003937245:web:qa'
 let decoded={uid,aud:project,iss:`https://securetoken.google.com/${project}`}
 const auth={app:{options:{projectId:project}},createCustomToken:async()=> 'fixture-custom',verifyIdToken:async()=>decoded}
 const credential={getAccessToken:async()=>({access_token:'fixture-only'})}
 const fetchImpl=async url=>({ok:true,json:async()=>url.includes('signInWithCustomToken')?{idToken:'fixture-id',refreshToken:'not-used',expiresIn:'3600',isNewUser:false}:url.includes('/config')?{projectId:project,appId,apiKey:'AIza-qa',messagingSenderId:'530003937245'}:{apps:[{appId}]}})
 assert.equal(await signInCloudFixture({auth,uid,credential,fetchImpl}),'fixture-id')
 for(const change of [{uid:'foreign'},{aud:'idogs-app'},{iss:'https://securetoken.google.com/idogs-app'}]){
  decoded={uid,aud:project,iss:`https://securetoken.google.com/${project}`,...change}
  await assert.rejects(signInCloudFixture({auth,uid,credential,fetchImpl}),/TOKEN_IDENTITY_MISMATCH/)
 }
})
