// ADR-002 Phase C2 — focused API-level tests for api/scan-count.js, run
// against the Firestore + Auth emulators. Imports the real handler
// directly (same established pattern as test-passport-api.mjs), and uses
// the client Auth SDK against the Auth emulator to mint real, verifiable
// ID tokens for three users: the current owner, the issuing breeder
// (historical access), and an unrelated stranger.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-scan-count-api.mjs

import { readFileSync } from 'node:fs'

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
// Admin SDK needs cert()-shaped values to initialize, but since the two
// EMULATOR_HOST vars above redirect all Firestore/Auth calls to the local
// emulators (which do not validate credentials or signatures), these
// never need to be real — only well-formed enough for cert() to
// construct. Same disposable key used by test-passport-api.mjs.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-idogs-qa'
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@demo-idogs-qa.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCm5knzopv4R+Qb\nki7Y1EtthwxaxcK3kygu9ddhm2IvDOAACPOvusmIcJ4UDj5oF+6eT13K2KyGu74O\n2LtHkMOxUBqh5JE/45DSGJN1LqIK+aBq/sYwgvT5GHTQTNvvJRnNEPQbI4OROo7A\no6N8C/Rk0OdkCh/RXHhY29WAPns/hZuy0MxEuxmdR4I01tKSdTTJ8hXGYtwGZpN/\nhX3Z8xvkF5i1Dba0k1SElRaiIXxCSU5kVWzCaI+5uyQwctVUDikEo0ghoD3Uuldk\nfhtBPI8lngyAGC3Ql/3KYY41vm0lXUp3u9h2e5bqvYjmpeQ3sdAWUffjZ12c8/Dr\n0GiR4O55AgMBAAECggEAC3fGI8+b6jPNYpAZODShIKvff1K4mgrKX2yswZQOy2cV\n8qaq0NuzqpR7Zisi4l3nm1jee9hGxYS7rtM5ThXuPl4f0FkvWk2ZhzghVLNRNtIX\ncdai+VUcPkvuBdyMHarl0pN8RGucqBNXGPk9e+Hp5237wkHYVRdGnStwyHyylQcN\nb6DE40BuNNrylEKChwUy0JbCoHezkMOyE0extYzDpboXFbQVG2pbnMPWmx9UOW2S\nT9tckw9Waz11VF4g/hXJqyWEhs3PwzG+QOYQR16ZMDRaOfGA6Rf5JIlClTNxW99t\nBqPP/b26FpaQklGZl62QYF6E8E72vQSH/Y2QGoNnQQKBgQDp8AgSoEK69inan0xK\n/UDN1ZhDUqgN3zumW5sUKU09tTu2pN0OSxhiF9qjcSHvF63V6Au8VkfI/mLu6LTg\npqVrjX2jXV5tGf+C6IJl+NUOJd0QjqpUD5tDGXOk6Qo5QUCogX5XOmC0C4t8Pwhq\nf7M7A2ok6PMtiKp2R1F38tcLuQKBgQC2o8EDmjR6zjDos1FsGf34m4/hdimlQkbw\n3YVSLRB6TmWXE45Vy7X/ajj/OlqKX5Eo//g6VEyF60hfIZzVsHwBNltHPsp95HMo\n+57c6vNr1XZxvVPoOxBQjYDjgqNqHVQsVjJwrnPLT6nScpQ/5OkrFsqdTQwhIP+1\nmtXle0XYwQKBgBe+oVMiqSNI8R6bpKbH5df+oiHTNfOSgP91tNvrBUgKKTF0smtM\n/ACY4zxLs2INSTu4/dfz+f1QtMIDJLjYsVmlVudKBteUF/c1mma3RwjUlwejM26s\n1tmMr8xBSyRcly+DVUuNRVuBAHtv+m6034BR7GgqrOQmRwcSXhaKs4EhAoGAWgfq\n842mZQsTTQJoFrPRYCW/DVMkQFSlh8KLH/Ea+E+BALIhLeXXd2qzYg0v6JongmB7\nyrUXa8SJzmtRVn1DA435/OrVAq4EnqU6sIgZKoT1eCfuHsJOzoaSjJQvXfXLMnfj\nMWytpAFHI3hb4AtFbXo0ssnyOrp7ktgarJ7R1YECgYEAvQEGFldohSggUB29J368\nu+i6bqTYiBNYetgTIoRB5aelBm4Pk1XNbnqY9EOhVqYNAlnoGkB2eGEuMfT42Ag0\nqlvbAcGPFCw2KY7oQXb65R58QftvrbVK1dbEQ/g20altqE8s3jSdfWhwBniAHYeB\no42wx9g4HbGZbyHxvHGAykY=\n-----END PRIVATE KEY-----\n'

const { getFirestore } = await import('firebase-admin/firestore')

// Import the real handler FIRST so its own initializeApp() (default app)
// runs before anything else touches the Admin SDK.
const { default: handler } = await import('../api/scan-count.js')

const seedDb = getFirestore()

// Client SDK, only for minting real ID tokens against the Auth emulator.
const { initializeApp } = await import('firebase/app')
const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')

const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'scan-count-test-client')
const clientAuth = getClientAuth(clientApp)
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

function mockReq({ token, dogId, method = 'POST' } = {}) {
  return {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: dogId === undefined ? {} : { dogId },
  }
}

function mockRes() {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  return res
}

const R = Date.now()
async function newUser(name) {
  const { user } = await createUserWithEmailAndPassword(clientAuth, `scancount.${name}.${R}@emulator.local`, 'tam12345*')
  const idToken = await user.getIdToken()
  return { uid: user.uid, idToken }
}

const owner = await newUser('owner')
const breeder = await newUser('breeder')
const stranger = await newUser('stranger')

// ── Seed a transferred dog: original breeder (tenantId) is different
// from the current owner (currentOwnerId) — this is exactly the
// historical-access scenario the ownership check must support.
const dogId = `scanCountTestDog_${R}`
await seedDb.collection('dogs').doc(dogId).set({
  passportId: `SCN-2026-${R.toString(36).toUpperCase().slice(-4)}`,
  name: 'Scan Test Dog', breed: 'Kelpie', sex: 'male', dateOfBirth: '2023-01-01',
  tenantId: breeder.uid, currentOwnerId: owner.uid, status: 'active',
})

// Seed 3 scans for this dog, plus 1 for an unrelated dog (must not be counted).
for (let i = 0; i < 3; i++) {
  await seedDb.collection('scanLogs').add({
    dogId, passportId: `SCN-2026-${R}`, scannedAt: new Date().toISOString(), result: 'public_view',
  })
}
await seedDb.collection('scanLogs').add({
  dogId: `otherDog_${R}`, passportId: 'OTHER', scannedAt: new Date().toISOString(), result: 'public_view',
})

// ── Test 1: current owner receives the correct count ──
{
  const req = mockReq({ token: owner.idToken, dogId })
  const res = mockRes()
  await handler(req, res)
  check('Current owner: 200', res.statusCode === 200, `got ${res.statusCode}`)
  check('Current owner: correct count (3, scoped to this dog only)', res.body?.count === 3, `got ${JSON.stringify(res.body)}`)
}

// ── Test 2: issuing breeder receives the same (intended historical access) ──
{
  const req = mockReq({ token: breeder.idToken, dogId })
  const res = mockRes()
  await handler(req, res)
  check('Issuing breeder: 200 (historical access preserved)', res.statusCode === 200, `got ${res.statusCode}`)
  check('Issuing breeder: correct count', res.body?.count === 3, `got ${JSON.stringify(res.body)}`)
}

// ── Test 3: unrelated user is denied ──
{
  const req = mockReq({ token: stranger.idToken, dogId })
  const res = mockRes()
  await handler(req, res)
  check('Unrelated user: denied (403)', res.statusCode === 403, `got ${res.statusCode}`)
  check('Unrelated user: no count leaked in denial body', res.body?.count === undefined)
}

// ── Test 4: unauthenticated request is denied ──
{
  const req = mockReq({ dogId }) // no token
  const res = mockRes()
  await handler(req, res)
  check('Unauthenticated: denied (401)', res.statusCode === 401, `got ${res.statusCode}`)
}

// ── Test 4b: invalid/garbage token is denied ──
{
  const req = mockReq({ token: 'not-a-real-token', dogId })
  const res = mockRes()
  await handler(req, res)
  check('Invalid token: denied (401)', res.statusCode === 401, `got ${res.statusCode}`)
}

// ── Test 5: missing dog returns a safe 404 ──
{
  const req = mockReq({ token: owner.idToken, dogId: `nonexistent_${R}` })
  const res = mockRes()
  await handler(req, res)
  check('Missing dog: safe 404', res.statusCode === 404, `got ${res.statusCode}`)
  check('Missing dog: no count/dog data in body', res.body?.count === undefined && res.body?.dog === undefined)
}

// ── Test 5b: missing dogId param returns 400 ──
{
  const req = mockReq({ token: owner.idToken })
  const res = mockRes()
  await handler(req, res)
  check('Missing dogId: 400', res.statusCode === 400, `got ${res.statusCode}`)
}

// ── Test 6: raw scan data never returned — response shape is exactly { count } ──
{
  const req = mockReq({ token: owner.idToken, dogId })
  const res = mockRes()
  await handler(req, res)
  const keys = Object.keys(res.body || {})
  check('Response body has exactly one key: count', keys.length === 1 && keys[0] === 'count', `got keys: ${keys.join(',')}`)
  check('count is a number, not an array/object of raw scan records', typeof res.body.count === 'number')
}

// ── Test 7: client no longer queries scanLogs directly ──
{
  const dbTs = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  const noDirectScanLogsQuery = !/collection\(db,\s*['"]scanLogs['"]\)/.test(
    dbTs.replace(/export async function logScan[\s\S]*?\r?\n}\r?\n/, '') // logScan() still legitimately WRITES via addDoc — exclude it
  )
  check('src/lib/db.ts no longer queries scanLogs directly for reads', noDirectScanLogsQuery)
  check('getScanCount() now calls /api/scan-count', dbTs.includes("fetch('/api/scan-count'"))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
