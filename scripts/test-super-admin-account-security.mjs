import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildAccountSecurityOverview, normalizeSignInProviders, summarizeInternalEntitlement } from '../api/super-admin/_account-security.js'

const root = process.cwd()
const endpoint = fs.readFileSync(path.join(root, 'api/super-admin/users/[uid].js'), 'utf8')
const overviewUi = fs.readFileSync(path.join(root, 'src/super-admin/SuperAdminAccountSecurityOverview.tsx'), 'utf8')
const page = fs.readFileSync(path.join(root, 'src/super-admin/pages/SuperAdminUserDetailPage.tsx'), 'utf8')
const verificationUi = fs.readFileSync(path.join(root, 'src/super-admin/SuperAdminEmailVerificationAction.tsx'), 'utf8')
const resetUi = fs.readFileSync(path.join(root, 'src/super-admin/SuperAdminPasswordResetAction.tsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src/super-admin/superAdmin.css'), 'utf8')
let passed = 0
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`) }
const authUser = overrides => ({
  uid: 'target-uid', email: 'target@example.test', emailVerified: true, disabled: false,
  providerData: [{ providerId: 'password', uid: 'provider-secret-uid', email: 'provider@example.test' }],
  metadata: { creationTime: '2026-01-01T00:00:00Z', lastSignInTime: '2026-02-01T00:00:00Z', lastRefreshTime: '2026-02-02T00:00:00Z' },
  customClaims: { admin: true }, passwordHash: 'secret-hash', passwordSalt: 'secret-salt', ...overrides,
})
const build = user => buildAccountSecurityOverview({ authUser: user, entitlement: null, entitlementActive: false })

test('existing verified Super Admin authorization guard protects user detail', () => {
  assert.match(endpoint, /await verifySuperAdmin\(req, res\)/)
  assert.match(endpoint, /if \(!adminUser\) return/)
})
test('target is resolved from route UID with Firebase Admin server-side', () => {
  assert.match(endpoint, /auth\.getUser\(uid\)/)
  assert.doesNotMatch(endpoint, /req\.body\.(uid|email|role)/)
})
test('Auth unavailable has highest deterministic status', () => {
  const value = build(null)
  assert.equal(value.status, 'auth_unavailable'); assert.equal(value.authRecord, 'unavailable'); assert.deepEqual(value.signInProviders, [])
})
test('verified password account is Normal', () => {
  const value = build(authUser())
  assert.equal(value.status, 'normal'); assert.equal(value.emailVerification, 'verified'); assert.equal(value.passwordSignIn, 'available')
})
test('unverified account requires attention', () => {
  const value = build(authUser({ emailVerified: false }))
  assert.equal(value.status, 'attention_required'); assert.match(value.reasons.join(' '), /not verified/i)
})
test('federated providers are normalized without provider identity', () => {
  const providers = normalizeSignInProviders([{ providerId: 'google.com', uid: 'secret' }, { providerId: 'apple.com', uid: 'secret-2' }])
  assert.deepEqual(providers, ['Google', 'Apple']); assert.doesNotMatch(JSON.stringify(providers), /secret/)
  const value = build(authUser({ providerData: [{ providerId: 'google.com' }] }))
  assert.equal(value.status, 'normal'); assert.equal(value.passwordSignIn, 'unsupported')
})
test('no supported provider requires attention', () => {
  const value = build(authUser({ providerData: [] }))
  assert.equal(value.status, 'attention_required'); assert.match(value.reasons.join(' '), /no supported sign-in provider/i)
})
test('disabled account precedence is Access restricted', () => {
  const value = build(authUser({ disabled: true, emailVerified: false, providerData: [] }))
  assert.equal(value.status, 'access_restricted'); assert.equal(value.platformAccess, 'suspended'); assert.equal(value.firebaseDisabled, true)
  assert.deepEqual(value.reasons, ['Firebase Auth access is disabled.'])
})
test('legacy and missing metadata use explicit unavailable fallbacks', () => {
  const value = build(authUser({ metadata: {}, providerData: undefined }))
  assert.equal(value.accountCreatedAt, null); assert.equal(value.lastSignInAt, null); assert.equal(value.lastRefreshAt, null)
  assert.equal(value.status, 'attention_required')
})
test('internal entitlement summary is read-only and deterministic', () => {
  assert.deepEqual(summarizeInternalEntitlement(null, false), { status: 'not_configured', expiresAt: null })
  assert.equal(summarizeInternalEntitlement({ granted: false, expiresAt: null }, false).status, 'revoked')
  assert.equal(summarizeInternalEntitlement({ granted: true, expiresAt: null }, true).status, 'active')
  assert.equal(summarizeInternalEntitlement({ granted: true, expiresAt: '2026-01-01T00:00:00Z' }, false).status, 'expired')
})
test('normalized response excludes sensitive Firebase fields', () => {
  const output = JSON.stringify(build(authUser()))
  for (const secret of ['provider-secret-uid', 'provider@example.test', 'secret-hash', 'secret-salt', 'customClaims']) assert.doesNotMatch(output, new RegExp(secret, 'i'))
  assert.doesNotMatch(endpoint, /passwordHash|passwordSalt|customClaims|tokens?/i)
})
test('Auth lookup only treats user-not-found as unavailable', () => {
  assert.match(endpoint, /authErr\?\.code !== 'auth\/user-not-found'\) throw authErr/)
  assert.doesNotMatch(endpoint, /console\.(log|warn).*authData|JSON\.stringify\(authData/)
})
test('overview reuses existing support action eligibility and anchors', () => {
  assert.match(overviewUi, /emailVerificationStatus === 'not_verified'/)
  assert.match(overviewUi, /passwordResetStatus === 'available'/)
  assert.match(verificationUi, /id="email-verification-support"/)
  assert.match(resetUi, /id="password-reset-support"/)
  assert.match(page, /<SuperAdminEmailVerificationAction/); assert.match(page, /<SuperAdminPasswordResetAction/)
})
test('Security Overview is read-only with accessible labels', () => {
  assert.match(overviewUi, /Read-only Firebase Auth/); assert.match(overviewUi, /This is not a risk score/)
  assert.match(overviewUi, /aria-labelledby="account-security-heading"/); assert.match(overviewUi, /role="status"/)
  assert.doesNotMatch(overviewUi, /fetch\(|setDoc|updateDoc|addDoc|from ['"]firebase|from ['"]firebase\//)
})
test('responsive layout collapses to one column without overflow', () => {
  assert.match(css, /\.super-admin-security-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/)
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.super-admin-security-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /overflow-wrap:\s*anywhere/)
})

console.log(`Account Security Overview V1: ${passed}/${passed} checks passed`)
