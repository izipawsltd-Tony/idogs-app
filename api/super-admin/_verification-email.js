import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'

const TARGET_WINDOW_MS = 24 * 60 * 60 * 1000
const ACTOR_WINDOW_MS = 60 * 60 * 1000
const TARGET_LIMIT = 3
const ACTOR_LIMIT = 20
const RATE_COLLECTION = 'superAdminVerificationEmailRateLimits'

export class VerificationEmailError extends Error {
  constructor(status, message, outcome = 'rejected', diagnostic = null) {
    super(message)
    this.name = 'VerificationEmailError'
    this.status = status
    this.outcome = outcome
    this.diagnostic = diagnostic
  }
}

function safeDiagnosticToken(value, fallback) {
  const token = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_.:/-]{1,120}$/.test(token) ? token : fallback
}

export function safeRequestId(value) {
  return safeDiagnosticToken(value, 'request-unavailable')
}

export function safeProviderCode(value) {
  return safeDiagnosticToken(value, 'unknown_error')
}

export function logVerificationDiagnostic(logger, fields) {
  const entry = {
    event: 'super_admin_verification_email_failed',
    stage: fields.stage,
    requestId: safeRequestId(fields.requestId),
  }
  if (fields.stage === 'firebase_link_generation') entry.code = safeProviderCode(fields.code)
  if (fields.stage === 'resend_delivery') {
    entry.status = Number.isInteger(fields.status) ? fields.status : 0
    entry.code = safeProviderCode(fields.code)
  }
  if (fields.stage === 'audit_finalize') entry.category = safeProviderCode(fields.category)
  logger(JSON.stringify(entry))
  return entry
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function validateVerificationEmailPayload(body) {
  if (!isPlainObject(body)) throw new VerificationEmailError(400, 'A JSON request body is required')
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 5) throw new VerificationEmailError(400, 'Reason must contain at least 5 characters')
  if (reason.length > 500) throw new VerificationEmailError(400, 'Reason must not exceed 500 characters')
  if (body.confirmed !== true) throw new VerificationEmailError(400, 'Explicit confirmation is required')
  const unexpected = Object.keys(body).filter(key => key !== 'reason' && key !== 'confirmed')
  if (unexpected.length) throw new VerificationEmailError(400, `Unexpected field: ${unexpected[0]}`)
  return { reason }
}

function safeKey(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function currentCounter(data, nowMs, windowMs) {
  if (!data || typeof data.windowStart !== 'number' || nowMs - data.windowStart >= windowMs) {
    return { windowStart: nowMs, count: 0 }
  }
  return { windowStart: data.windowStart, count: Number.isFinite(data.count) ? data.count : 0 }
}

export function evaluateVerificationRateLimits({ actorData, targetData, nowMs = Date.now() }) {
  const actorCounter = currentCounter(actorData, nowMs, ACTOR_WINDOW_MS)
  const targetCounter = currentCounter(targetData, nowMs, TARGET_WINDOW_MS)
  if (targetCounter.count >= TARGET_LIMIT) {
    return { allowed: false, message: 'Too many verification emails for this account. Try again later.', actorCounter, targetCounter }
  }
  if (actorCounter.count >= ACTOR_LIMIT) {
    return { allowed: false, message: 'Administrator verification email limit reached. Try again later.', actorCounter, targetCounter }
  }
  return { allowed: true, actorCounter, targetCounter }
}

export function buildVerificationAudit({ actor, target, reason, outcome, timestamp, providerMessageId = null }) {
  return {
    action: 'super_admin_send_verification_email',
    details: 'Super Admin verification email delivery attempt',
    reason,
    performedBy: actor.uid,
    performedByEmail: actor.email,
    actor: { uid: actor.uid, email: actor.email },
    targetUserId: target.uid,
    targetUserEmail: target.email || null,
    targetOrganisationId: target.organisationId || null,
    targetOrganisationName: target.organisationName || null,
    target: { uid: target.uid, email: target.email || null },
    tenantId: target.uid,
    beforeState: { emailVerified: target.emailVerified === true },
    afterState: { emailVerified: target.emailVerified === true },
    outcome,
    providerMessageId: providerMessageId || null,
    createdAt: timestamp,
  }
}

export async function recordRejectedAttempt(db, auditRef, context) {
  await auditRef.set(buildVerificationAudit({ ...context, outcome: 'rejected', timestamp: FieldValue.serverTimestamp() }))
}

export async function reserveVerificationAttempt(db, auditRef, context, nowMs = Date.now()) {
  const actorRef = db.collection(RATE_COLLECTION).doc(`actor_${safeKey(context.actor.uid)}`)
  const targetRef = db.collection(RATE_COLLECTION).doc(`target_${safeKey(context.target.uid)}`)

  return db.runTransaction(async transaction => {
    const [actorSnap, targetSnap] = await Promise.all([transaction.get(actorRef), transaction.get(targetRef)])
    const decision = evaluateVerificationRateLimits({
      actorData: actorSnap.exists ? actorSnap.data() : null,
      targetData: targetSnap.exists ? targetSnap.data() : null,
      nowMs,
    })
    const { actorCounter, targetCounter } = decision

    if (!decision.allowed) {
      transaction.set(auditRef, buildVerificationAudit({ ...context, outcome: 'rejected', timestamp: FieldValue.serverTimestamp() }))
      return { allowed: false, message: decision.message }
    }

    transaction.set(actorRef, { windowStart: actorCounter.windowStart, count: actorCounter.count + 1, expiresAt: new Date(nowMs + ACTOR_WINDOW_MS * 2) })
    transaction.set(targetRef, { windowStart: targetCounter.windowStart, count: targetCounter.count + 1, expiresAt: new Date(nowMs + TARGET_WINDOW_MS * 2) })
    // Fail-safe reservation: never claim sent until the provider confirms it.
    transaction.set(auditRef, buildVerificationAudit({ ...context, outcome: 'delivery_failed', timestamp: FieldValue.serverTimestamp() }))
    return { allowed: true }
  })
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

export function verificationEmailHtml({ verificationLink }) {
  const safeLink = escapeHtml(verificationLink)
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1A1917">
      <img src="https://idogs.com.au/01_idogs_primary_horizontal_transparent.png" width="180" alt="iDogs" style="display:block;width:180px;max-width:100%;height:auto;margin:0 0 28px" />
      <h1 style="font-size:22px;margin:0 0 14px;color:#085041">Verify your email address</h1>
      <p style="font-size:15px;line-height:1.7;color:#5C5A54">An iDogs support administrator requested a new verification email for your account.</p>
      <p style="margin:24px 0"><a href="${safeLink}" style="display:inline-block;background:#085041;color:#fff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:10px;text-decoration:none">Verify email address</a></p>
      <p style="font-size:13px;line-height:1.6;color:#5C5A54">If you did not request support, you can safely ignore this email. Your account has not been changed.</p>
      <hr style="border:0;border-top:1px solid #E2DFD8;margin:24px 0" />
      <p style="font-size:12px;color:#9A9891">iDogs &middot; Every dog's story, connected for life &middot; <a href="https://idogs.com.au" style="color:#085041">idogs.com.au</a></p>
    </div>`
}

export async function sendViaResend({ email, verificationLink, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'iDogs <noreply@idogs.com.au>',
      to: [email],
      subject: 'Verify your iDogs email address',
      html: verificationEmailHtml({ verificationLink }),
    }),
  })
  if (!response.ok) {
    const provider = await response.json().catch(() => ({}))
    throw new VerificationEmailError(502, 'Verification email could not be delivered', 'delivery_failed', {
      stage: 'resend_delivery',
      status: response.status,
      code: safeProviderCode(provider?.name || provider?.code),
    })
  }
  const data = await response.json().catch(() => ({}))
  return typeof data.id === 'string' ? data.id : null
}

async function markDeliveryFailed(auditRef, providerMessageId, requestId, logger) {
  try {
    await auditRef.update({ outcome: 'delivery_failed', providerMessageId: providerMessageId || null })
  } catch {
    logVerificationDiagnostic(logger, { stage: 'audit_finalize', category: 'delivery_failed_update', requestId })
  }
}

export async function performVerificationDelivery({ auth, auditRef, target, continueUrl, fetchImpl, requestId, logger = console.error }) {
  let verificationLink
  try {
    verificationLink = await auth.generateEmailVerificationLink(target.email, { url: continueUrl })
  } catch (error) {
    logVerificationDiagnostic(logger, { stage: 'firebase_link_generation', code: error?.code, requestId })
    await markDeliveryFailed(auditRef, null, requestId, logger)
    throw new VerificationEmailError(502, 'Verification email could not be delivered', 'delivery_failed')
  }

  let providerMessageId
  try {
    providerMessageId = await sendViaResend({ email: target.email, verificationLink, fetchImpl })
  } catch (error) {
    const diagnostic = error instanceof VerificationEmailError ? error.diagnostic : null
    logVerificationDiagnostic(logger, {
      stage: 'resend_delivery',
      status: diagnostic?.status,
      code: diagnostic?.code,
      requestId,
    })
    await markDeliveryFailed(auditRef, null, requestId, logger)
    throw new VerificationEmailError(502, 'Verification email could not be delivered', 'delivery_failed')
  }

  try {
    await auditRef.update({ outcome: 'sent', providerMessageId: providerMessageId || null })
  } catch {
    logVerificationDiagnostic(logger, { stage: 'audit_finalize', category: 'sent_update', requestId })
    throw new VerificationEmailError(502, 'Verification email could not be delivered', 'delivery_failed')
  }
  return { providerMessageId }
}

export const VERIFICATION_EMAIL_LIMITS = Object.freeze({ TARGET_LIMIT, TARGET_WINDOW_MS, ACTOR_LIMIT, ACTOR_WINDOW_MS })
