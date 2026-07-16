// Breeder Workspace completion batch — regression test for
// api/claim-transferred-dogs.js's backward-compatibility fix.
//
// WHY THIS EXISTS: the rewritten explicit-accept claim flow originally
// queried by `transferStatus === 'pendingClaim'` — a field that only
// exists on dogs transferred through the NEW transferDogOwnership()
// path. Every dog transferred under the OLD (currently-in-production)
// mechanism has `status: 'transferred'` and buyerEmail set, but NEVER
// had a transferStatus field at all. Querying by transferStatus alone
// would silently and permanently orphan every already-transferred
// production dog — no error, just "No pending transfers" forever. The
// fix matches on `status === 'transferred'` instead, which both the
// legacy and current transfer paths always set.
//
// Imports the real handler directly (same established pattern as
// test-scan-count-api.mjs), against the Firestore + Auth emulators.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-claim-transferred-dogs.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
import './test-helpers/emulator-credentials.mjs'

const { readFileSync } = await import('node:fs')
const { getFirestore } = await import('firebase-admin/firestore')

// Import the real handler FIRST so its own initializeApp() (default app)
// runs before anything else touches the Admin SDK.
const { default: handler } = await import('../api/claim-transferred-dogs.js')

const seedDb = getFirestore()

const { initializeApp } = await import('firebase/app')
const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')

const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'claim-test-client')
const clientAuth = getClientAuth(clientApp)
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

function mockReq({ token, action, method = 'POST' } = {}) {
  return {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: { action },
  }
}

function mockRes() {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  return res
}

const R = Date.now()
async function newUser(name, email) {
  const { user } = await createUserWithEmailAndPassword(clientAuth, email, 'tam12345*')
  const idToken = await user.getIdToken()
  return { uid: user.uid, idToken }
}

const buyerEmail = `buyer.${R}@emulator.local`
const buyer = await newUser('buyer', buyerEmail)
const stranger = await newUser('stranger', `stranger.${R}@emulator.local`)

// ── Test 1: legacy transferred dog (status only, no transferStatus) is found ──
const legacyDogId = `legacyDog_${R}`
await seedDb.collection('dogs').doc(legacyDogId).set({
  name: 'Legacy Dog', breed: 'Labrador Retriever', passportId: `LEG-2024-${R}`,
  tenantId: 'breederUid', currentOwnerId: 'breederUid',
  status: 'transferred', buyerEmail, buyerName: 'Test Buyer',
  transferredAt: new Date().toISOString(),
  // transferStatus intentionally absent — this is the exact legacy shape.
})

// ── Test 2: new-style transferred dog (both status and transferStatus) is found ──
const newDogId = `newDog_${R}`
await seedDb.collection('dogs').doc(newDogId).set({
  name: 'New Flow Dog', breed: 'Golden Retriever', passportId: `NEW-2026-${R}`,
  tenantId: 'breederUid', currentOwnerId: 'breederUid',
  status: 'transferred', transferStatus: 'pendingClaim',
  buyerEmail, buyerName: 'Test Buyer', previousOwnerId: 'breederUid',
  transferredAt: new Date().toISOString(),
})

// ── Test 3: active (non-transferred) dog with the same buyerEmail must not be claimable ──
const activeDogId = `activeDog_${R}`
await seedDb.collection('dogs').doc(activeDogId).set({
  name: 'Still Active Dog', breed: 'Poodle', passportId: `ACT-2026-${R}`,
  tenantId: 'breederUid', currentOwnerId: 'breederUid',
  status: 'active', buyerEmail, // stale/leftover field from a prior unrelated flow — must not match
})

// ── check: buyer sees exactly the two transferred dogs, not the active one ──
{
  const req = mockReq({ token: buyer.idToken, action: 'check' })
  const res = mockRes()
  await handler(req, res)
  check('check: 200 OK', res.statusCode === 200, `got ${res.statusCode}`)
  const ids = (res.body?.dogs || []).map(d => d.id).sort()
  check('Legacy transferred dog (no transferStatus) is found', ids.includes(legacyDogId))
  check('New-style transferred dog (transferStatus=pendingClaim) is found', ids.includes(newDogId))
  check('Active (non-transferred) dog with same buyerEmail is NOT included', !ids.includes(activeDogId))
  check('Exactly 2 dogs found (no extras)', ids.length === 2, `got ${JSON.stringify(ids)}`)
}

// ── unrelated email cannot see or claim these dogs ──
{
  const req = mockReq({ token: stranger.idToken, action: 'check' })
  const res = mockRes()
  await handler(req, res)
  check('Unrelated user sees zero pending dogs', (res.body?.dogs || []).length === 0)
}

// ── claim: both transferred dogs actually get claimed ──
{
  const req = mockReq({ token: buyer.idToken, action: 'claim' })
  const res = mockRes()
  await handler(req, res)
  check('claim: 200 OK', res.statusCode === 200)
  check('claim: exactly 2 dogs claimed', res.body?.claimed === 2, `got ${JSON.stringify(res.body)}`)

  const legacyAfter = (await seedDb.collection('dogs').doc(legacyDogId).get()).data()
  check('Legacy dog: currentOwnerId updated to buyer', legacyAfter.currentOwnerId === buyer.uid)
  check('Legacy dog: status reset to active', legacyAfter.status === 'active')
  check('Legacy dog: tenantId (original breeder) unchanged', legacyAfter.tenantId === 'breederUid')

  const newAfter = (await seedDb.collection('dogs').doc(newDogId).get()).data()
  check('New-flow dog: currentOwnerId updated to buyer', newAfter.currentOwnerId === buyer.uid)
  check('New-flow dog: transferStatus field removed after claim', newAfter.transferStatus === undefined)

  const activeAfter = (await seedDb.collection('dogs').doc(activeDogId).get()).data()
  check('Active dog untouched by claim (currentOwnerId still the breeder)', activeAfter.currentOwnerId === 'breederUid')
}

// ── re-check after claim: nothing left pending for this buyer ──
{
  const req = mockReq({ token: buyer.idToken, action: 'check' })
  const res = mockRes()
  await handler(req, res)
  check('After claiming, check returns zero remaining pending dogs', (res.body?.dogs || []).length === 0)
}

// ── static check: no PII (email/uid/dog name) diagnostic logging remains ──
{
  const src = readFileSync(new URL('../api/claim-transferred-dogs.js', import.meta.url), 'utf8')
  const hasDiagLog = /\[claim-diag\]/.test(src)
  check('No [claim-diag] PII logging markers remain in the handler source', !hasDiagLog)
  const consoleLogLines = src.split('\n').filter(l => /console\.log/.test(l))
  check('No console.log calls reference email/uid/token/buyerEmail directly', !consoleLogLines.some(l => /email|uid|token|buyerEmail/i.test(l)), JSON.stringify(consoleLogLines))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
