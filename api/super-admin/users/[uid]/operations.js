import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from '../../_auth.js'
import {
  OperationError,
  accountState,
  buildAuditRecord,
  executeAccountAccessChange,
  normalizeEntitlement,
  resolveEntitlementOperation,
  validateOperationPayload,
} from '../../_operations.js'

function safeTarget(profile, authUser, uid) {
  return {
    uid,
    email: profile?.email || authUser?.email || null,
    role: profile?.role || null,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const actorToken = await verifySuperAdmin(req, res)
  if (!actorToken) return

  try {
    const { uid } = req.query
    if (typeof uid !== 'string' || !uid.trim() || uid.length > 128) {
      throw new OperationError(400, 'A valid target UID is required')
    }

    const operation = validateOperationPayload(req.body)
    const actor = {
      uid: actorToken.uid,
      email: String(actorToken.email || '').toLowerCase().trim(),
    }
    if (uid === actor.uid && operation.action === 'suspend_account') {
      throw new OperationError(400, 'Super Admins cannot suspend their own account')
    }

    const db = getFirestore()
    const auth = getAuth()
    const profileRef = db.collection('users').doc(uid)
    const auditRef = db.collection('auditLogs').doc()
    const [profileDoc, authResult] = await Promise.all([
      profileRef.get(),
      auth.getUser(uid).catch(error => error.code === 'auth/user-not-found' ? null : Promise.reject(error)),
    ])
    const profile = profileDoc.exists ? profileDoc.data() : null
    const authUser = authResult
    if (!profile && !authUser) throw new OperationError(404, 'Target account not found')

    const target = safeTarget(profile, authUser, uid)
    const nowIso = new Date().toISOString()

    if (operation.action === 'suspend_account' || operation.action === 'reactivate_account') {
      if (!authUser) throw new OperationError(409, 'Target has no Firebase Auth account')
      const shouldDisable = operation.action === 'suspend_account'
      if (!!authUser.disabled === shouldDisable) {
        throw new OperationError(409, `Account is already ${shouldDisable ? 'suspended' : 'active'}`)
      }

      const beforeState = { account: accountState(authUser), entitlement: normalizeEntitlement(profile?.internalEntitlement) }
      const afterState = { account: { authExists: true, access: shouldDisable ? 'suspended' : 'active', disabled: shouldDisable }, entitlement: beforeState.entitlement }
      const audit = buildAuditRecord({ actor, target, action: operation.action, reason: operation.reason, beforeState, afterState, timestamp: FieldValue.serverTimestamp() })
      await executeAccountAccessChange({ auth, auditRef, uid, shouldDisable, audit })

      return res.status(200).json({ success: true, action: operation.action, account: afterState.account, auditId: auditRef.id })
    }

    if (!profileDoc.exists) throw new OperationError(409, 'Target has no Firestore user profile')

    let responseEntitlement = null
    await db.runTransaction(async transaction => {
      const freshDoc = await transaction.get(profileRef)
      if (!freshDoc.exists) throw new OperationError(409, 'Target user profile no longer exists')
      const freshProfile = freshDoc.data()
      const current = freshProfile.internalEntitlement
      const next = resolveEntitlementOperation({ current, operation, actorEmail: actor.email, nowIso })
      const beforeState = { account: accountState(authUser), entitlement: normalizeEntitlement(current) }
      const afterState = { account: beforeState.account, entitlement: normalizeEntitlement(next) }
      const audit = buildAuditRecord({ actor, target: safeTarget(freshProfile, authUser, uid), action: operation.action, reason: operation.reason, beforeState, afterState, timestamp: FieldValue.serverTimestamp() })

      transaction.update(profileRef, { internalEntitlement: next })
      transaction.set(auditRef, audit)
      responseEntitlement = afterState.entitlement
    })

    return res.status(200).json({ success: true, action: operation.action, entitlement: responseEntitlement, auditId: auditRef.id })
  } catch (error) {
    if (error instanceof OperationError) return res.status(error.status).json({ error: error.message })
    console.error('Super Admin operation failed:', error)
    return res.status(500).json({ error: 'Administrative operation failed' })
  }
}
