// Staging-only, exactly-once owner-approved ClickSend QA.
// No arbitrary destination/body. Lock is created BEFORE outbound provider call.
// A failed or uncertain send remains locked to prevent duplicates.
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { sendClickSendSms } from './_lib/clicksend-sms.js'
import { verifyClickSendAccount } from './_lib/clicksend-health.js'

const PROJECT = 'idogs-app-staging'
const QA_EMAIL = 'idogsbreeder+qaa@gmail.com'
const LOCK = 'clicksend-owner-approved-20261023-once'
const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' }

export default async function handler(req, res) {
  Object.entries(RESPONSE_HEADERS).forEach(([k,v]) => res.setHeader(k,v))
  if (req.method !== 'POST') return res.status(405).json({ error:'METHOD_NOT_ALLOWED' })
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.FIREBASE_PROJECT_ID !== PROJECT ||
      process.env.SMS_PROVIDER !== 'clicksend' ||
      process.env.SMS_SENDER_ID !== 'iDogs' ||
      process.env.SMS_QA_ONE_SHOT_ENABLED !== 'true')
    return res.status(503).json({ error:'STAGING_QA_DISABLED' })
  const phone = process.env.SMS_QA_TEST_RECIPIENT
  if (typeof phone !== 'string' || !/^\+614\d{8}$/.test(phone))
    return res.status(503).json({ error:'QA_RECIPIENT_NOT_CONFIGURED' })
  const authorization = req.headers?.authorization || ''
  if (!authorization.startsWith('Bearer ')) return res.status(401).json({error:'UNAUTHENTICATED'})
  if (!getApps().length) {
    initializeApp({ credential:cert({
      projectId:process.env.FIREBASE_PROJECT_ID,
      clientEmail:process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n')
    }) })
  }
  let decoded
  try { decoded = await getAuth().verifyIdToken(authorization.slice(7)) }
  catch { return res.status(401).json({ error:'INVALID_AUTH' }) }
  if (!decoded.email_verified || decoded.email?.toLowerCase() !== QA_EMAIL)
    return res.status(403).json({error:'QA_ACCOUNT_ONLY'})

  const verified = await verifyClickSendAccount()
  if (!verified.ok) return res.status(503).json({error:verified.reason})
  const db = getFirestore()
  const ref = db.collection('smsQaOneShot').doc(LOCK)
  try {
    await ref.create({
      status:'reserved',
      purpose:'owner-approved-single-clicksend-qa',
      provider:'clicksend',
      senderId:'iDogs',
      createdAt:new Date().toISOString(),
    })
  } catch (err) {
    if (err?.code === 6 || err?.code === 'already-exists')
      return res.status(409).json({error:'QA_SMS_ALREADY_ATTEMPTED'})
    return res.status(503).json({error:'QA_LOCK_FAILED'})
  }
  try {
    const result = await sendClickSendSms(phone, 'iDogs QA: test of registered Sender ID iDogs. No action required.')
    await ref.set({status:'queued', providerMessageId:result.MessageId, queuedAt:new Date().toISOString()},{merge:true})
    return res.status(200).json({result:'QUEUED', messageId:result.MessageId})
  } catch(err) {
    // No automatic unlock; even network failure can mean delivery was queued.
    await ref.set({status:'unresolved', reason:err?.code || 'PROVIDER_ERROR'},{merge:true}).catch(()=>{})
    return res.status(502).json({error:'QA_SEND_UNCONFIRMED', retryDisabled:true})
  }
}
