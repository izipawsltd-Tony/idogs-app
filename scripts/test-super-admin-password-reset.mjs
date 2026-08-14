import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  PASSWORD_RESET_LIMITS,
  buildPasswordResetAudit,
  evaluatePasswordResetRateLimits,
  logPasswordResetDiagnostic,
  performPasswordResetDelivery,
  supportsPasswordSignIn,
  validatePasswordResetPayload,
} from '../api/super-admin/_password-reset.js'

const root = process.cwd()
const endpoint = fs.readFileSync(path.join(root, 'api/super-admin/users/[uid]/password-reset.js'), 'utf8')
const ui = fs.readFileSync(path.join(root, 'src/super-admin/SuperAdminPasswordResetAction.tsx'), 'utf8')
const auditUi = fs.readFileSync(path.join(root, 'src/super-admin/pages/SuperAdminAuditLogsPage.tsx'), 'utf8')
let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`) }
const throwsStatus = (fn, status) => assert.throws(fn, error => error.status === status)
const context = { actor: { uid: 'admin', email: 'admin@example.test' }, target: { uid: 'target', email: 'target@example.test', organisationId: 'target', organisationName: 'Kennel' }, reason: 'Support request' }

await test('endpoint uses existing Super Admin authentication guard', () => {
  assert.match(endpoint, /await verifySuperAdmin\(req, res\)/)
  assert.match(endpoint, /if \(!actorToken\) return/)
})
await test('target identity is resolved by UID server-side', () => {
  assert.match(endpoint, /auth\.getUser\(uid\)/)
  assert.doesNotMatch(endpoint, /req\.body\.(email|organisation|role)/)
})
await test('reason, confirmation and unexpected fields fail closed', () => {
  throwsStatus(() => validatePasswordResetPayload({ reason: ' no ', confirmed: true }), 400)
  throwsStatus(() => validatePasswordResetPayload({ reason: 'valid reason', confirmed: false }), 400)
  throwsStatus(() => validatePasswordResetPayload({ reason: 'valid reason', confirmed: true, email: 'spoofed' }), 400)
  assert.equal(validatePasswordResetPayload({ reason: '  valid reason  ', confirmed: true }).reason, 'valid reason')
})
await test('password provider availability is detected safely', () => {
  assert.equal(supportsPasswordSignIn({ providerData: [{ providerId: 'password' }] }), true)
  assert.equal(supportsPasswordSignIn({ providerData: [{ providerId: 'google.com' }] }), false)
  assert.match(endpoint, /auth_unavailable/)
  assert.match(endpoint, /unsupported_provider/)
})
await test('target and actor limits are enforced', () => {
  const target = evaluatePasswordResetRateLimits({ actorData: { windowStart: Date.now(), count: 0 }, targetData: { windowStart: Date.now(), count: PASSWORD_RESET_LIMITS.TARGET_LIMIT } })
  const actor = evaluatePasswordResetRateLimits({ actorData: { windowStart: Date.now(), count: PASSWORD_RESET_LIMITS.ACTOR_LIMIT }, targetData: { windowStart: Date.now(), count: 0 } })
  assert.equal(target.allowed, false); assert.equal(actor.allowed, false)
})
await test('rate-limit reservation is atomic', () => {
  const helper = fs.readFileSync(path.join(root, 'api/super-admin/_password-reset.js'), 'utf8')
  assert.match(helper, /db\.runTransaction/)
  assert.match(helper, /transaction\.set\(actorRef/)
  assert.match(helper, /transaction\.set\(targetRef/)
})
await test('Firebase link failure never reaches Resend', async () => {
  let fetchCalls = 0
  const auditRef = { update: async () => {} }
  await assert.rejects(() => performPasswordResetDelivery({ auth: { generatePasswordResetLink: async () => { const e = new Error('secret'); e.code = 'auth/internal-error'; throw e } }, auditRef, target: context.target, continueUrl: 'https://example.test/login', fetchImpl: async () => { fetchCalls += 1 }, requestId: 'req-1', logger: () => {} }))
  assert.equal(fetchCalls, 0)
})
await test('Resend failure never records sent', async () => {
  const updates = []
  await assert.rejects(() => performPasswordResetDelivery({ auth: { generatePasswordResetLink: async () => 'https://secret.test/?oobCode=secret' }, auditRef: { update: async value => updates.push(value) }, target: context.target, continueUrl: 'https://example.test/login', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ code: 'restricted' }) }), requestId: 'req-2', logger: () => {} }))
  assert.equal(updates.some(value => value.outcome === 'sent'), false)
})
await test('success records sent and provider ID only after provider success', async () => {
  const updates = []
  await performPasswordResetDelivery({ auth: { generatePasswordResetLink: async () => 'https://secret.test/?oobCode=secret' }, auditRef: { update: async value => updates.push(value) }, target: context.target, continueUrl: 'https://example.test/login', fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'provider-safe-id' }) }), requestId: 'req-3', logger: () => {} })
  assert.deepEqual(updates[0].outcome, 'sent'); assert.equal(updates[0].providerMessageId, 'provider-safe-id')
})
await test('audit states never imply password changed', () => {
  const sent = buildPasswordResetAudit({ ...context, outcome: 'sent', timestamp: 'now', providerMessageId: 'provider-id' })
  assert.equal(sent.beforeState.passwordStatus, 'unchanged'); assert.equal(sent.afterState.passwordStatus, 'unchanged')
  assert.equal(sent.providerMessageId, 'provider-id')
  const failed = buildPasswordResetAudit({ ...context, outcome: 'delivery_failed', timestamp: 'now', providerMessageId: 'must-drop' })
  assert.equal(failed.providerMessageId, null)
})
await test('safe diagnostics exclude sensitive content', () => {
  const entries = []
  logPasswordResetDiagnostic(value => entries.push(value), { stage: 'firebase_reset_link_generation', code: 'auth/invalid-action-code', requestId: 'req-safe' })
  logPasswordResetDiagnostic(value => entries.push(value), { stage: 'resend_delivery', status: 403, code: 'restricted', requestId: 'req-safe' })
  logPasswordResetDiagnostic(value => entries.push(value), { stage: 'audit_finalize', category: 'sent_update', requestId: 'req-safe' })
  const output = entries.join(' ')
  for (const secret of ['oobCode', 'Authorization', 'RESEND_API_KEY', '<html', 'target@example.test']) assert.doesNotMatch(output, new RegExp(secret, 'i'))
})
await test('browser response cannot expose reset URL or provider internals', () => {
  assert.doesNotMatch(endpoint, /resetLink.*res\.|res\..*resetLink|oobCode|providerMessageId/)
  assert.match(endpoint, /referenceId/)
})
await test('UI has double-submit guard and accessible states', () => {
  assert.match(ui, /inFlight\.current/); assert.match(ui, /disabled=\{submitting/)
  assert.match(ui, /role=\{result\.kind === 'error' \? 'alert' : 'status'\}/)
  assert.match(ui, /reason\.trim\(\)\.length < 5/); assert.match(ui, /confirmed/)
})
await test('audit technical JSON remains hidden by default', () => {
  assert.match(auditUi, /useState<string \| null>\(null\)/)
  assert.match(auditUi, /Show technical data/)
  assert.match(auditUi, /isTechnicalExpanded &&/)
})
await test('browser performs no direct Firebase writes', () => {
  assert.doesNotMatch(ui, /firestore|setDoc|updateDoc|addDoc|generatePasswordResetLink/)
})

console.log(`Password Reset Support V1: ${passed}/${passed} checks passed`)
