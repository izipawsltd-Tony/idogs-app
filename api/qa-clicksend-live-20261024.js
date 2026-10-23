// Explicitly owner-approved SINGLE live SMS QA, separate from historical closed test.
// Staging-only, verified QA user, fixed recipient/body, durable lock before provider call.
// This endpoint cannot be used by reminder cron, production or general customers.
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { sendClickSendSms } from './_lib/clicksend-sms.js'
import { verifyClickSendAccount } from './_lib/clicksend-health.js'
import { getClickSendDeliveryStatus } from './_lib/clicksend-delivery-status.js'

const PROJECT = 'idogs-app-staging'
const EMAIL = 'idogsbreeder+qaa@gmail.com'
const DOC = 'owner-approved-20261024-live-clicksend'
const MESSAGE = 'iDogs QA 24 Oct: ClickSend sender and delivery test. No action required.'
const permitted = () => process.env.VERCEL_ENV === 'preview' &&
 process.env.FIREBASE_PROJECT_ID === PROJECT &&
 process.env.SMS_PROVIDER === 'clicksend' &&
 process.env.SMS_SENDER_ID === 'iDogs' &&
 process.env.SMS_LIVE_QA_ENABLED === 'true'
const safeError = (error) => typeof error?.code === 'string' && /^[A-Z_]{2,80}$/.test(error.code)
 ? error.code : 'UNKNOWN_PROVIDER_ERROR'
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store')
 if(req.method!=='GET' && req.method!=='POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
 if(!permitted()) return res.status(503).json({error:'ONE_SHOT_QA_DISABLED'})
 const bearer=req.headers?.authorization || ''
 if(!bearer.startsWith('Bearer ')) return res.status(401).json({error:'NO_AUTH'})
 if(!getApps().length) initializeApp({credential:cert({
   projectId:process.env.FIREBASE_PROJECT_ID,
   clientEmail:process.env.FIREBASE_CLIENT_EMAIL,
   privateKey:process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n')
 })})
 let decoded
 try {decoded=await getAuth().verifyIdToken(bearer.slice(7),true)}
 catch {return res.status(401).json({error:'INVALID_AUTH'})}
 if(decoded.email?.toLowerCase()!==EMAIL || decoded.email_verified!==true)
   return res.status(403).json({error:'QA_ACCOUNT_ONLY'})
 const ref=getFirestore().collection('smsQaOneShot').doc(DOC)
 if(req.method==='GET'){
   const snap=await ref.get()
   if(!snap.exists) return res.status(200).json({phase:'NOT_ATTEMPTED',attempts:0,delivery:'NOT_CHECKED'})
   const record=snap.data()
   if(!record.providerMessageId) return res.status(200).json({phase:record.status || 'RESERVED',
     attempts:1,delivery:'UNCONFIRMED',retryAllowed:false})
   const delivery=await getClickSendDeliveryStatus(record.providerMessageId)
   return res.status(200).json({phase:record.status,attempts:1,
     providerMessageId:record.providerMessageId,delivery:delivery.status,source:delivery.source || null,
     retryAllowed:false})
 }
 const phone=process.env.SMS_LIVE_QA_RECIPIENT
 if(typeof phone!=='string'||!/^\+614\d{8}$/.test(phone))
   return res.status(503).json({error:'QA_RECIPIENT_MISSING'})
 // A read-only authentication check happens before the irreversible reservation.
 const account=await verifyClickSendAccount()
 if(!account.ok) return res.status(503).json({error:account.reason})
 try {
   await ref.create({status:'reserved',createdAt:new Date().toISOString(),sender:'iDogs',
     purpose:'approved-single-live-sms-qa-20261024',qaUid:decoded.uid})
 } catch(error){
   if(error?.code===6 || error?.code==='already-exists')
     return res.status(409).json({error:'ONE_SHOT_ALREADY_ATTEMPTED',retryAllowed:false})
   return res.status(503).json({error:'RESERVATION_FAILED',retryAllowed:false})
 }
 try {
   const accepted=await sendClickSendSms(phone,MESSAGE)
   try {
     await ref.set({status:'provider_queued',providerMessageId:accepted.MessageId,
       acceptedAt:new Date().toISOString()},{merge:true})
   } catch {
     return res.status(202).json({phase:'PROVIDER_ACCEPTED_DB_UNCONFIRMED',
       providerMessageId:accepted.MessageId,retryAllowed:false})
   }
   return res.status(200).json({phase:'PROVIDER_QUEUED_NOT_DELIVERED',
     providerMessageId:accepted.MessageId,retryAllowed:false})
 } catch(error) {
   const code=safeError(error)
   await ref.set({status:'outcome_unconfirmed',reason:code,
     checkedAt:new Date().toISOString()},{merge:true}).catch(()=>{})
   return res.status(502).json({phase:'PROVIDER_UNCONFIRMED',error:code,retryAllowed:false})
 }
}
