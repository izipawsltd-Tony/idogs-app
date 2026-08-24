import { createHash } from 'node:crypto'

export const SMS_MONTHLY_CREDITS = 20

const ACTIVE_SMS_STATUSES = new Set(['active'])
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
const GSM_EXTENDED = new Set('^{}\\[~]|€')

export function countSmsSegments(message) {
  const text = typeof message === 'string' ? message : ''
  if (!text) return 0

  let septets = 0
  let gsm7 = true
  for (const char of text) {
    if (GSM_BASIC.has(char)) septets += 1
    else if (GSM_EXTENDED.has(char)) septets += 2
    else {
      gsm7 = false
      break
    }
  }

  if (gsm7) return septets <= 160 ? 1 : Math.ceil(septets / 153)
  const chars = Array.from(text).length
  return chars <= 70 ? 1 : Math.ceil(chars / 67)
}

export function normalizeAustralianMobile(phone) {
  if (typeof phone !== 'string') return null
  const compact = phone.trim().replace(/[\s()-]/g, '')
  if (/^04\d{8}$/.test(compact)) return '+61' + compact.slice(1)
  if (/^\+614\d{8}$/.test(compact)) return compact
  if (/^614\d{8}$/.test(compact)) return '+' + compact
  return null
}

export function smsDeliveryId(idempotencyKey) {
  return createHash('sha256').update(String(idempotencyKey)).digest('hex')
}

function safeInt(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function parsePeriod(profile, now) {
  const start = typeof profile?.smsPeriodStart === 'string' ? new Date(profile.smsPeriodStart) : null
  const end = typeof profile?.smsPeriodEnd === 'string' ? new Date(profile.smsPeriodEnd) : null
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  if (now.getTime() < start.getTime() || now.getTime() >= end.getTime()) return null
  return { start, end }
}

export async function reserveSmsDelivery({
  db,
  tenantId,
  dogId = null,
  litterId = null,
  eventType,
  sourceRecordId,
  milestoneKey,
  idempotencyKey,
  segmentCount,
  now = new Date(),
}) {
  if (!tenantId || !eventType || !sourceRecordId || !milestoneKey || !idempotencyKey) {
    return { allowed: false, reason: 'INVALID_REQUEST' }
  }
  if (!Number.isInteger(segmentCount) || segmentCount < 1) {
    return { allowed: false, reason: 'INVALID_SEGMENT_COUNT' }
  }

  const deliveryId = smsDeliveryId(idempotencyKey)
  const userRef = db.collection('users').doc(tenantId)
  const deliveryRef = db.collection('smsDeliveries').doc(deliveryId)

  return db.runTransaction(async tx => {
    const [userSnap, deliverySnap] = await Promise.all([tx.get(userRef), tx.get(deliveryRef)])
    const profile = userSnap.exists ? userSnap.data() : {}

    if (deliverySnap.exists) {
      const existing = deliverySnap.data()
      if (existing.status === 'reserved' || existing.status === 'sent') {
        return { allowed: false, reason: 'DUPLICATE', deliveryId, status: existing.status }
      }
    }

    if (!ACTIVE_SMS_STATUSES.has(profile?.smsAddonStatus)) {
      return { allowed: false, reason: 'SMS_ADDON_INACTIVE', deliveryId }
    }

    const period = parsePeriod(profile, now)
    if (!period) {
      return { allowed: false, reason: 'SMS_BILLING_PERIOD_INVALID', deliveryId }
    }

    const limit = safeInt(profile.smsCreditsLimit, SMS_MONTHLY_CREDITS)
    const used = safeInt(profile.smsCreditsUsed, 0)
    if (used + segmentCount > limit) {
      return { allowed: false, reason: 'SMS_QUOTA_EXHAUSTED', deliveryId, used, limit }
    }

    const nowIso = now.toISOString()
    tx.set(userRef, { smsCreditsUsed: used + segmentCount }, { merge: true })
    tx.set(deliveryRef, {
      tenantId,
      dogId,
      litterId,
      eventType,
      sourceRecordId,
      milestoneKey,
      idempotencyKey,
      segmentCount,
      status: 'reserved',
      provider: 'aws_sns',
      periodStart: profile.smsPeriodStart,
      createdAt: deliverySnap.exists ? (deliverySnap.data().createdAt || nowIso) : nowIso,
      reservedAt: nowIso,
      sentAt: null,
      failedAt: null,
      providerMessageId: null,
      errorCode: null,
    }, { merge: true })

    return { allowed: true, deliveryId, used: used + segmentCount, limit }
  })
}

export async function markSmsDeliverySent({ db, deliveryId, providerMessageId, now = new Date() }) {
  const ref = db.collection('smsDeliveries').doc(deliveryId)
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data().status !== 'reserved') return
    tx.set(ref, {
      status: 'sent',
      providerMessageId: providerMessageId || null,
      sentAt: now.toISOString(),
    }, { merge: true })
  })
}

export async function markSmsDeliveryFailed({ db, tenantId, deliveryId, errorCode = 'PROVIDER_FAILED', now = new Date() }) {
  const deliveryRef = db.collection('smsDeliveries').doc(deliveryId)
  const userRef = db.collection('users').doc(tenantId)

  await db.runTransaction(async tx => {
    const [deliverySnap, userSnap] = await Promise.all([tx.get(deliveryRef), tx.get(userRef)])
    if (!deliverySnap.exists || deliverySnap.data().status !== 'reserved') return

    const delivery = deliverySnap.data()
    const profile = userSnap.exists ? userSnap.data() : {}
    const used = safeInt(profile.smsCreditsUsed, 0)
    const segments = safeInt(delivery.segmentCount, 0)

    tx.set(userRef, { smsCreditsUsed: Math.max(0, used - segments) }, { merge: true })
    tx.set(deliveryRef, {
      status: 'failed',
      failedAt: now.toISOString(),
      errorCode,
    }, { merge: true })
  })
}

export async function sendSmsWithQuota({
  db,
  tenantId,
  phone,
  message,
  dogId = null,
  litterId = null,
  eventType,
  sourceRecordId,
  milestoneKey,
  idempotencyKey,
  sendProvider,
  now = new Date(),
}) {
  const e164 = normalizeAustralianMobile(phone)
  if (!e164) return { sent: false, reason: 'INVALID_AU_MOBILE' }

  const segmentCount = countSmsSegments(message)
  const reservation = await reserveSmsDelivery({
    db, tenantId, dogId, litterId, eventType, sourceRecordId, milestoneKey,
    idempotencyKey, segmentCount, now,
  })
  if (!reservation.allowed) return { sent: false, ...reservation, segmentCount }

  let providerResult
  try {
    providerResult = await sendProvider(e164, message)
  } catch {
    await markSmsDeliveryFailed({
      db,
      tenantId,
      deliveryId: reservation.deliveryId,
      errorCode: 'PROVIDER_FAILED',
      now,
    })
    return { sent: false, reason: 'PROVIDER_FAILED', deliveryId: reservation.deliveryId, segmentCount }
  }

  try {
    await markSmsDeliverySent({
      db,
      deliveryId: reservation.deliveryId,
      providerMessageId: providerResult?.MessageId,
      now,
    })
    return { sent: true, deliveryId: reservation.deliveryId, segmentCount, providerMessageId: providerResult?.MessageId || null }
  } catch {
    // AWS already accepted the message. Keep the reservation charged and
    // unresolved rather than refunding/retrying and risking a duplicate SMS.
    return { sent: true, acceptedUnconfirmed: true, deliveryId: reservation.deliveryId, segmentCount }
  }
}
