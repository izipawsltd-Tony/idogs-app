import { createHash } from 'node:crypto'
import { normalizeAustralianMobile, sendSmsWithQuota } from './sms-addon.js'

export const QA_MESSAGE = 'iDogs QA reminder: This is your one-time staging SMS test. No care action is required.'
export const QA_EVENT = 'clicksend-owner-qa-20261020'
export const QA_EXPIRES = Date.parse('2026-10-21T00:00:00.000Z')
const digest = value => createHash('sha256').update(value).digest('hex')
const POLICY = {
  uidHash: '354478749f689dc619edc4c1bac3083a870b540ad772c28070b6a1c47a02d473',
  phoneHash: '9b3dcc4d3afd5ae45927be91ee0b29a5dbe045ad92abed03c7ef4943de694d18',
}

export function stagingSmsQaEnabled(env, projectId, now) {
  return env.VERCEL_ENV === 'preview' &&
    env.VERCEL_PROJECT_ID === 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o' &&
    env.FIREBASE_PROJECT_ID === 'idogs-app-staging' &&
    projectId === 'idogs-app-staging' &&
    now.getTime() >= Date.parse('2026-10-20T00:00:00.000Z') && now.getTime() < QA_EXPIRES
}

// One fixed recipient, one fixed message, one attempt across all Preview URLs.
// This is deliberately separate from the all-user daily scheduler.
export function makeStagingSmsQaHandler({ authenticate, db, sendProvider,
  env = process.env, projectId, clock = () => new Date(), policy = POLICY }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    const now = clock()
    if (!stagingSmsQaEnabled(env, projectId, now)) return res.status(404).json({ error: 'Not found' })
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
    let uid
    try {
      const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1]
      if (!token) throw new Error()
      uid = (await authenticate(token))?.uid
      if (!uid) throw new Error()
    } catch { return res.status(401).json({ error: 'Sign in required' }) }
    if (digest(uid) !== policy.uidHash) return res.status(404).json({ error: 'Not found' })
    try {
      const profileRef = db.collection('users').doc(uid)
      const attemptRef = db.collection('smsQaAttempts').doc(QA_EVENT)
      const [profileSnap, attemptSnap] = await Promise.all([profileRef.get(), attemptRef.get()])
      const profile = profileSnap.exists ? profileSnap.data() : {}
      const phone = normalizeAustralianMobile(profile.phone)
      if (!phone || digest(phone) !== policy.phoneHash) return res.status(409).json({ error: 'Approved QA mobile does not match account' })
      const existing = attemptSnap.exists ? attemptSnap.data() : null
      const status = existing?.status || 'ready'
      if (req.method === 'GET') return res.status(200).json({ enabled: true, status,
        recipient: 'Mobile ending 5393', message: QA_MESSAGE, providerMessageId: existing?.providerMessageId || null })
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      if (body?.action !== 'send_once' || Object.keys(body).length !== 1) return res.status(400).json({ error: 'Invalid QA action' })
      if (profile.smsAddonStatus !== 'active' || profile.smsCreditsLimit !== 1 || profile.smsCreditsUsed !== 0 ||
        !(Date.parse(profile.smsPeriodStart) <= now.getTime() && now.getTime() < Date.parse(profile.smsPeriodEnd))) {
        return res.status(409).json({ error: 'Active one-credit QA entitlement required' })
      }
      const claimed = await db.runTransaction(async tx => {
        const snap = await tx.get(attemptRef)
        if (snap.exists) return false
        tx.set(attemptRef, { tenantId: uid, status: 'reserved', createdAt: now.toISOString() })
        return true
      })
      if (!claimed) return res.status(409).json({ error: 'QA attempt already used; check existing delivery. Do not retry.' })
      const result = await sendSmsWithQuota({ db, tenantId: uid, phone, message: QA_MESSAGE,
        eventType: 'qa_reminder', sourceRecordId: QA_EVENT, milestoneKey: QA_EVENT,
        idempotencyKey: `${QA_EVENT}:${uid}`, now, sendProvider })
      const outcome = result.sent ? 'accepted' : result.reason === 'SMS_DELIVERY_UNKNOWN' ? 'unknown' : 'blocked'
      await attemptRef.set({ status: outcome, deliveryId: result.deliveryId || null,
        providerMessageId: result.providerMessageId || null, reason: result.reason || null,
        updatedAt: now.toISOString() }, { merge: true })
      return res.status(result.sent ? 200 : 409).json({ status: outcome,
        providerMessageId: result.providerMessageId || null,
        message: result.sent ? 'ClickSend accepted the SMS. Handset delivery still needs confirmation.' :
          'SMS was not confirmed accepted. Do not retry; check provider history.' })
    } catch {
      // A claimed attempt stays consumed even if a response/write fails.
      return res.status(503).json({ error: 'QA result unavailable. Do not retry; check delivery history.' })
    }
  }
}
