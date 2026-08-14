import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'

const TARGET_WINDOW_MS = 24 * 60 * 60 * 1000
const ACTOR_WINDOW_MS = 60 * 60 * 1000
const TARGET_LIMIT = 3
const ACTOR_LIMIT = 20
const RATE_COLLECTION = 'superAdminPasswordResetRateLimits'

export class PasswordResetError extends Error {
  constructor(status, message, outcome = 'delivery_failed', diagnostic = null) {
    super(message)
    this.name = 'PasswordResetError'
    this.status = status
    this.outcome = outcome
    this.diagnostic = diagnostic
  }
}

function safeToken(value, fallback) {
  const token = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_.:/-]{1,120}$/.test(token) ? token : fallback
}

export const safeRequestId = value => safeToken(value, 'request-unavailable')
export const safeProviderCode = value => safeToken(value, 'unknown_error')

export function logPasswordResetDiagnostic(logger, fields) {
  const entry = { event: 'super_admin_password_reset_failed', stage: fields.stage, requestId: safeRequestId(fields.requestId) }
  if (fields.stage === 'firebase_reset_link_generation') entry.code = safeProviderCode(fields.code)
  if (fields.stage === 'resend_delivery') {
    entry.status = Number.isInteger(fields.status) ? fields.status : 0
    entry.code = safeProviderCode(fields.code)
  }
  if (fields.stage === 'audit_finalize') entry.category = safeProviderCode(fields.category)
  logger(JSON.stringify(entry))
  return entry
}

export function validatePasswordResetPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PasswordResetError(400, 'A JSON request body is required', 'rejected')
  const unexpected = Object.keys(body).filter(key => key !== 'reason' && key !== 'confirmed')
  if (unexpected.length) throw new PasswordResetError(400, `Unexpected field: ${unexpected[0]}`, 'rejected')
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 5) throw new PasswordResetError(400, 'Reason must contain at least 5 characters', 'rejected')
  if (reason.length > 500) throw new PasswordResetError(400, 'Reason must not exceed 500 characters', 'rejected')
  if (body.confirmed !== true) throw new PasswordResetError(400, 'Explicit confirmation is required', 'rejected')
  return { reason }
}

export function supportsPasswordSignIn(authUser) {
  return Array.isArray(authUser?.providerData) && authUser.providerData.some(provider => provider?.providerId === 'password')
}

function counter(data, nowMs, windowMs) {
  if (!data || typeof data.windowStart !== 'number' || nowMs - data.windowStart >= windowMs) return { windowStart: nowMs, count: 0 }
  return { windowStart: data.windowStart, count: Number.isFinite(data.count) ? data.count : 0 }
}

export function evaluatePasswordResetRateLimits({ actorData, targetData, nowMs = Date.now() }) {
  const actorCounter = counter(actorData, nowMs, ACTOR_WINDOW_MS)
  const targetCounter = counter(targetData, nowMs, TARGET_WINDOW_MS)
  if (targetCounter.count >= TARGET_LIMIT) return { allowed: false, actorCounter, targetCounter, message: 'Too many password reset attempts for this account. Try again later.' }
  if (actorCounter.count >= ACTOR_LIMIT) return { allowed: false, actorCounter, targetCounter, message: 'Administrator password reset limit reached. Try again later.' }
  return { allowed: true, actorCounter, targetCounter }
}

export function buildPasswordResetAudit({ actor, target, reason, outcome, timestamp, providerMessageId = null }) {
  return {
    action: 'send_password_reset_email',
    details: 'Super Admin password reset email delivery attempt; password remains unchanged',
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
    beforeState: { passwordStatus: 'unchanged', resetEmailDelivery: 'not_sent' },
    afterState: { passwordStatus: 'unchanged', resetEmailDelivery: outcome === 'sent' ? 'sent' : 'not_sent' },
    outcome,
    providerMessageId: outcome === 'sent' ? providerMessageId || null : null,
    createdAt: timestamp,
  }
}

function hash(value) { return createHash('sha256').update(String(value)).digest('hex') }

export async function writePasswordResetAudit(auditRef, context, outcome) {
  await auditRef.set(buildPasswordResetAudit({ ...context, outcome, timestamp: FieldValue.serverTimestamp() }))
}

export async function reservePasswordResetAttempt(db, auditRef, context, nowMs = Date.now()) {
  const actorRef = db.collection(RATE_COLLECTION).doc(`actor_${hash(context.actor.uid)}`)
  const targetRef = db.collection(RATE_COLLECTION).doc(`target_${hash(context.target.uid)}`)
  return db.runTransaction(async transaction => {
    const [actorSnap, targetSnap] = await Promise.all([transaction.get(actorRef), transaction.get(targetRef)])
    const decision = evaluatePasswordResetRateLimits({ actorData: actorSnap.exists ? actorSnap.data() : null, targetData: targetSnap.exists ? targetSnap.data() : null, nowMs })
    if (!decision.allowed) {
      transaction.set(auditRef, buildPasswordResetAudit({ ...context, outcome: 'rate_limited', timestamp: FieldValue.serverTimestamp() }))
      return decision
    }
    transaction.set(actorRef, { windowStart: decision.actorCounter.windowStart, count: decision.actorCounter.count + 1, expiresAt: new Date(nowMs + ACTOR_WINDOW_MS * 2) })
    transaction.set(targetRef, { windowStart: decision.targetCounter.windowStart, count: decision.targetCounter.count + 1, expiresAt: new Date(nowMs + TARGET_WINDOW_MS * 2) })
    transaction.set(auditRef, buildPasswordResetAudit({ ...context, outcome: 'delivery_failed', timestamp: FieldValue.serverTimestamp() }))
    return { allowed: true }
  })
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) }

export function passwordResetEmailHtml({ resetLink }) {
  const safeLink = escapeHtml(resetLink)
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1A1917">
    <img src="https://idogs.com.au/01_idogs_primary_horizontal_transparent.png" width="180" alt="iDogs" style="display:block;width:180px;max-width:100%;height:auto;margin:0 0 28px" />
    <h1 style="font-size:22px;margin:0 0 14px;color:#085041">Reset your iDogs password</h1>
    <p style="font-size:15px;line-height:1.7;color:#5C5A54">An iDogs support administrator requested a password reset email for your account.</p>
    <p style="margin:24px 0"><a href="${safeLink}" style="display:inline-block;background:#085041;color:#fff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:10px;text-decoration:none">Reset password</a></p>
    <p style="font-size:13px;line-height:1.6;color:#5C5A54">If you ignore this email, your password remains unchanged.</p>
    <hr style="border:0;border-top:1px solid #E2DFD8;margin:24px 0" /><p style="font-size:12px;color:#9A9891">iDogs &middot; Every dog's story, connected for life &middot; <a href="https://idogs.com.au" style="color:#085041">idogs.com.au</a></p></div>`
}

export async function sendPasswordResetViaResend({ email, resetLink, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'iDogs <noreply@idogs.com.au>', to: [email], subject: 'Reset your iDogs password', html: passwordResetEmailHtml({ resetLink }) }),
  })
  if (!response.ok) {
    const provider = await response.json().catch(() => ({}))
    throw new PasswordResetError(502, 'Password reset email could not be delivered', 'delivery_failed', { stage: 'resend_delivery', status: response.status, code: safeProviderCode(provider?.name || provider?.code) })
  }
  const data = await response.json().catch(() => ({}))
  return typeof data.id === 'string' ? data.id : null
}

export async function performPasswordResetDelivery({ auth, auditRef, target, continueUrl, fetchImpl, requestId, logger = console.error }) {
  let resetLink
  try {
    resetLink = await auth.generatePasswordResetLink(target.email, { url: continueUrl })
  } catch (error) {
    logPasswordResetDiagnostic(logger, { stage: 'firebase_reset_link_generation', code: error?.code, requestId })
    throw new PasswordResetError(502, 'Password reset email could not be delivered')
  }
  let providerMessageId
  try {
    providerMessageId = await sendPasswordResetViaResend({ email: target.email, resetLink, fetchImpl })
  } catch (error) {
    const diagnostic = error instanceof PasswordResetError ? error.diagnostic : null
    logPasswordResetDiagnostic(logger, { stage: 'resend_delivery', status: diagnostic?.status, code: diagnostic?.code, requestId })
    throw new PasswordResetError(502, 'Password reset email could not be delivered')
  }
  try {
    await auditRef.update({ outcome: 'sent', providerMessageId: providerMessageId || null, afterState: { passwordStatus: 'unchanged', resetEmailDelivery: 'sent' } })
  } catch {
    logPasswordResetDiagnostic(logger, { stage: 'audit_finalize', category: 'sent_update', requestId })
    throw new PasswordResetError(502, 'Password reset email could not be delivered')
  }
  return { providerMessageId }
}

export const PASSWORD_RESET_LIMITS = Object.freeze({ TARGET_LIMIT, TARGET_WINDOW_MS, ACTOR_LIMIT, ACTOR_WINDOW_MS })
