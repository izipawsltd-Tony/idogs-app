// Preview-only, exact-target live SMS QA for Black Boy worming.
// GET is read-only dry-run. POST can send exactly one idempotent SMS through
// the production SMS quota helper, but only after all hard-coded target checks pass.

import {
  SMS_MONTHLY_CREDITS,
  countSmsSegments,
  normalizeAustralianMobile,
  sendSmsWithQuota,
  smsDeliveryId,
} from './_lib/sms-addon.js'
import { getSmsProviderName, smsProviderConfigStatus, sendSmsProvider as sendConfiguredSmsProvider } from './_lib/sms-provider.js'

const QA_UID = 'MN9UKyfFqDQk9fbV1tqdvbiCr5C3'
const QA_DOG_ID = 'CiafPl5XQQQ8gq1fNhd4'
const QA_DOG_NAME = 'Black Boy'
const QA_WORMING_DUE = '2026-08-31'
const EXPECTED_FIREBASE_PROJECT = 'idogs-app'

function dateOnly(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function validSmsPeriod(user, now = new Date()) {
  const start = typeof user?.smsPeriodStart === 'string' ? new Date(user.smsPeriodStart) : null
  const end = typeof user?.smsPeriodEnd === 'string' ? new Date(user.smsPeriodEnd) : null
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false
  return now.getTime() >= start.getTime() && now.getTime() < end.getTime()
}

function formatDateAu(dateString) {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

async function loadState(db) {
  const [userSnap, dogSnap] = await Promise.all([
    db.collection('users').doc(QA_UID).get(),
    db.collection('dogs').doc(QA_DOG_ID).get(),
  ])
  const user = userSnap.exists ? userSnap.data() : null
  const dog = dogSnap.exists ? dogSnap.data() : null

  const wormingSnap = await db.collection('wormingRecords').where('dogId', '==', QA_DOG_ID).get()
  const activeWorming = wormingSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(w => w.dateGiven)
    .sort((a, b) => dateOnly(b.dateGiven).localeCompare(dateOnly(a.dateGiven)))[0] || null

  const idempotencyKey = activeWorming
    ? `worming:${QA_UID}:${QA_DOG_ID}:${activeWorming.id}:${activeWorming.nextDue}`
    : null
  const deliveryId = idempotencyKey ? smsDeliveryId(idempotencyKey) : null
  const deliverySnap = deliveryId ? await db.collection('smsDeliveries').doc(deliveryId).get() : null
  const delivery = deliverySnap?.exists ? deliverySnap.data() : null

  const phone = normalizeAustralianMobile(user?.phone)
  const message = `iDogs: ${QA_DOG_NAME} worming is due ${formatDateAu(QA_WORMING_DUE)}. Check the recorded treatment schedule in iDogs.`
  const segmentCount = countSmsSegments(message)
  const creditsLimit = Number.isInteger(user?.smsCreditsLimit) && user.smsCreditsLimit >= 0
    ? user.smsCreditsLimit
    : SMS_MONTHLY_CREDITS
  const creditsUsed = Number.isInteger(user?.smsCreditsUsed) && user.smsCreditsUsed >= 0
    ? user.smsCreditsUsed
    : 0

  const baseChecks = {
    previewEnvironment: process.env.VERCEL_ENV === 'preview',
    firebaseProjectExact: process.env.FIREBASE_PROJECT_ID === EXPECTED_FIREBASE_PROJECT,
    userExists: userSnap.exists,
    dogExists: dogSnap.exists,
    dogNameExact: dog?.name === QA_DOG_NAME,
    dogOwnedByExactUid: Boolean(dog && (dog.currentOwnerId === QA_UID || (!dog.currentOwnerId && dog.tenantId === QA_UID))),
    activeWormingExists: Boolean(activeWorming),
    wormingDueExact: dateOnly(activeWorming?.nextDue) === QA_WORMING_DUE,
    smsAddonActive: user?.smsAddonStatus === 'active',
    smsCreditsLimit20: creditsLimit === SMS_MONTHLY_CREDITS,
    smsBillingPeriodValid: validSmsPeriod(user),
    validAustralianMobile: Boolean(phone),
    oneSmsSegment: segmentCount === 1,
    smsProviderIsClickSend: getSmsProviderName() === 'clicksend',
    smsProviderConfigPresent: smsProviderConfigStatus().configured,
  }
  const baseSafe = Object.values(baseChecks).every(Boolean)

  return {
    user,
    dog,
    activeWorming,
    idempotencyKey,
    deliveryId,
    delivery,
    phone,
    message,
    segmentCount,
    creditsLimit,
    creditsUsed,
    baseChecks,
    baseSafe,
  }
}

function publicState(state) {
  return {
    target: {
      uid: QA_UID,
      dogId: QA_DOG_ID,
      dogName: QA_DOG_NAME,
      wormingRecordId: state.activeWorming?.id || null,
      wormingDue: dateOnly(state.activeWorming?.nextDue),
    },
    sms: {
      addonStatus: state.user?.smsAddonStatus || null,
      creditsUsed: state.creditsUsed,
      creditsLimit: state.creditsLimit,
      periodStart: state.user?.smsPeriodStart || null,
      periodEnd: state.user?.smsPeriodEnd || null,
      phoneValid: Boolean(state.phone),
      phoneSuffix: state.phone ? state.phone.slice(-3) : null,
      segmentCount: state.segmentCount,
      idempotencyKey: state.idempotencyKey,
      deliveryId: state.deliveryId,
      deliveryStatus: state.delivery?.status || null,
      providerMessageIdPresent: Boolean(state.delivery?.providerMessageId),
    },
    checks: state.baseChecks,
  }
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(403).json({ error: 'Preview-only Black Boy SMS QA' })
  }
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const [{ initializeApp, getApps, cert }, { getFirestore }] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
    ])
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      })
    }
    const db = getFirestore()
    const before = await loadState(db)
    const details = publicState(before)
    const failedDeliveryRetryable = before.delivery?.status === 'failed' && before.creditsUsed === 0

    if (req.method === 'GET') {
      const safeToSend = before.baseSafe && before.creditsUsed === 0 && (!before.delivery || failedDeliveryRetryable)
      return res.status(200).json({ safeToSend, failedDeliveryRetryable, ...details })
    }

    // A second POST with the exact same delivery must hit the quota helper's
    // DUPLICATE guard, proving idempotency without sending or charging again.
    const existingIsDuplicate = before.delivery && ['reserved', 'sent'].includes(before.delivery.status)
    if (!before.baseSafe) {
      return res.status(409).json({ sent: false, reason: 'QA_PRECONDITION_FAILED', ...details })
    }
    if (!existingIsDuplicate && !failedDeliveryRetryable && (before.delivery || before.creditsUsed !== 0)) {
      return res.status(409).json({ sent: false, reason: 'QA_STATE_NOT_CLEAN', ...details })
    }

    const sendProvider = (phone, message) => sendConfiguredSmsProvider(phone, message)

    const result = await sendSmsWithQuota({
      db,
      tenantId: QA_UID,
      phone: before.phone,
      message: before.message,
      dogId: QA_DOG_ID,
      eventType: 'worming',
      sourceRecordId: before.activeWorming.id,
      milestoneKey: before.activeWorming.nextDue,
      idempotencyKey: before.idempotencyKey,
      sendProvider,
      now: new Date(),
    })

    const after = await loadState(db)
    return res.status(200).json({
      sent: result.sent === true,
      reason: result.reason || null,
      acceptedUnconfirmed: result.acceptedUnconfirmed === true,
      deliveryId: result.deliveryId || before.deliveryId,
      creditsBefore: before.creditsUsed,
      creditsAfter: after.creditsUsed,
      deliveryStatusAfter: after.delivery?.status || null,
      providerMessageIdPresent: Boolean(after.delivery?.providerMessageId),
      duplicateProtected: result.reason === 'DUPLICATE',
      target: publicState(after).target,
    })
  } catch (error) {
    console.error('Black Boy single-user SMS QA failed', String(error?.code || 'unknown'))
    return res.status(500).json({ sent: false, error: 'QA_SEND_FAILED', code: String(error?.code || 'unknown') })
  }
}
