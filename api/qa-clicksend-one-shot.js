// Staging-only, exactly-once owner-approved ClickSend QA.
// No arbitrary destination/body. Lock is created BEFORE outbound provider call.
// A failed or uncertain send remains locked to prevent duplicates.
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getClickSendDeliveryStatus, findOwnerQaSmsInClickSendHistory } from './_lib/clicksend-delivery-status.js'

const PROJECT = 'idogs-app-staging'
const QA_EMAIL = 'idogsbreeder+qaa@gmail.com'
const LOCK = 'clicksend-owner-approved-20261023-once'
const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' }

export default async function handler(req, res) {
  Object.entries(RESPONSE_HEADERS).forEach(([k,v]) => res.setHeader(k,v))
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error:'METHOD_NOT_ALLOWED' })
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.FIREBASE_PROJECT_ID !== PROJECT ||
      process.env.SMS_PROVIDER !== 'clicksend' ||
      process.env.SMS_SENDER_ID !== 'iDogs')
    return res.status(503).json({ error:'STAGING_QA_DISABLED' })
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

  if (req.method === 'GET') {
    // GET checks only existing QA delivery; never creates locks, sends or refunds.
    const snap = await getFirestore().collection('smsQaOneShot').doc(LOCK).get()
    if (!snap.exists) {
      // No stored provider call evidence in this Firebase project.
      // No lock in this Firestore: NEVER treat this as permission to resend.
      // Reconcile one exact approved QA body from ClickSend History, read-only.
      const fallback = await findOwnerQaSmsInClickSendHistory()
      return res.status(200).json({...fallback,firestoreLock:'ABSENT',providerMessageIdStored:false,deliveryVerified:false,retryAllowed:false})
    }
    const saved = snap.data()
    if (!saved?.providerMessageId) return res.status(200).json({
      status:'OUTCOME_UNKNOWN', firestoreLock:'PRESENT',providerMessageIdStored:false,deliveryVerified:false,retryAllowed:false,
    })
    const delivery = await getClickSendDeliveryStatus(saved.providerMessageId)
    return res.status(200).json({...delivery,firestoreLock:'PRESENT',providerMessageIdStored:true,deliveryVerified:delivery.status==='DELIVERED',retryAllowed:false})
  }
  // Historical one-shot test has closed. Never re-enable this POST via an env flag.
  // A new SMS would require a separate owner approval and a distinct audited endpoint.
  return res.status(410).json({ error:'QA_ONE_SHOT_CLOSED', retryDisabled:true })
}
