import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from '../../_auth.js'
import {
  VerificationEmailError,
  buildVerificationAudit,
  performVerificationDelivery,
  recordRejectedAttempt,
  reserveVerificationAttempt,
  validateVerificationEmailPayload,
} from '../../_verification-email.js'

function targetIdentity(uid, authUser, profile) {
  const organisationName = profile?.role === 'breeder'
    ? profile.kennelName || profile.displayName || `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || null
    : null
  return {
    uid,
    email: authUser?.email || null,
    emailVerified: authUser?.emailVerified === true,
    organisationId: profile?.role === 'breeder' ? uid : null,
    organisationName,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const actorToken = await verifySuperAdmin(req, res)
  if (!actorToken) return

  let auditRef = null
  let context = null
  try {
    const uid = typeof req.query.uid === 'string' ? req.query.uid.trim() : ''
    if (!uid || uid.length > 128 || !/^[A-Za-z0-9_-]+$/.test(uid)) {
      throw new VerificationEmailError(404, 'Target account not found')
    }
    const { reason } = validateVerificationEmailPayload(req.body)
    const db = getFirestore()
    const auth = getAuth()
    auditRef = db.collection('auditLogs').doc()
    const actor = { uid: actorToken.uid, email: String(actorToken.email || '').toLowerCase().trim() }
    const [authUser, profileDoc] = await Promise.all([
      auth.getUser(uid).catch(error => error.code === 'auth/user-not-found' ? null : Promise.reject(error)),
      db.collection('users').doc(uid).get(),
    ])
    const profile = profileDoc.exists ? profileDoc.data() : null
    const target = targetIdentity(uid, authUser, profile)
    context = { actor, target, reason }

    if (!authUser || !authUser.email) {
      await recordRejectedAttempt(db, auditRef, context)
      throw new VerificationEmailError(404, 'Target account not found')
    }
    if (authUser.emailVerified) {
      await recordRejectedAttempt(db, auditRef, context)
      throw new VerificationEmailError(409, 'Account email is already verified')
    }

    const reservation = await reserveVerificationAttempt(db, auditRef, context)
    if (!reservation.allowed) throw new VerificationEmailError(429, reservation.message)

    const baseUrl = String(process.env.APP_URL || 'https://idogs.com.au').replace(/\/$/, '')
    await performVerificationDelivery({ auth, auditRef, target, continueUrl: `${baseUrl}/login` })
    return res.status(200).json({ success: true, outcome: 'sent', auditId: auditRef.id })
  } catch (error) {
    if (error instanceof VerificationEmailError) return res.status(error.status).json({ error: error.message })
    console.error('Super Admin verification email attempt failed', { auditId: auditRef?.id || null })
    if (auditRef && context) {
      await auditRef.set(buildVerificationAudit({ ...context, outcome: 'delivery_failed', timestamp: FieldValue.serverTimestamp() }), { merge: true }).catch(() => {})
    }
    return res.status(500).json({ error: 'Verification email operation failed' })
  }
}
