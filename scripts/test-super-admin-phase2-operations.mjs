import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySuperAdmin } from '../api/super-admin/_auth.js'
import { normalizeAuditIdentity } from '../api/super-admin/_audit-view.js'
import {
  OperationError,
  accountState,
  buildAuditRecord,
  buildGrantedEntitlement,
  buildRevokedEntitlement,
  executeAccountAccessChange,
  normalizeEntitlement,
  resolveEntitlementOperation,
  validateOperationPayload,
} from '../api/super-admin/_operations.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0

function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed += 1
    console.log(`PASS: ${name}`)
  })
}

function responseDouble() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

await test('missing token returns 401', async () => {
  const res = responseDouble()
  const result = await verifySuperAdmin({ headers: {} }, res, { verifyIdToken: async () => assert.fail('must not verify') })
  assert.equal(result, null)
  assert.equal(res.statusCode, 401)
})

await test('unverified email returns 403', async () => {
  const res = responseDouble()
  const result = await verifySuperAdmin({ headers: { authorization: 'Bearer token' } }, res, { verifyIdToken: async () => ({ email: 'trunghieungo@gmail.com', email_verified: false }) })
  assert.equal(result, null)
  assert.equal(res.statusCode, 403)
})

await test('non-allowlisted email returns 403', async () => {
  const res = responseDouble()
  const result = await verifySuperAdmin({ headers: { authorization: 'Bearer token' } }, res, { verifyIdToken: async () => ({ email: 'user@example.com', email_verified: true }) })
  assert.equal(result, null)
  assert.equal(res.statusCode, 403)
})

await test('allowlisted verified admin is authorized', async () => {
  const token = { uid: 'admin-1', email: 'TRUNGHIEUNGO@GMAIL.COM', email_verified: true }
  const res = responseDouble()
  assert.equal(await verifySuperAdmin({ headers: { authorization: 'Bearer token' } }, res, { verifyIdToken: async () => token }), token)
})

await test('all five actions validate with required reason', () => {
  for (const action of ['suspend_account', 'reactivate_account', 'grant_entitlement', 'update_entitlement', 'revoke_entitlement']) {
    assert.equal(validateOperationPayload({ action, reason: 'Approved support case', ...(action.includes('entitlement') && action !== 'revoke_entitlement' ? { expiresAt: null } : {}) }).action, action)
  }
})

await test('unknown action, short reason, unexpected fields, malformed and past expiry fail validation', () => {
  const invalid = [
    { action: 'delete_user', reason: 'Approved reason' },
    { action: 'suspend_account', reason: 'no' },
    { action: 'suspend_account', reason: 'Approved reason', plan: 'plus' },
    { action: 'grant_entitlement', reason: 'Approved reason', expiresAt: 123 },
    { action: 'grant_entitlement', reason: 'Approved reason', expiresAt: '2020-01-01T00:00:00Z' },
  ]
  for (const payload of invalid) assert.throws(() => validateOperationPayload(payload), OperationError)
})

await test('grant/update payload preserves the existing entitlement model', () => {
  const next = buildGrantedEntitlement({ actorEmail: 'admin@example.com', reason: 'Internal access approved', expiresAt: null, nowIso: '2026-08-13T00:00:00.000Z' })
  assert.deepEqual(next, { granted: true, grantedAt: '2026-08-13T00:00:00.000Z', grantedBy: 'admin@example.com', reason: 'Internal access approved', expiresAt: null })
})

await test('authorized grant, update and revoke actions produce controlled entitlement states', () => {
  const actorEmail = 'admin@example.com'
  const nowIso = '2026-08-13T00:00:00.000Z'
  const grant = resolveEntitlementOperation({ current: null, operation: { action: 'grant_entitlement', reason: 'Approved internal access', expiresAt: null }, actorEmail, nowIso })
  assert.equal(grant.granted, true)
  const update = resolveEntitlementOperation({ current: grant, operation: { action: 'update_entitlement', reason: 'Extended internal access', expiresAt: '2027-01-01T00:00:00.000Z' }, actorEmail, nowIso })
  assert.equal(update.expiresAt, '2027-01-01T00:00:00.000Z')
  assert.equal(update.grantedAt, nowIso)
  assert.equal(update.updatedBy, actorEmail)
  const revoke = resolveEntitlementOperation({ current: update, operation: { action: 'revoke_entitlement', reason: 'Internal access ended' }, actorEmail, nowIso })
  assert.equal(revoke.granted, false)
})

await test('authorized account action writes Auth state then audit', async () => {
  const calls = []
  await executeAccountAccessChange({
    auth: { updateUser: async (uid, state) => calls.push(['auth', uid, state.disabled]) },
    auditRef: { set: async audit => calls.push(['audit', audit.action]) },
    uid: 'user-1', shouldDisable: true, audit: { action: 'super_admin_suspend_account' },
  })
  assert.deepEqual(calls, [['auth', 'user-1', true], ['audit', 'super_admin_suspend_account']])
})

await test('account action rolls Auth state back if mandatory audit creation fails', async () => {
  const states = []
  await assert.rejects(() => executeAccountAccessChange({
    auth: { updateUser: async (_uid, state) => states.push(state.disabled) },
    auditRef: { set: async () => { throw new Error('audit unavailable') } },
    uid: 'user-1', shouldDisable: true, audit: {},
  }), /audit unavailable/)
  assert.deepEqual(states, [true, false])
})

await test('revoke records actor/time/reason without touching Stripe fields', () => {
  const next = buildRevokedEntitlement({ current: { granted: true, expiresAt: null, grantedBy: 'old-admin' }, actorEmail: 'admin@example.com', reason: 'Access no longer required', nowIso: '2026-08-13T01:00:00.000Z' })
  assert.equal(next.granted, false)
  assert.equal(next.revokedBy, 'admin@example.com')
  assert.equal(next.revokedAt, '2026-08-13T01:00:00.000Z')
  assert.equal('plan' in next || 'stripeSubscriptionId' in next, false)
})

await test('audit record contains mandatory actor, target, action, reason, timestamp, before and after state', () => {
  const beforeState = { account: accountState({ disabled: false }), entitlement: null }
  const afterState = { account: accountState({ disabled: true }), entitlement: null }
  const audit = buildAuditRecord({ actor: { uid: 'admin-1', email: 'admin@example.com' }, target: { uid: 'user-1', email: 'user@example.com', role: 'breeder' }, action: 'suspend_account', reason: 'Security review requested', beforeState, afterState, timestamp: 'SERVER_TIMESTAMP' })
  assert.equal(audit.performedBy, 'admin-1')
  assert.equal(audit.targetUserId, 'user-1')
  assert.equal(audit.targetUserEmail, 'user@example.com')
  assert.equal(audit.targetOrganisationId, 'user-1')
  assert.equal(audit.targetOrganisationName, undefined)
  assert.equal(audit.reason, 'Security review requested')
  assert.deepEqual(audit.beforeState, beforeState)
  assert.deepEqual(audit.afterState, afterState)
  assert.equal(audit.createdAt, 'SERVER_TIMESTAMP')
})

await test('suspend/reactivate/grant/update/revoke audits all persist known target identity and state', () => {
  const actions = ['suspend_account', 'reactivate_account', 'grant_entitlement', 'update_entitlement', 'revoke_entitlement']
  for (const action of actions) {
    const audit = buildAuditRecord({
      actor: { uid: 'admin-1', email: 'admin@example.com' },
      target: { uid: 'user-1', email: 'breeder@example.com', role: 'breeder', organisationName: 'Example Kennel' },
      action,
      reason: `Approved ${action}`,
      beforeState: { account: { access: 'active' } },
      afterState: { account: { access: 'suspended' } },
      timestamp: 'SERVER_TIMESTAMP',
    })
    assert.equal(audit.targetUserId, 'user-1')
    assert.equal(audit.targetUserEmail, 'breeder@example.com')
    assert.equal(audit.targetOrganisationId, 'user-1')
    assert.equal(audit.targetOrganisationName, 'Example Kennel')
    assert.ok(audit.reason)
    assert.ok(audit.beforeState)
    assert.ok(audit.afterState)
  }
})

await test('older audit records without Phase 2 identity fields normalize safely', () => {
  assert.deepEqual(normalizeAuditIdentity({ action: 'dog_created', dogId: 'dog-1' }), {
    targetUserId: null,
    targetUserEmail: null,
    targetOrganisationId: null,
    targetOrganisationName: null,
    reason: null,
    beforeState: null,
    afterState: null,
  })
  const nested = normalizeAuditIdentity({ target: { uid: 'user-1', email: 'legacy@example.com', role: 'breeder' }, reason: 'Legacy nested target' })
  assert.equal(nested.targetUserEmail, 'legacy@example.com')
  assert.equal(nested.targetOrganisationId, 'user-1')
})

await test('entitlement snapshots expose only controlled entitlement fields', () => {
  assert.deepEqual(normalizeEntitlement({ granted: true, reason: 'ok', expiresAt: null, secret: 'nope' }), {
    granted: true, reason: 'ok', expiresAt: null, grantedAt: null, grantedBy: null, revokedAt: null, revokedBy: null, updatedAt: null, updatedBy: null,
  })
})

await test('endpoint uses server auth, Admin SDK writes, atomic entitlement audit, and account rollback on audit failure', () => {
  const source = fs.readFileSync(path.join(root, 'api/super-admin/users/[uid]/operations.js'), 'utf8')
  const operationSource = fs.readFileSync(path.join(root, 'api/super-admin/_operations.js'), 'utf8')
  assert.match(source, /verifySuperAdmin\(req, res\)/)
  assert.match(source, /executeAccountAccessChange/)
  assert.match(operationSource, /auth\.updateUser/)
  assert.match(source, /db\.runTransaction/)
  assert.match(source, /transaction\.update\(profileRef, \{ internalEntitlement: next \}\)/)
  assert.match(source, /transaction\.set\(auditRef, audit\)/)
  assert.match(operationSource, /Failed to rollback unaudited account access change/)
  assert.doesNotMatch(source, /stripeSubscriptionId|subscriptionStatus|customer\.subscriptions/)
})

await test('browser component has confirmation, required reason, no direct Firestore writes, and waits for server before success', () => {
  const source = fs.readFileSync(path.join(root, 'src/super-admin/SuperAdminAccountOperations.tsx'), 'utf8')
  assert.match(source, /I confirm this action/)
  assert.match(source, /reason\.trim\(\)\.length < 5/)
  assert.match(source, /await fetch\(`/)
  assert.match(source, /if \(!response\.ok\) throw/)
  assert.match(source, /await onUpdated\(\)/)
  assert.doesNotMatch(source, /firebase\/firestore|setDoc|updateDoc|deleteDoc|addDoc/)
})

await test('audit table renders target identity, organisation, reason, state transition, and safe legacy fallback', () => {
  const source = fs.readFileSync(path.join(root, 'src/super-admin/pages/SuperAdminAuditLogsPage.tsx'), 'utf8')
  for (const heading of ['Timestamp', 'Actor', 'Action', 'Target', 'Organisation']) {
    assert.match(source, new RegExp(`>${heading}<`))
  }
  assert.match(source, /targetUserEmail \|\| l\.targetUserId/)
  assert.match(source, /targetOrganisationName/)
  assert.match(source, /l\.reason \|\| ['"]Legacy reason not recorded['"]/)
  assert.match(source, /l\.details \|\| ['"]Legacy details not recorded['"]/)
  assert.match(source, /auditStateSummary\(l\.beforeState\).*auditStateSummary\(l\.afterState\)/s)
  assert.match(source, /Legacy target not recorded/)
  assert.doesNotMatch(source, /Read-only Phase 1|Admin write actions are not enabled in V1/)
})

await test('audit rows expose accessible responsive expand/collapse details', () => {
  const source = fs.readFileSync(path.join(root, 'src/super-admin/pages/SuperAdminAuditLogsPage.tsx'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'src/super-admin/superAdmin.css'), 'utf8')
  assert.match(source, /expandedLogId/)
  assert.match(source, /aria-expanded=\{isExpanded\}/)
  assert.match(source, /aria-controls=\{detailPanelId\}/)
  assert.match(source, /View details/)
  assert.match(source, /Hide details/)
  assert.match(source, />Reason</)
  assert.match(source, />Before state</)
  assert.match(source, />After state</)
  assert.match(source, /auditStateDetails\(l\.beforeState\)/)
  assert.match(source, /auditStateDetails\(l\.afterState\)/)
  assert.match(source, /Legacy reason not recorded/)
  assert.match(source, /Legacy target not recorded/)
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.super-admin-audit-table/)
  assert.doesNotMatch(source, /overflowX: ['"]auto['"]/)
})

await test('active Audit Logs navigation route mounts the Phase 2 component and normalized API', () => {
  const app = fs.readFileSync(path.join(root, 'src/components/App.tsx'), 'utf8')
  const nav = fs.readFileSync(path.join(root, 'src/super-admin/superAdminConfig.ts'), 'utf8')
  const page = fs.readFileSync(path.join(root, 'src/super-admin/pages/SuperAdminAuditLogsPage.tsx'), 'utf8')
  const api = fs.readFileSync(path.join(root, 'api/super-admin/audit-logs/index.js'), 'utf8')

  assert.match(app, /import SuperAdminAuditLogsPage from ['"]\.\.\/super-admin\/pages\/SuperAdminAuditLogsPage['"]/)
  assert.match(app, /<Route path="audit-logs" element=\{<SuperAdminAuditLogsPage \/>\} \/>/)
  assert.match(nav, /path: `\$\{SUPER_ADMIN_BASE_PATH\}\/audit-logs`/)
  assert.match(page, /fetch\(['"]\/api\/super-admin\/audit-logs['"]/)
  assert.match(api, /normalizeAuditIdentity\(d, usersMap\)/)
  assert.doesNotMatch(app, /SuperAdminWorkspacePage|\/app\/super-admin\/:section/)
})

console.log(`\n${passed} passed, 0 failed`)
