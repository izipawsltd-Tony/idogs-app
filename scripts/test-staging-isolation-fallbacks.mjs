// scripts/test-staging-isolation-fallbacks.mjs — bounded staging-isolation
// safety patch, rounds 18-19.
//
// Round 18 removed hardcoded PRODUCTION fallbacks:
//   process.env.FIREBASE_STORAGE_BUCKET || 'idogs-app.firebasestorage.app'
//   process.env.APP_URL || 'https://idogs.com.au'
// Round 19 (Codex High blockers) goes further: PRESENCE alone isn't
// enough — FIREBASE_STORAGE_BUCKET must be the bucket that actually
// belongs to FIREBASE_PROJECT_ID, and APP_URL must be on an explicit
// per-project hostname allowlist (never "any HTTPS host", never
// localhost/loopback/private/link-local, never credentials/path/query/
// fragment/port). This file supersedes round 18's Section 1 (which
// tested each var in isolation, effectively treating any well-formed
// staging OR production value as universally valid regardless of which
// project it was paired with) with the project/bucket/origin PAIRING
// matrix the round-19 task explicitly calls for.
//
// Two layers, matching this project's established test pattern:
//   1. Real production imports — api/_lib/require-config.js (the
//      validators) and the handler functions themselves, actually
//      invoked (not mirrored).
//   2. Source-pattern sweep across the WHOLE api/ directory so a missed
//      file or a future regression is caught, plus a check that
//      unrelated client-branding/domain text was left untouched.
//
// No emulator needed — every handler under test fails closed BEFORE
// touching Firestore/Storage/network, so this suite runs fully offline.
//
// Usage: node scripts/test-staging-isolation-fallbacks.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, skip, summary } = makeChecker()

// Disposable per-run key — never a real credential, never logged.
const DISPOSABLE_PRIVATE_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@demo-idogs-qa.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || DISPOSABLE_PRIVATE_KEY
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_disposable_placeholder'

// Sets/restores multiple env vars at once around `fn`. `undefined` in the
// map means "unset for the duration". Nested-safe (restores exactly what
// was there before, including "was absent").
//
// `fn` may be sync (returns a plain value, e.g. a boolean check) or async
// (returns a Promise, e.g. a dynamic `import()` + handler invocation) —
// a naive `try { return fn() } finally { restore() }` restores the env
// SYNCHRONOUSLY, right after fn() is merely CALLED, not after an async
// fn's returned promise actually settles. For an async fn that awaits a
// dynamic import (which reads process.env at module-evaluation time,
// itself a later microtask), that would silently revert the env vars
// before the import ever saw them — restore only fires after a returned
// thenable actually settles.
function withEnvs(map, fn) {
  const prev = {}
  for (const key of Object.keys(map)) {
    const had = key in process.env
    prev[key] = { had, value: process.env[key] }
    if (map[key] === undefined) delete process.env[key]
    else process.env[key] = map[key]
  }
  function restore() {
    for (const key of Object.keys(map)) {
      if (prev[key].had) process.env[key] = prev[key].value
      else delete process.env[key]
    }
  }
  let result
  try {
    result = fn()
  } catch (err) {
    restore()
    throw err
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      value => { restore(); return value },
      err => { restore(); throw err },
    )
  }
  restore()
  return result
}

// A network call (Google Cloud Storage, Firestore, Stripe, or a real
// fetch to a live host) would take meaningfully longer than any of these
// purely synchronous/local config checks — racing against a short
// timeout turns "no network call was attempted" into a real, timing-
// bound assertion rather than just trusting the code path.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: exceeded ${ms}ms — a network/Storage/Firestore/Stripe call was likely attempted`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function makeRes() {
  const res = {
    _status: null,
    _json: null,
    _headers: {},
    status(code) { res._status = code; return res },
    json(body) { res._json = body; return res },
    setHeader(k, v) { res._headers[k] = v; return res },
    send(body) { res._json = body; return res },
  }
  return res
}

// Captures every console.error call made during `fn` (sync or async) so
// tests can assert exactly what was logged, and that nothing sensitive
// leaked into it. Restores the real console.error afterward regardless
// of outcome.
async function captureConsoleError(fn) {
  const calls = []
  const original = console.error
  console.error = (...args) => { calls.push(args) }
  try {
    await fn()
  } finally {
    console.error = original
  }
  return calls
}

const SENSITIVE_MARKERS = [
  'idogs-app.firebasestorage.app',
  'idogs-app-staging.firebasestorage.app',
  'idogs.com.au',
  'BEGIN PRIVATE KEY',
  'sk_test_',
  'sk_live_',
  'documents/',
  '.appspot.com',
]
function containsSensitiveMarker(text) {
  const s = String(text)
  return SENSITIVE_MARKERS.some(m => s.includes(m))
}

// =========================================================================
// SECTION 1 — requireStorageBucket(): project/bucket PAIRING matrix, real
// production import. Presence alone is never enough — the bucket must
// belong to the exact project.
// =========================================================================
const { requireStorageBucket, requireAppUrl } = await import('../api/_lib/require-config.js')

{
  check('staging project + its OWN staging bucket → accepted',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app-staging.firebasestorage.app' },
      () => requireStorageBucket() === 'idogs-app-staging.firebasestorage.app'))

  check('production project + its OWN production bucket → accepted',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app', FIREBASE_STORAGE_BUCKET: 'idogs-app.firebasestorage.app' },
      () => requireStorageBucket() === 'idogs-app.firebasestorage.app'))

  check('staging project + PRODUCTION bucket → rejected (the exact cross-pairing the round-19 blocker exists to close)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app.firebasestorage.app' },
      () => requireStorageBucket() === null))

  check('production project + STAGING bucket → rejected (cross-pairing the other direction)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app', FIREBASE_STORAGE_BUCKET: 'idogs-app-staging.firebasestorage.app' },
      () => requireStorageBucket() === null))

  check('a well-formed bucket for a THIRD, unrelated project → rejected (not just the two known projects)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'someone-elses-project.firebasestorage.app' },
      () => requireStorageBucket() === null))

  check('FIREBASE_STORAGE_BUCKET present and well-formed, FIREBASE_PROJECT_ID missing → rejected (never derive/accept without the project id)',
    withEnvs({ FIREBASE_PROJECT_ID: undefined, FIREBASE_STORAGE_BUCKET: 'idogs-app-staging.firebasestorage.app' },
      () => requireStorageBucket() === null))

  check('FIREBASE_PROJECT_ID present and valid, FIREBASE_STORAGE_BUCKET missing → rejected (never silently derive a bucket from the project id alone)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: undefined },
      () => requireStorageBucket() === null))

  check('both missing → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: undefined, FIREBASE_STORAGE_BUCKET: undefined },
      () => requireStorageBucket() === null))

  check('blank FIREBASE_PROJECT_ID → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: '   ', FIREBASE_STORAGE_BUCKET: 'idogs-app-staging.firebasestorage.app' },
      () => requireStorageBucket() === null))

  check('malformed FIREBASE_PROJECT_ID (uppercase, invalid chars) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'Idogs_App!', FIREBASE_STORAGE_BUCKET: 'Idogs_App!.firebasestorage.app' },
      () => requireStorageBucket() === null))

  check('bucket with leading/trailing whitespace on an otherwise-correct pairing → rejected (padding is malformed, not silently trimmed)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: '  idogs-app-staging.firebasestorage.app  ' },
      () => requireStorageBucket() === null))

  check('bucket with a path/slash injected → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app-staging.firebasestorage.app/evil' },
      () => requireStorageBucket() === null))

  check('bucket with consecutive dots → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app-staging..firebasestorage.app' },
      () => requireStorageBucket() === null))

  check('excessively long bucket value (>222 chars) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'a'.repeat(230) + '.firebasestorage.app' },
      () => requireStorageBucket() === null))

  check('credential-like bucket value (looks like a private key marker, not a bucket) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: '-----BEGIN PRIVATE KEY-----' },
      () => requireStorageBucket() === null))

  check('loopback-shaped bucket value (an IP address, not a bucket name) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: '127.0.0.1' },
      () => requireStorageBucket() === null))

  check('legacy .appspot.com shape is NOT accepted (no tracked configuration evidences it being required — see round-19 report)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app-staging.appspot.com' },
      () => requireStorageBucket() === null))
}

// =========================================================================
// SECTION 2 — requireAppUrl(): project/origin PAIRING matrix + every
// rejection category the round-19 task lists by name.
// =========================================================================
{
  check('staging project + its OWN dedicated Vercel staging hostname → accepted',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs-app-staging.vercel.app' },
      () => requireAppUrl() === 'https://idogs-app-staging.vercel.app'))

  check('production project + idogs.com.au → accepted',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app', APP_URL: 'https://idogs.com.au' },
      () => requireAppUrl() === 'https://idogs.com.au'))

  check('production project + the documented Vercel alias (idogs-app.vercel.app) → accepted',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app', APP_URL: 'https://idogs-app.vercel.app' },
      () => requireAppUrl() === 'https://idogs-app.vercel.app'))

  check('staging project + PRODUCTION domain (idogs.com.au) → rejected — the exact cross-pairing the round-19 blocker exists to close',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs.com.au' },
      () => requireAppUrl() === null))

  check('production project + the STAGING hostname → rejected (cross-pairing the other direction)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app', APP_URL: 'https://idogs-app-staging.vercel.app' },
      () => requireAppUrl() === null))

  check('a Vercel Preview per-deployment hostname for the staging project → rejected (deferred — see round-19 report Limitations; a real hostname was NOT guessed here)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app' },
      () => requireAppUrl() === null))

  check('an arbitrary, unrelated HTTPS host → rejected — HTTPS alone is never sufficient',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://evil-attacker-site.example.com' },
      () => requireAppUrl() === null))

  check('unknown/missing FIREBASE_PROJECT_ID → rejected regardless of how well-formed APP_URL is (no allowlist to satisfy)',
    withEnvs({ FIREBASE_PROJECT_ID: 'some-other-project', APP_URL: 'https://idogs-app-staging.vercel.app' },
      () => requireAppUrl() === null))

  check('APP_URL missing entirely → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: undefined },
      () => requireAppUrl() === null))

  check('blank APP_URL → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: '   ' },
      () => requireAppUrl() === null))

  check('plain HTTP (not HTTPS), even for an otherwise-correct staging host → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'http://idogs-app-staging.vercel.app' },
      () => requireAppUrl() === null))

  check('embedded username/password (credentials in the URL) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://user:pass@idogs-app-staging.vercel.app' },
      () => requireAppUrl() === null))

  check('a non-root path appended → rejected (APP_URL must be a bare origin)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs-app-staging.vercel.app/app' },
      () => requireAppUrl() === null))

  check('a query string appended → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs-app-staging.vercel.app?x=1' },
      () => requireAppUrl() === null))

  check('a fragment appended → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs-app-staging.vercel.app#frag' },
      () => requireAppUrl() === null))

  check('an explicit non-default port → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs-app-staging.vercel.app:8443' },
      () => requireAppUrl() === null))

  check('a trailing slash on an otherwise-correct origin → accepted, normalized WITHOUT the trailing slash',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs-app-staging.vercel.app/' },
      () => requireAppUrl() === 'https://idogs-app-staging.vercel.app'))

  check('bare "localhost" → rejected outright (round 19 removes the round-18 http://localhost exception entirely)',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://localhost' },
      () => requireAppUrl() === null))

  check('IPv4 loopback (127.0.0.1) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://127.0.0.1' },
      () => requireAppUrl() === null))

  check('IPv6 loopback ([::1]) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://[::1]' },
      () => requireAppUrl() === null))

  check('IPv4 private range (10.x) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://10.0.0.5' },
      () => requireAppUrl() === null))

  check('IPv4 private range (192.168.x) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://192.168.1.1' },
      () => requireAppUrl() === null))

  check('IPv4 private range (172.16-31.x) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://172.20.0.1' },
      () => requireAppUrl() === null))

  check('IPv4 link-local (169.254.x) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://169.254.1.1' },
      () => requireAppUrl() === null))

  check('IPv6 link-local (fe80::) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://[fe80::1]' },
      () => requireAppUrl() === null))

  check('IPv6 unique-local (fd00::/8) → rejected',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://[fd12:3456:789a::1]' },
      () => requireAppUrl() === null))

  check('a public IPv4 address (not the hostname allowlist) → rejected — not a loopback/private case, just not on the allowlist',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://8.8.8.8' },
      () => requireAppUrl() === null))

  check('uppercase-cased version of the correct staging host → accepted, normalized to lowercase',
    withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://IDOGS-APP-STAGING.VERCEL.APP' },
      () => requireAppUrl() === 'https://idogs-app-staging.vercel.app'))
}

// =========================================================================
// SECTION 3 — behavioral proof: the real handlers fail closed BEFORE
// touching Firebase/Storage/Stripe/network, for BOTH the "missing" and
// the "mismatched project/bucket/origin" cases, using real production
// imports.
// =========================================================================
async function checkHandlerFailsClosed(label, envOverrides, handlerPath, req, expectedError) {
  await checkAsync(label, () => withEnvs(envOverrides, async () => {
    const { default: handler } = await import(handlerPath)
    const res = makeRes()
    await withTimeout(handler(req, res), 2000, handlerPath)
    return res._status === 500 && res._json?.error === expectedError
  }))
}

await checkHandlerFailsClosed(
  'api/upload.js: FIREBASE_STORAGE_BUCKET missing (staging project) → fails closed, never reaches getStorage()/network',
  { FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: undefined },
  '../api/upload.js', { method: 'POST', query: {}, headers: {}, body: {} }, 'FIREBASE_STORAGE_BUCKET not configured')

await checkHandlerFailsClosed(
  'api/upload.js: staging project PAIRED WITH the production bucket → fails closed, never reaches getStorage()/network',
  { FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app.firebasestorage.app' },
  '../api/upload.js', { method: 'POST', query: {}, headers: {}, body: {} }, 'FIREBASE_STORAGE_BUCKET not configured')

await checkHandlerFailsClosed(
  'api/upload-document.js: staging project PAIRED WITH the production bucket → fails closed, never reaches getStorage()/network',
  { FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app.firebasestorage.app' },
  '../api/upload-document.js', { method: 'POST', headers: {}, body: {} }, 'FIREBASE_STORAGE_BUCKET not configured')

await checkHandlerFailsClosed(
  'api/get-signed-url.js: staging project PAIRED WITH the production bucket → fails closed (even before token verification), never reaches getStorage()/network',
  { FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app.firebasestorage.app' },
  '../api/get-signed-url.js', { method: 'POST', headers: {}, body: {} }, 'FIREBASE_STORAGE_BUCKET not configured')

await checkHandlerFailsClosed(
  'api/create-checkout.js: staging project PAIRED WITH the production domain (idogs.com.au) → fails closed, never creates a Stripe session',
  { FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs.com.au' },
  '../api/create-checkout.js', { method: 'POST', body: { plan: 'basic', userId: 'u1', userEmail: 'a@b.com' } }, 'APP_URL not configured')

await checkHandlerFailsClosed(
  'api/create-checkout.js: an arbitrary unrelated HTTPS host → fails closed, never creates a Stripe session',
  { FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://evil-attacker-site.example.com' },
  '../api/create-checkout.js', { method: 'POST', body: { plan: 'basic', userId: 'u1', userEmail: 'a@b.com' } }, 'APP_URL not configured')

// @aws-sdk/client-sns (a top-level import in send-reminders.js, wholly
// unrelated to this patch) is not installed in this sandbox's
// node_modules — a pre-existing environment gap, not something this
// bounded fix touches or should paper over. Skip the dynamic invocation
// gracefully rather than reporting a false failure; the static
// source-pattern checks below already cover this file's actual fix.
{
  let sendRemindersImportable = true
  try {
    await import('../api/send-reminders.js')
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package/.test(String(err?.message))) {
      sendRemindersImportable = false
    } else {
      throw err
    }
  }

  if (sendRemindersImportable) {
    await checkHandlerFailsClosed(
      'api/send-reminders.js: staging project PAIRED WITH the production domain → fails closed before any Firestore read',
      { FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs.com.au', CRON_SECRET: 'test-cron-secret-disposable' },
      '../api/send-reminders.js', { method: 'POST', headers: { 'x-cron-secret': 'test-cron-secret-disposable' } }, 'APP_URL not configured')
  } else {
    skip('api/send-reminders.js: staging/production cross-pairing → fails closed (dynamic invocation)',
      '@aws-sdk/client-sns is not installed in this environment — pre-existing, unrelated to this patch; covered instead by the static source-pattern checks below')
  }
}

// =========================================================================
// SECTION 4 — raw secret/path/URL markers never reach client responses
// OR server logs, for the same mismatch case.
// =========================================================================
await checkAsync('api/upload.js: config-mismatch response body contains no bucket name, project id, or other sensitive marker',
  () => withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app.firebasestorage.app' }, async () => {
    const { default: handler } = await import('../api/upload.js')
    const res = makeRes()
    await withTimeout(handler({ method: 'POST', query: {}, headers: {}, body: {} }, res), 2000, 'upload.js')
    return !containsSensitiveMarker(JSON.stringify(res._json))
  }))

await checkAsync('api/upload.js: config-mismatch server log contains no bucket name, project id, or other sensitive marker — only the fixed operation label + code',
  () => withEnvs({ FIREBASE_PROJECT_ID: 'idogs-app-staging', FIREBASE_STORAGE_BUCKET: 'idogs-app.firebasestorage.app' }, async () => {
    const { default: handler } = await import('../api/upload.js')
    const res = makeRes()
    const logs = await captureConsoleError(() => withTimeout(handler({ method: 'POST', query: {}, headers: {}, body: {} }, res), 2000, 'upload.js'))
    const logText = JSON.stringify(logs)
    return logs.length > 0 && !containsSensitiveMarker(logText) && logText.includes('STORAGE_BUCKET_NOT_CONFIGURED')
  }))

// =========================================================================
// SECTION 5 — full source sweep of the WHOLE api/ directory (not just the
// touched files) — no literal hardcoded production fallback survives
// anywhere, and no tracked file re-derives one from FIREBASE_PROJECT_ID.
// =========================================================================
{
  const apiDir = new URL('../api/', import.meta.url)
  const apiFiles = readdirSync(apiDir, { recursive: true })
    .filter(f => f.endsWith('.js'))
    .map(f => new URL(f, apiDir))

  check('at least the known files (plus others) were actually scanned — sanity check on the directory walk',
    apiFiles.length >= 6)

  let bucketFallbackHits = []
  let urlFallbackHits = []
  let projectIdDerivedBucketHits = []
  for (const fileUrl of apiFiles) {
    // api/_lib/require-config.js is this patch's own fix — its header
    // comment legitimately quotes the exact old fallback expressions
    // verbatim, in prose, to document what was removed and why. That
    // documentation is not itself a live fallback; skip it here.
    if (fileUrl.pathname.endsWith('/_lib/require-config.js')) continue
    const src = readFileSync(fileUrl, 'utf8')
    if (/\|\|\s*['"]idogs-app\.firebasestorage\.app['"]/.test(src)) bucketFallbackHits.push(fileUrl.pathname)
    if (/\|\|\s*['"]https:\/\/idogs\.com\.au['"]/.test(src)) urlFallbackHits.push(fileUrl.pathname)
    if (/defaultBucket\s*=/.test(src) || /\$\{process\.env\.FIREBASE_PROJECT_ID\}\.firebasestorage\.app/.test(src)) projectIdDerivedBucketHits.push(fileUrl.pathname)
  }

  check('no tracked api/*.js file contains `|| \'idogs-app.firebasestorage.app\'` anywhere', bucketFallbackHits.length === 0, JSON.stringify(bucketFallbackHits))
  check('no tracked api/*.js file contains `|| \'https://idogs.com.au\'` anywhere', urlFallbackHits.length === 0, JSON.stringify(urlFallbackHits))
  check('no tracked api/*.js file re-derives a default bucket from FIREBASE_PROJECT_ID (the old defaultBucket pattern is fully removed)', projectIdDerivedBucketHits.length === 0, JSON.stringify(projectIdDerivedBucketHits))

  let rawErrLeakHits = []
  for (const file of ['create-checkout.js', 'get-signed-url.js', 'upload-document.js', 'upload.js']) {
    const src = readFileSync(new URL(`../api/${file}`, import.meta.url), 'utf8')
    if (/message:\s*err\.message/.test(src) || /message:\s*String\(err\)/.test(src) || /err\.stack/.test(src) || /message:\s*err\.code/.test(src)) {
      rawErrLeakHits.push(file)
    }
  }
  check('none of the reviewed checkout/Storage endpoints return err.message/String(err)/err.stack/err.code to the client anymore', rawErrLeakHits.length === 0, JSON.stringify(rawErrLeakHits))
}

// =========================================================================
// SECTION 6 — the fix is surgical: unrelated client-branding/domain
// references, authorization logic, and Stripe product/price ids are
// untouched.
// =========================================================================
{
  const sendEmailSrc = readFileSync(new URL('../api/send-email.js', import.meta.url), 'utf8')
  check('api/send-email.js still sends from the verified noreply@idogs.com.au address (unrelated to server routing — must NOT be touched by this patch)',
    /from: 'iDogs <noreply@idogs\.com\.au>'/.test(sendEmailSrc))

  const surveySrc = readFileSync(new URL('../api/survey.js', import.meta.url), 'utf8')
  check('api/survey.js still sends from the verified noreply@idogs.com.au address',
    /noreply@idogs\.com\.au/.test(surveySrc))

  const exportSrc = readFileSync(new URL('../api/export-report.js', import.meta.url), 'utf8')
  check('api/export-report.js still has its "idogs.com.au" footer/tagline branding text (static report content, unrelated to server routing)',
    /Every dog's story, forever · idogs\.com\.au/.test(exportSrc) && /Generated by iDogs · idogs\.com\.au/.test(exportSrc))

  const checkoutSrc = readFileSync(new URL('../api/create-checkout.js', import.meta.url), 'utf8')
  check('api/create-checkout.js Stripe price IDs are untouched',
    /price_1TiaZn5lmfxrCiH3GCzSSuAy/.test(checkoutSrc) && /price_1Tiabb5lmfxrCiH3kBdaQsRH/.test(checkoutSrc) &&
    /price_1TiU7j5lmfxrCiH3J1WbbrLR/.test(checkoutSrc) && /price_1Tialb5lmfxrCiH3pe82Abps/.test(checkoutSrc))

  const uploadDocSrc = readFileSync(new URL('../api/upload-document.js', import.meta.url), 'utf8')
  check('api/upload-document.js still verifies caller ownership (tenantId/currentOwnerId) before writing — authorization logic untouched',
    /dog\.tenantId === uid \|\| dog\.currentOwnerId === uid/.test(uploadDocSrc))

  const uploadSrc = readFileSync(new URL('../api/upload.js', import.meta.url), 'utf8')
  check('api/upload.js still verifies caller ownership before writing — authorization logic untouched',
    /dog\.tenantId === uid \|\| dog\.currentOwnerId === uid/.test(uploadSrc))

  const sendRemindersSrc = readFileSync(new URL('../api/send-reminders.js', import.meta.url), 'utf8')
  check('api/send-reminders.js email BODY links to idogs.com.au are untouched (production is the only place these cron emails realistically send from)',
    /https:\/\/idogs\.com\.au\/app\/dogs\/\$\{dog\.id\}/.test(sendRemindersSrc))
}

// =========================================================================
// SECTION 7 — sanitized config-error responses/logs: fixed operation +
// fixed allowlisted code only, wired at every call site.
// =========================================================================
{
  const requireConfigSrc = readFileSync(new URL('../api/_lib/require-config.js', import.meta.url), 'utf8')
  check('logConfigError() logs a fixed operation string + fixed code — never the raw env value',
    /console\.error\(`\$\{operation\}: configuration error`, \{ code \}\)/.test(requireConfigSrc))

  const httpHelpersSrc = readFileSync(new URL('../api/_lib/http-helpers.js', import.meta.url), 'utf8')
  check('logSanitizedError() logs a fixed operation string + fixed code — never the raw error object',
    /console\.error\(`\$\{operation\}: operation failed`, \{ code \}\)/.test(httpHelpersSrc))

  for (const [file, op, code] of [
    ['get-signed-url.js', 'get-signed-url', 'STORAGE_BUCKET_NOT_CONFIGURED'],
    ['upload-document.js', 'upload-document', 'STORAGE_BUCKET_NOT_CONFIGURED'],
    ['upload.js', 'upload', 'STORAGE_BUCKET_NOT_CONFIGURED'],
    ['create-checkout.js', 'create-checkout', 'APP_URL_NOT_CONFIGURED'],
    ['send-reminders.js', 'send-reminders', 'APP_URL_NOT_CONFIGURED'],
  ]) {
    const src = readFileSync(new URL(`../api/${file}`, import.meta.url), 'utf8')
    check(`${file} calls logConfigError('${op}', '${code}') with fixed, allowlisted arguments`,
      new RegExp(`logConfigError\\('${op}', '${code}'\\)`).test(src))
  }

  for (const [file, op, code] of [
    ['create-checkout.js', 'create-checkout', 'CHECKOUT_SESSION_FAILED'],
    ['get-signed-url.js', 'get-signed-url', 'SIGNED_URL_FAILED'],
    ['upload-document.js', 'upload-document', 'UPLOAD_FAILED'],
  ]) {
    const src = readFileSync(new URL(`../api/${file}`, import.meta.url), 'utf8')
    check(`${file} calls logSanitizedError('${op}', '${code}') in its general catch-all with fixed, allowlisted arguments`,
      new RegExp(`logSanitizedError\\('${op}', '${code}'\\)`).test(src))
  }
  const uploadSrc2 = readFileSync(new URL('../api/upload.js', import.meta.url), 'utf8')
  check("upload.js calls logSanitizedError with a server-controlled (not raw request) operation label + fixed code",
    /logSanitizedError\(`upload \(\$\{uploadType\}\)`, 'UPLOAD_FAILED'\)/.test(uploadSrc2))
}

await summary()
