// Staging OIDC E2E: real Firestore transactions in isolated QA collections.
// Never enumerates users, calls ClickSend, sends emails, or changes real quotas.
// Fails closed on wrong project. Unique immutable run ID prevents double writes.
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app'
import {getFirestore} from 'firebase-admin/firestore'
import {sendSmsWithQuota} from '../api/_lib/sms-addon.js'
const PROJECT='idogs-app-staging'
const RUN='20261024-oidc-scheduler-qa-v1'
const uid='synthetic-'+RUN
const QA={users:'qaSmsQuotaUsers',smsDeliveries:'qaSmsQuotaDeliveries'}
const now=new Date('2026-10-24T00:00:00Z')
if(process.env.GOOGLE_CLOUD_PROJECT!==PROJECT || !process.env.GOOGLE_APPLICATION_CREDENTIALS)
 throw Error('STAGING_OIDC_PROJECT_MISMATCH')
const app=initializeApp({credential:applicationDefault(),projectId:PROJECT},'sms-oidc-real-staging')
const raw=getFirestore(app)
const run=raw.collection('qaSmsQuotaRuns').doc(RUN)
const profile=raw.collection(QA.users).doc(uid)
const adapter={collection:n=>{if(!Object.hasOwn(QA,n))throw Error('DENIED_COLLECTION');return raw.collection(QA[n])},
 runTransaction:callback=>raw.runTransaction(callback)}
const fixture={
 smsAddonStatus:'active',smsPeriodStart:'2026-10-01T00:00:00.000Z',
 smsPeriodEnd:'2026-11-01T00:00:00.000Z',smsCreditsLimit:20,smsCreditsUsed:0,
 qaOnly:true,synthetic:true,source:'github-oidc-qa'
}
const base={db:adapter,tenantId:uid,phone:'+61412345678',dogId:'synthetic-dog',
 message:'iDogs synthetic vaccine reminder (NO REAL SEND)',eventType:'vaccination',
 sourceRecordId:'synthetic-vaccine',milestoneKey:'2026-10-31',
 idempotencyKey:'vaccine:'+RUN,now}
let sends=0
base.sendProvider=async()=>{sends++;return {MessageId:'MOCK-NOT-SENT'}}
try {
 try {await run.create({state:'started',source:'oidc-staging-qa',createdAt:new Date().toISOString()})}
 catch(e){if(e?.code===6||e?.code==='already-exists')throw Error('QA_ALREADY_RUN');throw e}
 await profile.create(fixture)
 const first=await sendSmsWithQuota(base)
 const duplicate=await sendSmsWithQuota(base)
 const afterFirst=(await profile.get()).data().smsCreditsUsed
 await profile.update({smsCreditsUsed:20})
 const exhausted=await sendSmsWithQuota({...base,eventType:'worming',
   sourceRecordId:'synthetic-worming',idempotencyKey:'worming:'+RUN})
 const credits=(await profile.get()).data().smsCreditsUsed
 const good=first.sent===true && first.segmentCount===1 &&
  duplicate.reason==='DUPLICATE' && afterFirst===1 &&
  exhausted.reason==='SMS_QUOTA_EXHAUSTED' && credits===20 && sends===1
 const result={state:good?'PASS':'FAIL',project:PROJECT,realFirestore:true,
  provider:'MOCK_NO_CLICK_SEND',firstSegmentCount:first.segmentCount,
  firstCreditUsage:afterFirst,duplicate:duplicate.reason,exhausted:exhausted.reason,
  exhaustedCreditUsage:credits,providerCalls:sends,syntheticDataOnly:true}
 await run.set({...result,finishedAt:new Date().toISOString()},{merge:true})
 console.log(JSON.stringify(result))
 if(!good)process.exitCode=1
} catch(e) {
 console.error('OIDC STAGING E2E FAIL:',e.message)
 process.exitCode=1
} finally {await deleteApp(app)}
