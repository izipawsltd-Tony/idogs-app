// Read-only internal diagnostics. Never sends SMS or accesses customer records.
import { checkCronAuth } from './_lib/cron-auth.js'
import { smsSendGate } from './_lib/sms-sender-readiness.js'
import { normalizeAustralianMobile } from './_lib/sms-addon.js'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const auth = checkCronAuth(req)
  if (!auth.authorized) return res.status(auth.status).json(auth.body)
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const gate = smsSendGate()
  const result = {
    sourceSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    project: process.env.FIREBASE_PROJECT_ID,
    sendingEnabled: gate.ready,
    gateReason: gate.ready ? 'READY' : gate.reason,
    providerAuthenticated: false,
    expectedAccount: false,
    readOnly: true,
  }
  if (!['idogs-app','idogs-app-staging'].includes(result.project)) {
    return res.status(503).json({ ...result, reason: 'UNEXPECTED_PROJECT' })
  }
  if (!process.env.CLICKSEND_USERNAME || !process.env.CLICKSEND_API_KEY) {
    return res.status(503).json({ ...result, reason: 'CLICKSEND_CREDENTIALS_MISSING' })
  }
  try {
    const response = await fetch('https://rest.clicksend.com/v3/account', {
      method: 'GET',
      headers: { Authorization: 'Basic ' + Buffer.from(process.env.CLICKSEND_USERNAME + ':' + process.env.CLICKSEND_API_KEY).toString('base64') },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return res.status(503).json({ ...result, providerStatus: response.status, reason: 'CLICKSEND_AUTH_OR_ACCOUNT_UNAVAILABLE' })
    const body = await response.json()
    result.providerAuthenticated = body?.response_code === 'SUCCESS'
    // Match the account independently verified in the owner-controlled dashboard.
    // Return only a boolean, never account data or credentials.
    result.expectedAccount = [body?.data?.username, body?.data?.user_email]
      .some(value => typeof value === 'string' && value.toLowerCase() === 'izipawsltd@gmail.com')
    if (!result.providerAuthenticated || !result.expectedAccount) {
      return res.status(503).json({ ...result, reason: 'CLICKSEND_ACCOUNT_UNVERIFIED' })
    }
    if (!getApps().length) initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }) })
    const active = await getFirestore().collection('users').where('smsAddonStatus','==','active').limit(201).get()
    const subscriptions = { activeAddons: active.size, inspected: 0, truncated: active.size > 200,
      eligible: 0, invalidPhone: 0, invalidPeriod: 0, exhaustedQuota: 0 }
    const now = Date.now()
    for (const document of active.docs.slice(0,200)) {
      const user = document.data()
      subscriptions.inspected++
      if (!normalizeAustralianMobile(user.phone)) { subscriptions.invalidPhone++; continue }
      const start = typeof user.smsPeriodStart === 'string' ? Date.parse(user.smsPeriodStart) : NaN
      const end = typeof user.smsPeriodEnd === 'string' ? Date.parse(user.smsPeriodEnd) : NaN
      if (!(start <= now && now < end)) { subscriptions.invalidPeriod++; continue }
      const limit = Number.isInteger(user.smsCreditsLimit) && user.smsCreditsLimit >= 0 ? user.smsCreditsLimit : 20
      const used = Number.isInteger(user.smsCreditsUsed) && user.smsCreditsUsed >= 0 ? user.smsCreditsUsed : 0
      if (used >= limit) { subscriptions.exhaustedQuota++; continue }
      subscriptions.eligible++
    }
    return res.status(200).json({ ...result, subscriptions, reason: gate.ready ? 'READY' : gate.reason })
  } catch {
    return res.status(503).json({ ...result, reason: 'CLICKSEND_ACCOUNT_CHECK_FAILED' })
  }
}
