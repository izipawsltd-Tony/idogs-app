// scripts/test-staging-isolation-fallbacks.mjs — bounded staging-isolation
// safety patch: regression coverage for the removal of every hardcoded
// PRODUCTION fallback the environment inventory found —
// `process.env.FIREBASE_STORAGE_BUCKET || 'idogs-app.firebasestorage.app'`
// and `process.env.APP_URL || 'https://idogs.com.au'` — across
// api/export-report.js, api/get-signed-url.js, api/upload-document.js,
// api/upload.js, api/create-checkout.js and api/send-reminders.js.
//
// Two layers, matching this project's established test pattern:
//   1. Real production imports — api/_lib/require-config.js (the new
//      shared validators) and the handler functions themselves (plain
//      ESM .js, importable directly into Node, same as
//      test-atomic-transactions.mjs already does for other api/_lib/*.js
//      modules) — actually invoked, not mirrored.
//   2. Source-pattern sweep across the WHOLE api/ directory (not just the
//      6 touched files) so a missed file or a future regression is
//      caught, and a check that unrelated client-branding/domain text
//      (email "from" address, footer copy) was left untouched.
//
// No emulator needed — every handler under test fails closed BEFORE
// touching Firestore/Storage/network, so this suite runs fully offline.
// Admin SDK's cert() only needs a structurally-valid PEM (never
// contacted), same reasoning scripts/test-helpers/emulator-credentials.mjs
// already documents for its own disposable key.
//
// Usage: node scripts/test-staging-isolation-fallbacks.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, skip, summary } = makeChecker()

// Disposable per-run key — never a real credential, never logged.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-idogs-qa'
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@demo-idogs-qa.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_disposable_placeholder'

function withEnv(name, value, fn) {
  const had = name in process.env
  const prev = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  try {
    return fn()
  } finally {
    if (had) process.env[name] = prev
    else delete process.env[name]
  }
}

// A network call (Google Cloud Storage, Firestore, or a real fetch to
// idogs.com.au) would take meaningfully longer than any of these purely
// synchronous/local config checks — racing against a short timeout turns
// "no network call was attempted" into a real, timing-bound assertion
// rather than just trusting the code path.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: exceeded ${ms}ms — a network/Storage/Firestore call was likely attempted`)), ms)
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

// =========================================================================
// SECTION 1 — requireStorageBucket() / requireAppUrl(): real production
// import, every missing/blank/malformed/valid case.
// =========================================================================
const { requireStorageBucket, requireAppUrl } = await import('../api/_lib/require-config.js')

{
  check('requireStorageBucket(): undefined → null (never a hardcoded fallback)',
    withEnv('FIREBASE_STORAGE_BUCKET', undefined, () => requireStorageBucket() === null))
  check('requireStorageBucket(): empty string → null',
    withEnv('FIREBASE_STORAGE_BUCKET', '', () => requireStorageBucket() === null))
  check('requireStorageBucket(): whitespace-only → null',
    withEnv('FIREBASE_STORAGE_BUCKET', '   ', () => requireStorageBucket() === null))
  check('requireStorageBucket(): leading/trailing whitespace on an otherwise-valid value → null (rejected, not silently trimmed)',
    withEnv('FIREBASE_STORAGE_BUCKET', '  idogs-app-staging.firebasestorage.app  ', () => requireStorageBucket() === null))
  check('requireStorageBucket(): a path/slash injected into the value → null',
    withEnv('FIREBASE_STORAGE_BUCKET', 'idogs-app-staging.firebasestorage.app/evil', () => requireStorageBucket() === null))
  check('requireStorageBucket(): valid STAGING bucket (.firebasestorage.app) → accepted, returned verbatim',
    withEnv('FIREBASE_STORAGE_BUCKET', 'idogs-app-staging.firebasestorage.app', () => requireStorageBucket() === 'idogs-app-staging.firebasestorage.app'))
  check('requireStorageBucket(): valid legacy-shape bucket (.appspot.com) → accepted',
    withEnv('FIREBASE_STORAGE_BUCKET', 'idogs-app-staging.appspot.com', () => requireStorageBucket() === 'idogs-app-staging.appspot.com'))
  check('requireStorageBucket(): the OLD hardcoded PRODUCTION bucket name is only ever returned if it is ITSELF explicitly configured as the value — never as an implicit default',
    withEnv('FIREBASE_STORAGE_BUCKET', undefined, () => requireStorageBucket() !== 'idogs-app.firebasestorage.app'))
}

{
  check('requireAppUrl(): undefined → null (never a hardcoded fallback)',
    withEnv('APP_URL', undefined, () => requireAppUrl() === null))
  check('requireAppUrl(): empty string → null',
    withEnv('APP_URL', '', () => requireAppUrl() === null))
  check('requireAppUrl(): whitespace-only → null',
    withEnv('APP_URL', '   ', () => requireAppUrl() === null))
  check('requireAppUrl(): leading/trailing whitespace on an otherwise-valid value → null',
    withEnv('APP_URL', ' https://idogs-app-staging.vercel.app ', () => requireAppUrl() === null))
  check('requireAppUrl(): plain http (not https) → null — even for the production-looking domain',
    withEnv('APP_URL', 'http://idogs.com.au', () => requireAppUrl() === null))
  check('requireAppUrl(): a non-http(s) scheme → null',
    withEnv('APP_URL', 'ftp://idogs-app-staging.vercel.app', () => requireAppUrl() === null))
  check('requireAppUrl(): a URL with a path component → null (must be a bare origin)',
    withEnv('APP_URL', 'https://idogs-app-staging.vercel.app/app', () => requireAppUrl() === null))
  check('requireAppUrl(): a URL with a query string → null',
    withEnv('APP_URL', 'https://idogs-app-staging.vercel.app?x=1', () => requireAppUrl() === null))
  check('requireAppUrl(): a valid staging Preview https origin → accepted, returned verbatim',
    withEnv('APP_URL', 'https://idogs-app-staging.vercel.app', () => requireAppUrl() === 'https://idogs-app-staging.vercel.app'))
  check('requireAppUrl(): a valid https origin with a trailing slash → accepted, normalized WITHOUT the trailing slash',
    withEnv('APP_URL', 'https://idogs-app-staging.vercel.app/', () => requireAppUrl() === 'https://idogs-app-staging.vercel.app'))
  check('requireAppUrl(): documented http://localhost exception is accepted',
    withEnv('APP_URL', 'http://localhost:5173', () => requireAppUrl() === 'http://localhost:5173'))
  check('requireAppUrl(): the OLD hardcoded PRODUCTION domain is only ever returned if it is ITSELF explicitly configured as the value — never as an implicit default',
    withEnv('APP_URL', undefined, () => requireAppUrl() !== 'https://idogs.com.au'))
}

// =========================================================================
// SECTION 2 — behavioral proof: the real handlers fail closed BEFORE
// touching Firebase/Storage or the network, using real production imports.
// =========================================================================
await checkAsync('api/upload.js: FIREBASE_STORAGE_BUCKET missing → fails closed immediately, never reaches getStorage()/network',
  () => withEnv('FIREBASE_STORAGE_BUCKET', undefined, async () => {
    const { default: handler } = await import('../api/upload.js')
    const res = makeRes()
    await withTimeout(handler({ method: 'POST', query: {}, headers: {}, body: {} }, res), 2000, 'upload.js')
    return res._status === 500 && res._json?.error === 'FIREBASE_STORAGE_BUCKET not configured'
  }))

await checkAsync('api/upload-document.js: FIREBASE_STORAGE_BUCKET missing → fails closed immediately, never reaches getStorage()/network',
  () => withEnv('FIREBASE_STORAGE_BUCKET', undefined, async () => {
    const { default: handler } = await import('../api/upload-document.js')
    const res = makeRes()
    await withTimeout(handler({ method: 'POST', headers: {}, body: {} }, res), 2000, 'upload-document.js')
    return res._status === 500 && res._json?.error === 'FIREBASE_STORAGE_BUCKET not configured'
  }))

await checkAsync('api/get-signed-url.js: FIREBASE_STORAGE_BUCKET missing → fails closed immediately (even before token verification), never reaches getStorage()/network',
  () => withEnv('FIREBASE_STORAGE_BUCKET', undefined, async () => {
    const { default: handler } = await import('../api/get-signed-url.js')
    const res = makeRes()
    await withTimeout(handler({ method: 'POST', headers: {}, body: {} }, res), 2000, 'get-signed-url.js')
    return res._status === 500 && res._json?.error === 'FIREBASE_STORAGE_BUCKET not configured'
  }))

await checkAsync('api/upload.js: a malformed FIREBASE_STORAGE_BUCKET (blank) also fails closed the same way',
  () => withEnv('FIREBASE_STORAGE_BUCKET', '   ', async () => {
    const { default: handler } = await import('../api/upload.js')
    const res = makeRes()
    await withTimeout(handler({ method: 'POST', query: {}, headers: {}, body: {} }, res), 2000, 'upload.js (blank bucket)')
    return res._status === 500 && res._json?.error === 'FIREBASE_STORAGE_BUCKET not configured'
  }))

await checkAsync('api/create-checkout.js: APP_URL missing → fails closed before creating any Stripe session (never builds a redirect URL at all)',
  () => withEnv('APP_URL', undefined, async () => {
    const { default: handler } = await import('../api/create-checkout.js')
    const res = makeRes()
    await withTimeout(
      handler({ method: 'POST', body: { plan: 'basic', userId: 'u1', userEmail: 'a@b.com' } }, res),
      2000, 'create-checkout.js')
    return res._status === 500 && res._json?.error === 'APP_URL not configured'
  }))

// @aws-sdk/client-sns (a top-level import in send-reminders.js, wholly
// unrelated to this patch) is not installed in this sandbox's
// node_modules — a pre-existing environment gap, not something this
// bounded fix touches or should paper over. Skip the dynamic invocation
// gracefully rather than reporting a false failure; the static
// source-pattern checks in Sections 3-5 already cover this file's actual
// fix (fallback removal, validated appUrl usage, sanitized logging).
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
    await checkAsync('api/send-reminders.js: APP_URL missing → fails closed before any Firestore read or network call (never even lists users)',
      () => withEnv('APP_URL', undefined, async () => {
        process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret-disposable'
        const { default: handler } = await import('../api/send-reminders.js')
        const res = makeRes()
        await withTimeout(
          handler({ method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } }, res),
          2000, 'send-reminders.js')
        return res._status === 500 && res._json?.error === 'APP_URL not configured'
      }))
  } else {
    skip('api/send-reminders.js: APP_URL missing → fails closed (dynamic invocation)',
      '@aws-sdk/client-sns is not installed in this environment — pre-existing, unrelated to this patch; covered instead by the static source-pattern checks below')
  }
}

// =========================================================================
// SECTION 3 — full source sweep of the WHOLE api/ directory (not just the
// 6 files this patch touched) — no literal hardcoded production
// fallback survives anywhere, and no tracked file re-derives one from
// FIREBASE_PROJECT_ID either.
// =========================================================================
{
  const apiDir = new URL('../api/', import.meta.url)
  const apiFiles = readdirSync(apiDir, { recursive: true })
    .filter(f => f.endsWith('.js'))
    .map(f => new URL(f, apiDir))

  check('at least the 6 known files (plus others) were actually scanned — sanity check on the directory walk',
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
    // The old pattern: `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app` used
    // as an implicit default bucket. A literal FIREBASE_PROJECT_ID reference
    // inside a template string ending in .firebasestorage.app, used as a
    // fallback value, must not remain anywhere.
    if (/defaultBucket\s*=/.test(src) || /\$\{process\.env\.FIREBASE_PROJECT_ID\}\.firebasestorage\.app/.test(src)) projectIdDerivedBucketHits.push(fileUrl.pathname)
  }

  check('no tracked api/*.js file contains `|| \'idogs-app.firebasestorage.app\'` anywhere', bucketFallbackHits.length === 0, JSON.stringify(bucketFallbackHits))
  check('no tracked api/*.js file contains `|| \'https://idogs.com.au\'` anywhere', urlFallbackHits.length === 0, JSON.stringify(urlFallbackHits))
  check('no tracked api/*.js file re-derives a default bucket from FIREBASE_PROJECT_ID (the old defaultBucket pattern is fully removed)', projectIdDerivedBucketHits.length === 0, JSON.stringify(projectIdDerivedBucketHits))
}

// =========================================================================
// SECTION 4 — the fix is surgical: unrelated client-branding/domain
// references (verified sender address, footer copy) are untouched.
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
  check('api/export-report.js no longer initializes Firebase Admin with any storageBucket option at all (it performs no Storage operation)',
    !/storageBucket:/.test(exportSrc))

  const sendRemindersSrc = readFileSync(new URL('../api/send-reminders.js', import.meta.url), 'utf8')
  check('api/send-reminders.js email BODY links to idogs.com.au are untouched (production is the only place these cron emails realistically send from — GitHub Actions hits idogs.com.au directly)',
    /https:\/\/idogs\.com\.au\/app\/dogs\/\$\{dog\.id\}/.test(sendRemindersSrc))
  check('api/send-reminders.js internal send-email calls now use the validated appUrl, not a literal fallback',
    (sendRemindersSrc.match(/await fetch\(`\$\{appUrl\}\/api\/send-email`/g) || []).length === 3)
}

// =========================================================================
// SECTION 5 — the config-error responses/logs are sanitized: fixed
// operation name + fixed allowlisted code only, no raw value ever
// interpolated into the log or the client-facing response.
// =========================================================================
{
  const requireConfigSrc = readFileSync(new URL('../api/_lib/require-config.js', import.meta.url), 'utf8')
  check('logConfigError() logs a fixed operation string + fixed code — never the raw env value',
    /console\.error\(`\$\{operation\}: configuration error`, \{ code \}\)/.test(requireConfigSrc))

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
}

await summary()
