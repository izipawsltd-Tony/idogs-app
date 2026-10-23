// QA-only, real Firestore transaction E2E for SMS quota. NO provider traffic.
// Uses isolated QA collections and a mock transport; real users are untouched.
import {initializeApp,getApps,cert} from 'firebase-admin/app'
import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {sendSmsWithQuota, smsDeliveryId} from './_lib/sms-addon.js'

const QA_PROJECT='idogs-app-staging'
const QA_EMAIL='idogsbreeder+qaa@gmail.com'
const FIXTURE='sms-quota-e2e-20261024-v1'
const KEY='vaccination:qa-fixture-dog:qa-fixture-record:2026-10-31'
const NOW=new Date('2026-10-24T00:00:00.000Z')
const LIMIT=20
const USER_ID='synthetic-'+FIXTURE
function safeDb(db) {
 return {
  collection(name) {
   const alias=name==='users'?'qaSmsQuotaUsers':
    name==='smsDeliveries'?'qaSmsQuotaDeliveries':null
   if(!alias) throw Error('COLLECTION_NOT_ALLOWED')
   return db.collection(alias)
  },
  runTransaction:fn=>db.runTransaction(fn),
 }
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store')
 if(req.method!=='POST' && req.method!=='GET') return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
 if(process.env.VERCEL_ENV!=='preview'||process.env.FIREBASE_PROJECT_ID!==QA_PROJECT)
  return res.status(503).json({error:'STAGING_ONLY'})
 const raw=req.headers?.authorization||''
 if(!raw.startsWith('Bearer ')) return res.status(401).json({error:'UNAUTHENTICATED'})
 if(!getApps().length)initializeApp({credential:cert({
  projectId:process.env.FIREBASE_PROJECT_ID,
  clientEmail:process.env.FIREBASE_CLIENT_EMAIL,
  privateKey:process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n'),
 })})
 let auth
 try{auth=await getAuth().verifyIdToken(raw.slice(7),true)}
 catch{return res.status(401).json({error:'INVALID_AUTH'})}
 if(auth.email?.toLowerCase()!==QA_EMAIL||auth.email_verified!==true)
  return res.status(403).json({error:'QA_ACCOUNT_ONLY'})
 const db=getFirestore()
 const runRef=db.collection('qaSmsQuotaRuns').doc(FIXTURE)
 const profileRef=db.collection('qaSmsQuotaUsers').doc(USER_ID)
 const deliveryRef=db.collection('qaSmsQuotaDeliveries').doc(smsDeliveryId(KEY))
 if(req.method==='GET'){
  const [run,user,delivery]=await Promise.all([runRef.get(),profileRef.get(),deliveryRef.get()])
  return res.status(200).json({phase:run.exists?run.data().status:'NOT_RUN',
   creditsUsed:user.exists?user.data().smsCreditsUsed:null,
   creditLimit:LIMIT,deliveryStatus:delivery.exists?delivery.data().status:null,
   providerCalls:run.exists?run.data().providerCalls:0})
 }
 try {
  await runRef.create({status:'reserved',createdAt:new Date().toISOString(),qaUid:auth.uid})
 } catch(e){
  if(e?.code===6||e?.code==='already-exists')return res.status(409).json({
   error:'E2E_ALREADY_ATTEMPTED',retryAllowed:false})
  return res.status(503).json({error:'RUN_LOCK_FAILED'})
 }
 let calls=0
 const provider=async()=>{calls++;return {MessageId:'synthetic-no-clicksend-request'}}
 const context={db:safeDb(db),tenantId:USER_ID,phone:'+61412345678',
  dogId:'synthetic-dog',message:'iDogs: synthetic QA vaccine due 31 Oct 2026.',
  eventType:'vaccination',sourceRecordId:'synthetic-vaccine',
  milestoneKey:'2026-10-31',idempotencyKey:KEY,sendProvider:provider,now:NOW}
 try{
  await profileRef.create({smsAddonStatus:'active',smsPeriodStart:'2026-10-01T00:00:00.000Z',
   smsPeriodEnd:'2026-11-01T00:00:00.000Z',smsCreditsLimit:LIMIT,
   smsCreditsUsed:0,qaOnly:true})
  const first=await sendSmsWithQuota(context)
  const duplicate=await sendSmsWithQuota(context)
  const afterFirst=await profileRef.get()
  const usedAfterFirst=afterFirst.data().smsCreditsUsed
  // Set a synthetic 20/20 quota to confirm that another reminder is blocked.
  await profileRef.set({smsCreditsUsed:LIMIT},{merge:true})
  const exhausted=await sendSmsWithQuota({...context,idempotencyKey:KEY+':next-due'})
  const afterLimit=await profileRef.get()
  const delivery=await deliveryRef.get()
  const pass=first.sent===true&&first.segmentCount===1&&
    duplicate.reason==='DUPLICATE'&&usedAfterFirst===1&&
    exhausted.reason==='SMS_QUOTA_EXHAUSTED'&&afterLimit.data().smsCreditsUsed===LIMIT&&
    delivery.data()?.status==='sent'&&
    delivery.data()?.providerMessageId==='synthetic-no-clicksend-request'&&calls===1
  const result={status:pass?'PASS':'FAIL',firstQueued:!!first.sent,
   duplicateReason:duplicate.reason||null,exhaustedReason:exhausted.reason||null,
   creditsAfterFirst:usedAfterFirst,creditsAtLimit:afterLimit.data().smsCreditsUsed,
   deliveryStatus:delivery.data()?.status||null,providerCalls:calls,
   transport:'IN_PROCESS_MOCK_NO_REAL_SMS',firestore:'STAGING_QA_COLLECTIONS'}
  await runRef.set({...result,completedAt:new Date().toISOString()},{merge:true})
  return res.status(pass?200:500).json(result)
 }catch(e){
  await runRef.set({status:'FAIL',errorCode:'QA_FIRESTORE_TRANSACTION_FAILED'},{merge:true}).catch(()=>{})
  return res.status(500).json({status:'FAIL',error:'QA_FIRESTORE_TRANSACTION_FAILED'})
 }
}
