import {beforeEach,describe,it,expect,vi} from 'vitest'
vi.mock('firebase-admin/app',()=>({getApps:()=>[{}],initializeApp:vi.fn(),cert:vi.fn()}))
vi.mock('firebase-admin/firestore',()=>({getFirestore:()=>({collection:()=>({where:()=>({limit:()=>({get:async()=>({size:0,docs:[]})})})})})}))
import handler from '../api/sms-readiness.js'
const call=async(method='GET',authorized=true)=>{
 const out={};const res={setHeader:vi.fn(),status:n=>{out.status=n;return res},json:v=>{out.body=v;return out}}
 await handler({method,headers:authorized?{'x-cron-secret':'synthetic-cron'}:{}},res)
 return out
}
beforeEach(()=>{
 vi.stubEnv('CRON_SECRET','synthetic-cron');vi.stubEnv('FIREBASE_PROJECT_ID','idogs-app')
 vi.stubEnv('VERCEL_GIT_COMMIT_SHA','a'.repeat(40));vi.stubEnv('SMS_SENDING_ENABLED','true')
 vi.stubEnv('SMS_PROVIDER','clicksend');vi.stubEnv('SMS_SENDER_ID','iDogs');vi.stubEnv('SMS_PROVIDER_ACCOUNT_VERIFIED','true')
 vi.stubEnv('CLICKSEND_USERNAME','synthetic');vi.stubEnv('CLICKSEND_API_KEY','synthetic-secret')
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({response_code:'SUCCESS',data:{username:'izipawsltd@gmail.com',api_key:'must-not-leak'}})}))
})
describe('read-only SMS runtime verification',()=>{
 it('rejects unauthenticated requests before any provider call',async()=>{expect((await call('GET',false)).status).toBe(401);expect(fetch).not.toHaveBeenCalled()})
 it('rejects POST without performing any provider call',async()=>{expect((await call('POST')).status).toBe(405);expect(fetch).not.toHaveBeenCalled()})
 it('checks only the account GET and returns no secrets or customer information',async()=>{
  const r=await call();expect(r.status).toBe(200);expect(r.body).toMatchObject({sendingEnabled:true,providerAuthenticated:true,expectedAccount:true,readOnly:true,reason:'READY'})
  expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('https://rest.clicksend.com/v3/account');expect(fetch.mock.calls[0][1].method).toBe('GET')
  expect(JSON.stringify(r.body)).not.toMatch(/synthetic-secret|api_key|must-not-leak|izipawsltd/)
 })
 it('reports disabled sending without disguising it as READY',async()=>{vi.stubEnv('SMS_SENDING_ENABLED','false');expect((await call()).body).toMatchObject({sendingEnabled:false,providerAuthenticated:true,reason:'SMS_SENDING_DISABLED'})})
 it('fails closed for the wrong account',async()=>{fetch.mockResolvedValue({ok:true,json:async()=>({response_code:'SUCCESS',data:{username:'other'}})});expect((await call()).status).toBe(503)})
 it('fails closed on denied credentials',async()=>{fetch.mockResolvedValue({ok:false,status:401});expect((await call()).status).toBe(503)})
 it('fails closed on missing credentials without a provider call',async()=>{vi.stubEnv('CLICKSEND_API_KEY','');expect((await call()).status).toBe(503);expect(fetch).not.toHaveBeenCalled()})
 it('fails closed on network errors',async()=>{fetch.mockRejectedValue(new Error('synthetic'));expect((await call()).status).toBe(503)})
})
