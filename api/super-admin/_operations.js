const ACTIONS = new Set([
  'suspend_account',
  'reactivate_account',
  'grant_entitlement',
  'update_entitlement',
  'revoke_entitlement',
])

const MAX_REASON_LENGTH = 500

export class OperationError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'OperationError'
    this.status = status
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function validateOperationPayload(body) {
  if (!isPlainObject(body)) throw new OperationError(400, 'A JSON request body is required')

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  if (!ACTIONS.has(action)) throw new OperationError(400, 'Unsupported administrative action')

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 5) throw new OperationError(400, 'Reason must contain at least 5 characters')
  if (reason.length > MAX_REASON_LENGTH) throw new OperationError(400, `Reason must not exceed ${MAX_REASON_LENGTH} characters`)

  const entitlementAction = action === 'grant_entitlement' || action === 'update_entitlement'
  let expiresAt = null
  if (entitlementAction && body.expiresAt !== null && body.expiresAt !== undefined && body.expiresAt !== '') {
    if (typeof body.expiresAt !== 'string') throw new OperationError(400, 'expiresAt must be an ISO date-time string or null')
    const parsed = new Date(body.expiresAt)
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new OperationError(400, 'expiresAt must be a valid future ISO date-time')
    }
    expiresAt = parsed.toISOString()
  }

  const allowedKeys = new Set(entitlementAction ? ['action', 'reason', 'expiresAt'] : ['action', 'reason'])
  const unexpected = Object.keys(body).filter(key => !allowedKeys.has(key))
  if (unexpected.length) throw new OperationError(400, `Unexpected field: ${unexpected[0]}`)

  return { action, reason, expiresAt }
}

export function normalizeEntitlement(value) {
  if (!isPlainObject(value)) return null
  return {
    granted: value.granted === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
    grantedAt: typeof value.grantedAt === 'string' ? value.grantedAt : null,
    grantedBy: typeof value.grantedBy === 'string' ? value.grantedBy : null,
    revokedAt: typeof value.revokedAt === 'string' ? value.revokedAt : null,
    revokedBy: typeof value.revokedBy === 'string' ? value.revokedBy : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : null,
  }
}

export function accountState(authUser) {
  if (!authUser) return { authExists: false, access: 'missing', disabled: null }
  return { authExists: true, access: authUser.disabled ? 'suspended' : 'active', disabled: !!authUser.disabled }
}

export function buildGrantedEntitlement({ actorEmail, reason, expiresAt, nowIso }) {
  return {
    granted: true,
    grantedAt: nowIso,
    grantedBy: actorEmail,
    reason,
    expiresAt,
  }
}

export function buildUpdatedEntitlement({ current, actorEmail, reason, expiresAt, nowIso }) {
  return {
    ...current,
    granted: true,
    reason,
    expiresAt,
    updatedAt: nowIso,
    updatedBy: actorEmail,
  }
}

export function buildRevokedEntitlement({ current, actorEmail, reason, nowIso }) {
  return {
    ...(isPlainObject(current) ? current : {}),
    granted: false,
    reason,
    revokedAt: nowIso,
    revokedBy: actorEmail,
  }
}

export function resolveEntitlementOperation({ current, operation, actorEmail, nowIso }) {
  if (operation.action === 'grant_entitlement' && current?.granted === true) {
    throw new OperationError(409, 'An active internal entitlement already exists; use update')
  }
  if (operation.action === 'update_entitlement' && current?.granted !== true) {
    throw new OperationError(409, 'No active internal entitlement exists to update')
  }
  if (operation.action === 'revoke_entitlement' && current?.granted !== true) {
    throw new OperationError(409, 'No active internal entitlement exists to revoke')
  }
  if (operation.action === 'revoke_entitlement') {
    return buildRevokedEntitlement({ current, actorEmail, reason: operation.reason, nowIso })
  }
  if (operation.action === 'update_entitlement') {
    return buildUpdatedEntitlement({ current, actorEmail, reason: operation.reason, expiresAt: operation.expiresAt, nowIso })
  }
  return buildGrantedEntitlement({ actorEmail, reason: operation.reason, expiresAt: operation.expiresAt, nowIso })
}

export async function executeAccountAccessChange({ auth, auditRef, uid, shouldDisable, audit }) {
  await auth.updateUser(uid, { disabled: shouldDisable })
  try {
    await auditRef.set(audit)
  } catch (auditError) {
    try {
      await auth.updateUser(uid, { disabled: !shouldDisable })
    } catch (rollbackError) {
      console.error('CRITICAL: Failed to rollback unaudited account access change', { uid, rollbackError })
    }
    throw auditError
  }
}

export function buildAuditRecord({ actor, target, action, reason, beforeState, afterState, timestamp }) {
  const labels = {
    suspend_account: 'Super Admin suspended account access',
    reactivate_account: 'Super Admin reactivated account access',
    grant_entitlement: 'Super Admin granted internal entitlement',
    update_entitlement: 'Super Admin updated internal entitlement',
    revoke_entitlement: 'Super Admin revoked internal entitlement',
  }
  return {
    action: `super_admin_${action}`,
    details: labels[action],
    reason,
    performedBy: actor.uid,
    performedByEmail: actor.email,
    actor: { uid: actor.uid, email: actor.email },
    targetUserId: target.uid,
    targetUserEmail: target.email,
    targetOrganisationId: target.role === 'breeder' ? target.uid : null,
    targetOrganisationName: target.role === 'breeder' ? target.organisationName : null,
    target: { uid: target.uid, email: target.email, role: target.role, organisationName: target.organisationName },
    tenantId: target.uid,
    beforeState,
    afterState,
    createdAt: timestamp,
  }
}
