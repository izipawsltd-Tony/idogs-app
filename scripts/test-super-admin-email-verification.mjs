import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  VERIFICATION_EMAIL_LIMITS,
  VerificationEmailError,
  buildVerificationAudit,
  evaluateVerificationRateLimits,
  performVerificationDelivery,
  sendViaResend,
  validateVerificationEmailPayload,
  verificationEmailHtml,
} from '../api/super-admin/_verification-email.js'

let passed = 0
let failed = 0
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL: ${name}\n${error.stack || error}`) }
}

const actor = { uid: 'admin-1', email: 'admin@example.com' }
const target = { uid: 'user-1', email: 'user@example.com', emailVerified: false, organisationId: 'user-1', organisationName: 'Example Dogs' }

await test('payload requires reason of at least five characters and explicit confirmation', () => {
  assert.throws(() => validateVerificationEmailPayload({ reason: 'help', confirmed: true }), VerificationEmailError)
  assert.throws(() => validateVerificationEmailPayload({ reason: 'please resend', confirmed: false }), VerificationEmailError)
  assert.deepEqual(validateVerificationEmailPayload({ reason: ' please resend ', confirmed: true }), { reason: 'please resend' })
})

await test('audit contains actor, target, reason, before/after and outcome without a verification URL', () => {
  const audit = buildVerificationAudit({ actor, target, reason: 'Customer requested help', outcome: 'sent', timestamp: 'now', providerMessageId: 'msg_1' })
  assert.equal(audit.targetUserId, target.uid)
  assert.equal(audit.targetUserEmail, target.email)
  assert.equal(audit.reason, 'Customer requested help')
  assert.deepEqual(audit.beforeState, { emailVerified: false })
  assert.deepEqual(audit.afterState, { emailVerified: false })
  assert.equal(audit.outcome, 'sent')
  assert.equal(JSON.stringify(audit).includes('verificationLink'), false)
  assert.equal(JSON.stringify(audit).includes('token'), false)
})

await test('per-target rate limit rejects the fourth attempt inside 24 hours', () => {
  const now = Date.now()
  const decision = evaluateVerificationRateLimits({ actorData: { windowStart: now, count: 3 }, targetData: { windowStart: now, count: VERIFICATION_EMAIL_LIMITS.TARGET_LIMIT }, nowMs: now })
  assert.equal(decision.allowed, false)
  assert.match(decision.message, /account/i)
})

await test('per-actor rate limit rejects the twenty-first attempt inside one hour', () => {
  const now = Date.now()
  const decision = evaluateVerificationRateLimits({ actorData: { windowStart: now, count: VERIFICATION_EMAIL_LIMITS.ACTOR_LIMIT }, targetData: { windowStart: now, count: 0 }, nowMs: now })
  assert.equal(decision.allowed, false)
  assert.match(decision.message, /administrator/i)
})

await test('expired rate windows reset server-side', () => {
  const now = Date.now()
  const decision = evaluateVerificationRateLimits({ actorData: { windowStart: now - VERIFICATION_EMAIL_LIMITS.ACTOR_WINDOW_MS, count: 99 }, targetData: { windowStart: now - VERIFICATION_EMAIL_LIMITS.TARGET_WINDOW_MS, count: 99 }, nowMs: now })
  assert.equal(decision.allowed, true)
})

await test('Firebase link generation failure never reports sent', async () => {
  const updates = []
  await assert.rejects(() => performVerificationDelivery({
    auth: { generateEmailVerificationLink: async () => { throw new Error('firebase detail') } },
    auditRef: { update: async value => updates.push(value) }, target, continueUrl: 'https://example.com/login',
  }), error => error instanceof VerificationEmailError && error.status === 502)
  assert.equal(updates.some(value => value.outcome === 'sent'), false)
  assert.equal(updates.at(-1).outcome, 'delivery_failed')
})

await test('Resend failure never reports sent and exposes no provider internals', async () => {
  await assert.rejects(() => sendViaResend({ email: target.email, verificationLink: 'https://secret.example/token', fetchImpl: async () => ({ ok: false, json: async () => ({ secret: 'provider detail' }) }) }), error => {
    assert.equal(error.message, 'Verification email could not be delivered')
    assert.equal(error.message.includes('provider detail'), false)
    return true
  })
})

await test('successful delivery marks audit sent only after provider confirmation', async () => {
  const events = []
  const result = await performVerificationDelivery({
    auth: { generateEmailVerificationLink: async email => { events.push(`link:${email}`); return 'https://secret.example/token' } },
    auditRef: { update: async value => events.push(value) }, target, continueUrl: 'https://example.com/login',
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'msg_safe' }) }),
  })
  assert.equal(result.providerMessageId, 'msg_safe')
  assert.deepEqual(events.at(-1), { outcome: 'sent', providerMessageId: 'msg_safe' })
})

await test('email HTML uses current iDogs logo and escapes the action URL', () => {
  const html = verificationEmailHtml({ verificationLink: 'https://example.com/?x=<token>&y="bad"' })
  assert.match(html, /01_idogs_primary_horizontal_transparent\.png/)
  assert.doesNotMatch(html, /x=<token>/)
  assert.match(html, /&lt;token&gt;/)
})

const endpoint = fs.readFileSync(new URL('../api/super-admin/users/[uid]/verification-email.js', import.meta.url), 'utf8')
const authHelper = fs.readFileSync(new URL('../api/super-admin/_auth.js', import.meta.url), 'utf8')
const ui = fs.readFileSync(new URL('../src/super-admin/SuperAdminEmailVerificationAction.tsx', import.meta.url), 'utf8')
const detailApi = fs.readFileSync(new URL('../api/super-admin/users/[uid].js', import.meta.url), 'utf8')
const auditView = fs.readFileSync(new URL('../api/super-admin/_audit-view.js', import.meta.url), 'utf8')
const auditUi = fs.readFileSync(new URL('../src/super-admin/pages/SuperAdminAuditLogsPage.tsx', import.meta.url), 'utf8')

await test('endpoint uses existing token, verified-actor and allowlist guard (401/403)', () => {
  assert.match(endpoint, /verifySuperAdmin\(req, res\)/)
  assert.match(authHelper, /status\(401\)/)
  assert.match(authHelper, /email_verified/)
  assert.match(authHelper, /ALLOWED_ADMINS\.includes/)
  assert.match(authHelper, /status\(403\)/)
  assert.doesNotMatch(authHelper, /message: error\.message|code: error\.code/)
})

await test('target is resolved from Firebase Auth by validated route UID and invalid target is safe 404', () => {
  assert.match(endpoint, /auth\.getUser\(uid\)/)
  assert.match(endpoint, /Target account not found/)
  assert.doesNotMatch(endpoint, /req\.body\.email/)
  assert.doesNotMatch(endpoint, /req\.body\.emailVerified/)
})

await test('already verified account is rejected before link generation', () => {
  const verifiedIndex = endpoint.indexOf('authUser.emailVerified')
  const deliveryIndex = endpoint.lastIndexOf('await performVerificationDelivery')
  assert.ok(verifiedIndex > -1 && deliveryIndex > verifiedIndex)
  assert.match(endpoint, /already verified/)
})

await test('raw verification link/token is never returned or deliberately logged', () => {
  assert.doesNotMatch(endpoint, /json\([^\n]*verificationLink/)
  assert.doesNotMatch(endpoint, /console\.[a-z]+\([^\n]*(verificationLink|token)/i)
  assert.match(endpoint, /outcome: 'sent'/)
})

await test('UI has a synchronous double-submit guard and waits for server success', () => {
  assert.match(ui, /inFlight\.current/)
  assert.match(ui, /if \(inFlight\.current \|\| submitting/)
  assert.ok(ui.indexOf('if (!response.ok)') < ui.indexOf("setResult({ kind: 'success'"))
  assert.match(ui, /await onUpdated\(\)/)
})

await test('browser performs only the trusted API call and no direct Firebase Auth or Firestore writes', () => {
  assert.match(ui, /\/api\/super-admin\/users\//)
  assert.doesNotMatch(ui, /firebase\/firestore|updateDoc|setDoc|generateEmailVerificationLink|sendEmailVerification/)
})

await test('account detail exposes verified, not verified and Auth unavailable states', () => {
  assert.match(detailApi, /emailVerificationStatus/)
  assert.match(detailApi, /'unavailable'/)
  assert.match(detailApi, /'not_verified'/)
  assert.match(detailApi, /'verified'/)
})

await test('audit API preserves delivery outcome and safe provider message ID for the existing audit UI', () => {
  assert.match(auditView, /outcome: text\(data\.outcome\)/)
  assert.match(auditView, /providerMessageId: text\(data\.providerMessageId\)/)
  assert.match(auditUi, /super_admin_send_verification_email: 'Send verification email'/)
  assert.match(auditUi, /Email verified:/)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
