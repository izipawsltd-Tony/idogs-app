import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { verifySuperAdmin } from '../../_auth.js'
import { PasswordResetError, performPasswordResetDelivery, reservePasswordResetAttempt, safeRequestId, supportsPasswordSignIn, validatePasswordResetPayload, writePasswordResetAudit } from '../../_password-reset.js'

function identity(uid, authUser, profile) {
  const organisationName = profile?.role === 'breeder' ? profile.kennelName || profile.displayName || `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || null : null
  return { uid, email: authUser?.email || null, organisationId: profile?.role === 'breeder' ? uid : null, organisationName }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const actorToken = await verifySuperAdmin(req, res)
  if (!actorToken) return
  const requestId = safeRequestId(req.headers['x-vercel-id'] || randomUUID())
  let auditRef = null
  let context = null
  try {
    const uid = typeof req.query.uid === 'string' ? req.query.uid.trim() : ''
    if (!uid || uid.length > 128 || !/^[A-Za-z0-9_-]+$/.test(uid)) throw new PasswordResetError(404, 'Target account not found', 'auth_unavailable')
    const { reason } = validatePasswordResetPayload(req.body)
    const db = getFirestore()
    const auth = getAuth()
    auditRef = db.collection('auditLogs').doc()
    const actor = { uid: actorToken.uid, email: String(actorToken.email || '').toLowerCase().trim() }
    const [authUser, profileDoc] = await Promise.all([
      auth.getUser(uid).catch(error => error.code === 'auth/user-not-found' ? null : Promise.reject(error)),
      db.collection('users').doc(uid).get(),
    ])
    const target = identity(uid, authUser, profileDoc.exists ? profileDoc.data() : null)
    context = { actor, target, reason }
    if (!authUser || !authUser.email) {
      await writePasswordResetAudit(auditRef, context, 'auth_unavailable')
      throw new PasswordResetError(404, 'Password reset is unavailable for this account', 'auth_unavailable')
    }
    if (!supportsPasswordSignIn(authUser)) {
      await writePasswordResetAudit(auditRef, context, 'unsupported_provider')
      throw new PasswordResetError(409, 'Password reset is unsupported for this sign-in provider', 'unsupported_provider')
    }
    const reservation = await reservePasswordResetAttempt(db, auditRef, context)
    if (!reservation.allowed) throw new PasswordResetError(429, reservation.message, 'rate_limited')
    const baseUrl = String(process.env.APP_URL || 'https://idogs.com.au').replace(/\/$/, '')
    await performPasswordResetDelivery({ auth, auditRef, target, continueUrl: `${baseUrl}/login`, requestId })
    return res.status(200).json({ success: true, outcome: 'sent', auditId: auditRef.id, referenceId: requestId })
  } catch (error) {
    if (error instanceof PasswordResetError) return res.status(error.status).json({ error: error.message, referenceId: requestId })
    console.error(JSON.stringify({ event: 'super_admin_password_reset_failed', stage: 'runtime_other', requestId }))
    if (auditRef && context) await writePasswordResetAudit(auditRef, context, 'delivery_failed').catch(() => {})
    return res.status(500).json({ error: 'Password reset email operation failed', referenceId: requestId })
  }
}
