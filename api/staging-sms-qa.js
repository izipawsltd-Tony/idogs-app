import { getApps, initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { makeStagingSmsQaHandler, stagingSmsQaEnabled } from './_lib/staging-sms-qa.js'
import { sendClickSendSms } from './_lib/clicksend-sms.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (!stagingSmsQaEnabled(process.env, process.env.FIREBASE_PROJECT_ID, new Date())) {
    return res.status(404).json({ error: 'Not found' })
  }
  try {
    const name = 'staging-sms-qa'
    const app = getApps().find(app => app.name === name) || initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }), projectId: process.env.FIREBASE_PROJECT_ID }, name)
    return await makeStagingSmsQaHandler({ projectId: app.options.projectId,
      authenticate: token => getAuth(app).verifyIdToken(token, true), db: getFirestore(app),
      sendProvider: sendClickSendSms })(req, res)
  } catch { return res.status(503).json({ error: 'Staging QA service unavailable' }) }
}
