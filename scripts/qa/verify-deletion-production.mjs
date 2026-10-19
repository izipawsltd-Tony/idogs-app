// Approved deployment smoke test. No service account, real email delivery,
// dog data, billing calls or permanent-deletion processor is used.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

const ORIGIN = 'https://idogs.com.au'
const PROJECT = 'idogs-app'
const email = `qa-idogs-deletion-${randomUUID()}@example.invalid`
const password = randomBytes(32).toString('base64url')
let identity, apiKey, attempted = false, cancelled = false
const summary = { endpoint: `${ORIGIN}/api/account-deletion`, expectedSource: 'c09f87f58808784334b8521c681dcbb95918f39e', checks: [] }
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000), redirect: 'error' })
  const data = await response.json().catch(() => null)
  return { status: response.status, data, cache: response.headers.get('cache-control') }
}
async function call(method = 'GET', body, authorized = true) {
  return json(`${ORIGIN}/api/account-deletion`, { method,
    headers: { 'Content-Type': 'application/json', ...(authorized && identity ? { Authorization: `Bearer ${identity.idToken}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
async function cancelIfNeeded() {
  if (!identity || !attempted) return
  const current = await call()
  if (current.status === 200 && current.data?.canCancel) {
    const result = await call('POST', { action: 'cancel' })
    assert.equal(result.status, 200, 'Synthetic cancellation failed')
    assert.equal(result.data?.status, 'cancelled', 'Synthetic cancellation was not confirmed')
    cancelled = true
  } else if (current.status === 200 && current.data?.status === 'cancelled') cancelled = true
}

try {
  const unauthorized = await call('GET', undefined, false)
  assert.equal(unauthorized.status, 401, 'Production endpoint did not return application-level 401')
  assert.equal(unauthorized.data?.error, 'Please sign in again.', 'Unexpected API response/protection wall')
  summary.checks.push('Unauthenticated GET rejected by application: 401')
  const noAuthPost = await call('POST', { action: 'request', confirmation: 'DELETE MY ACCOUNT' }, false)
  assert.equal(noAuthPost.status, 401, 'Unauthenticated POST was not rejected')
  summary.checks.push('Unauthenticated POST rejected: 401')

  // Public client configuration only. Never pull server environment values.
  const home = await fetch(ORIGIN, { signal: AbortSignal.timeout(30000), redirect: 'error' })
  assert.equal(home.status, 200, 'Production home unavailable')
  const html = await home.text()
  const assets = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => new URL(m[1], ORIGIN))
    .filter(url => url.origin === ORIGIN && url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')).slice(0, 3)
  assert.ok(assets.length, 'Production module asset not found')
  const keys = new Set()
  let productionConfigFound = false
  for (const asset of assets) {
    const response = await fetch(asset, { signal: AbortSignal.timeout(30000), redirect: 'error' })
    assert.equal(response.status, 200, 'Production module asset unavailable')
    const code = await response.text()
    assert.ok(code.length < 6000000, 'Unexpected module size')
    productionConfigFound ||= /projectId:["']idogs-app["']/.test(code)
    for (const match of code.matchAll(/apiKey:["'](AIza[A-Za-z0-9_-]+)["']/g)) keys.add(match[1])
  }
  assert.ok(productionConfigFound, 'Production Firebase project guard failed')
  assert.equal(keys.size, 1, 'Ambiguous public Firebase configuration')
  apiKey = [...keys][0]
  const signup = await json(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  assert.equal(signup.status, 200, 'Could not create isolated synthetic Auth fixture; no existing account login attempted')
  assert.equal(signup.data?.email, email, 'Synthetic identity email guard failed')
  assert.ok(signup.data?.localId && signup.data?.idToken, 'Synthetic identity token unavailable')
  const claims = JSON.parse(Buffer.from(signup.data.idToken.split('.')[1], 'base64url').toString('utf8'))
  assert.equal(claims.aud, PROJECT, 'Wrong Firebase token project')
  assert.equal(claims.sub, signup.data.localId, 'Wrong Firebase identity')
  assert.equal(claims.email, email, 'Wrong Firebase token email')
  identity = signup.data
  summary.checks.push('Created unique example.invalid Auth fixture; no verification email requested')

  const initial = await call()
  assert.equal(initial.status, 200, 'Authenticated status lookup failed')
  assert.equal(initial.data?.status, 'none', 'New fixture unexpectedly had an existing request')
  attempted = true
  const request = await call('POST', { action: 'request', confirmation: 'DELETE MY ACCOUNT' })
  assert.equal(request.status, 200, 'Synthetic deletion request failed')
  assert.equal(request.data?.status, 'requested', 'Request receipt missing')
  const reread = await call()
  assert.equal(reread.status, 200, 'Persisted status lookup failed')
  assert.equal(reread.data?.status, 'requested', 'Request did not persist')
  assert.equal(reread.data?.requestedAt, request.data.requestedAt, 'Persisted receipt timestamp changed')
  assert.equal(reread.cache, 'private, no-store', 'Status response is not private/no-store')
  const duplicate = await call('POST', { action: 'request', confirmation: 'DELETE MY ACCOUNT' })
  assert.equal(duplicate.status, 200, 'Idempotent retry failed')
  assert.equal(duplicate.data?.requestedAt, request.data.requestedAt, 'Duplicate request reset the receipt')
  summary.checks.push('Authenticated request persisted; duplicate submission retained the same receipt')
  await cancelIfNeeded()
  assert.ok(cancelled, 'Synthetic request was not cancelled')
  const final = await call()
  assert.equal(final.data?.status, 'cancelled', 'Cancellation did not persist')
  summary.checks.push('Cancellation persisted; permanent deletion was never invoked')
} catch (error) {
  summary.failure = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Production smoke request failed'
  process.exitCode = 1
} finally {
  try {
    await cancelIfNeeded()
    // Cleanup only the freshly created fixture's own Auth identity. Cancelled
    // request/support audit records remain; no Firestore data is deleted.
    if (identity && (!attempted || cancelled)) {
      assert.ok(email.endsWith('@example.invalid') && identity.email === email)
      const cleanup = await json(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: identity.idToken }),
      })
      assert.equal(cleanup.status, 200, 'Synthetic Auth fixture cleanup failed')
      summary.checks.push('Synthetic Auth fixture removed; cancelled request audit retained')
    } else if (identity) {
      summary.cleanup = 'Fixture retained because cancellation was not confirmed; operator review required'
      process.exitCode = 1
    }
  } catch { summary.cleanup = 'Synthetic fixture cleanup could not be confirmed'; process.exitCode = 1 }
  console.log(JSON.stringify(summary, null, 2))
}
