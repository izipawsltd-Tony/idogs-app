// Real Firestore transactions. SMS transport is always an in-process mock.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app'
import {getFirestore} from 'firebase-admin/firestore'
import {sendSmsWithQuota} from '../api/_lib/sms-addon.js'
const PROJECT='idogs-app-staging', DATABASE='qa-sms-reminder-e2e'
const ACCOUNT='idogs-staging-sms-qa-writer@idogs-app-staging.iam.gserviceaccount.com'
const PROVIDER='projects/530003937245/locations/global/workloadIdentityPools/github-sms-qa-writer/providers/github-actions'
const RUN=`${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
const SHA=process.env.QA_SOURCE_SHA || process.env.GITHUB_SHA, now=new Date('2026-10-24T00:00:00Z')
const QA={users:'qaSmsQuotaUsers',smsDeliveries:'qaSmsQuotaDeliveries'}
let app,run,started=false,sends=0
const checks={}
const result={state:'FAIL',project:PROJECT,database:DATABASE,sha:SHA,workflowSha:process.env.GITHUB_SHA,run:RUN,
 realFirestore:true,provider:'MOCK_NO_REAL_SMS',syntheticDataOnly:true,checks}
try {
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,PROJECT)
 assert.equal(process.env.GITHUB_ACTIONS,'true','GITHUB_OIDC_ONLY')
 assert.equal(process.env.GITHUB_REPOSITORY,'izipawsltd-Tony/idogs-app')
 assert.equal(process.env.GITHUB_REF,'refs/heads/qa/staging-oidc-reminder-e2e-20261024')
 assert.match(SHA||'',/^[0-9a-f]{40}$/)
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),SHA,'CHECKOUT_SHA_MISMATCH')
 assert.match(RUN,/^\d+-\d+$/)
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,undefined)
 const credentials=JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'))
 assert.equal(credentials.type,'external_account')
 assert.equal(credentials.service_account_impersonation_url,
  `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${ACCOUNT}:generateAccessToken`)
 assert.equal(credentials.audience,`//iam.googleapis.com/${PROVIDER}`)
 checks.identity='PASS'
 app=initializeApp({credential:applicationDefault(),projectId:PROJECT},'sms-qa-oidc')
 const raw=getFirestore(app,DATABASE)
 const denied=e=>e.code===7||e.code==='permission-denied'
 // Check isolation before writing any fixtures. Never write to the default DB.
 await assert.rejects(getFirestore(app).collection('qaSmsQuotaRuns').doc(`isolation-${RUN}`).get(),denied,'DEFAULT_DATABASE_MUST_DENY')
 checks.defaultDatabaseDenied='PASS'
 await assert.rejects(raw.collection('qaSmsQuotaRuns').limit(1).get(),denied,'LIST_MUST_DENY')
 checks.enumerationDenied='PASS'
 const adapter={collection:n=>{if(!Object.hasOwn(QA,n))throw Error('DENIED_COLLECTION');return raw.collection(QA[n])},runTransaction:cb=>raw.runTransaction(cb)}
 run=raw.collection('qaSmsQuotaRuns').doc(RUN)
 await run.create({...result,state:'started',createdAt:new Date().toISOString()})
 started=true
 const uid=`synthetic-${RUN}`,profile=raw.collection(QA.users).doc(uid)
 await profile.create({smsAddonStatus:'active',smsPeriodStart:'2026-10-01T00:00:00.000Z',
  smsPeriodEnd:'2026-11-01T00:00:00.000Z',smsCreditsLimit:20,smsCreditsUsed:0,
  qaOnly:true,synthetic:true,source:'github-oidc-qa'})
 const base={db:adapter,tenantId:uid,phone:'+61412345678',dogId:'synthetic-dog',
  message:'iDogs synthetic QA reminder (NO REAL SEND)',milestoneKey:'2026-10-31',now,
  sendProvider:async()=>{sends++;return {MessageId:`MOCK-NOT-SENT-${sends}`}}}
 const event=(type,suffix)=>({...base,eventType:type,sourceRecordId:`synthetic-${type}`,idempotencyKey:`${type}:${RUN}:${suffix}`})
 for(const type of ['vaccination','worming']){
  const request=event(type,'success'),first=await sendSmsWithQuota(request)
  assert.equal(first.sent,true);assert.equal(first.segmentCount,1)
  assert.equal(first.acceptedUnconfirmed,undefined)
  assert.equal((await sendSmsWithQuota(request)).reason,'DUPLICATE')
  assert.equal((await raw.collection(QA.smsDeliveries).doc(first.deliveryId).get()).data().status,'sent')
  checks[`${type}SuccessAndDuplicate`]='PASS'
 }
 assert.equal((await profile.get()).data().smsCreditsUsed,2)
 const duplicates=await Promise.all(Array.from({length:4},()=>sendSmsWithQuota(event('vaccination','concurrent'))))
 assert.equal(duplicates.filter(r=>r.sent).length,1)
 assert.equal(duplicates.filter(r=>r.reason==='DUPLICATE').length,3)
 assert.equal((await profile.get()).data().smsCreditsUsed,3)
 checks.concurrentIdempotency='PASS'
 await profile.update({smsCreditsUsed:19})
 const boundary=await Promise.all(['vaccination','worming'].map(t=>sendSmsWithQuota(event(t,'boundary'))))
 assert.equal(boundary.filter(r=>r.sent).length,1)
 assert.equal(boundary.filter(r=>r.reason==='SMS_QUOTA_EXHAUSTED').length,1)
 assert.equal((await profile.get()).data().smsCreditsUsed,20)
 checks.concurrentLastCredit='PASS'
 for(const type of ['vaccination','worming'])assert.equal((await sendSmsWithQuota(event(type,'exhausted'))).reason,'SMS_QUOTA_EXHAUSTED')
 assert.equal((await profile.get()).data().smsCreditsUsed,20);assert.equal(sends,4)
 checks.exhaustedBothTypes='PASS'
 result.state='PASS'
 await run.set({...result,providerCalls:sends,finishedAt:new Date().toISOString()},{merge:true})
}catch(e){
 result.state='FAIL';result.error=e.message;process.exitCode=1
 if(started)try{await run.set({...result,providerCalls:sends},{merge:true})}catch{result.evidenceWriteFailed=true}
}finally{
 result.providerCalls=sends;result.finishedAt=new Date().toISOString()
 mkdirSync('qa-artifacts',{recursive:true})
 writeFileSync('qa-artifacts/staging-sms-e2e.json',JSON.stringify(result,null,2))
 console.log(JSON.stringify(result))
 if(app)await deleteApp(app)
}
