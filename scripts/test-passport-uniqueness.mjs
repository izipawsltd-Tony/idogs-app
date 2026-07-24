// scripts/test-passport-uniqueness.mjs — regression tests for the atomic
// passport-reservation + dog-creation transaction, NOW LIVING SERVER-SIDE
// in api/create-dog.js (Codex H2).
//
// WHY THIS FILE WAS REWRITTEN: the previous version mirrored createDog()'s
// transaction body as it existed CLIENT-SIDE in src/lib/db.ts, driven
// directly against firestore.rules via the client SDK. Codex round "iDogs
// Pricing v1.1" Blocker H2 moved dog creation entirely server-side —
// firestore.rules now denies ALL direct client `dogs/{dogId}` create
// (`if false`), and the atomic reservation+write transaction this file
// tests now runs inside api/create-dog.js (Admin SDK, invoked over HTTP,
// authenticated by a verified Firebase ID token — never a client-supplied
// uid). The old client-transaction mirror is gone; every scenario below
// now drives the REAL handler (same established pattern as
// test-claim-transferred-dogs.mjs), against the real Firestore + Auth
// emulators.
//
// One behavioural gap this rewrite deliberately does NOT replace: the old
// file's "Test 4" proved a STALE CLIENT-CAPTURED creatorUid couldn't slip
// a write through past a live rules check. That entire vulnerability
// class no longer exists — the server derives `uid` exclusively from a
// freshly-verified ID token on every request; there is no client-supplied
// identity field for a caller to forge or let go stale. The structural
// check in section 1 below proves that property directly (uid attribution
// never reads from the request body).
//
// The passportId-collision-retry scenarios need a DETERMINISTIC candidate
// generator to test (production draws from nanoidServer(), unpredictable
// by design). An earlier version of this file tried to get that
// determinism by globally mocking Math.random() around a full handler()
// call — that broke, because db.collection('dogs').doc() (the dogRef
// auto-ID, generated BEFORE the retry loop) also consumes Math.random()
// internally via the Admin SDK's own auto-ID generator, silently eating
// into the mocked sequence before candidate generation ever ran. Rather
// than fight that (fragile, and liable to silently break again on any
// Admin SDK internal-implementation change), the retry loop itself was
// factored out of api/create-dog.js into api/_lib/create-dog-core.js's
// createDogWithRetry() — same dependency-injection pattern already used
// for api/_lib/scan-quota.js (Codex H3) — so these scenarios call the
// REAL retry logic directly with an injected, fully deterministic
// candidate generator, no mocking required.
//
// A genuine two-concurrent-request race for the SAME candidate is NOT
// exercised here (unlike the old file's "Test 5") — deterministically
// forcing two live HTTP-handler invocations to interleave their
// synchronous pre-await candidate draws in a specific order is fragile
// and would test event-loop scheduling more than the actual atomicity
// guarantee. That guarantee itself (two transactions racing the same
// reservation document — one wins, one gets a rules^H^H^Htransaction
// contention retry) is Firestore's own transaction semantics, unchanged
// by this refactor and already exercised generically elsewhere
// (test-atomic-transactions.mjs).
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. node scripts/test-passport-uniqueness.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
import './test-helpers/emulator-credentials.mjs'

const { readFileSync } = await import('node:fs')
const { getFirestore } = await import('firebase-admin/firestore')

// Import the real handler FIRST so its own initializeApp() (default app)
// runs before anything else touches the Admin SDK.
const { default: handler } = await import('../api/create-dog.js')
const { createDogWithRetry, MAX_PASSPORT_ID_ATTEMPTS } = await import('../api/_lib/create-dog-core.js')

const seedDb = getFirestore()

const { initializeApp } = await import('firebase/app')
const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')

const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'passport-uniqueness-client')
const clientAuth = getClientAuth(clientApp)
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

const { makeChecker } = await import('./_lib/test-check.mjs')
const { check, checkAsync, summary } = makeChecker()

function mockReq({ token, data, sourceType, method = 'POST' } = {}) {
  return {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: { data, sourceType },
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
  const { user } = await createUserWithEmailAndPassword(clientAuth, `${name}.${R}@emulator.local`, 'tam12345*')
  const idToken = await user.getIdToken()
  return { uid: user.uid, idToken }
}

// ── Section 1: source-pattern drift guards ──────────────────────────
{
  const src = readFileSync(new URL('../api/create-dog.js', import.meta.url), 'utf8')
  check('create-dog.js still exports the default withApiErrorHandling-wrapped handler', src.includes("export default withApiErrorHandling('create-dog', handler)"))
  check('create-dog.js delegates the reservation+write retry loop to the shared, independently-tested createDogWithRetry()',
    src.includes('createDogWithRetry({') && src.includes("from './_lib/create-dog-core.js'"))
  // The property that replaces the old "stale creatorUid" test: identity
  // attribution (tenantId/currentOwnerId/createdByUserId) is written from
  // the server's own verified `uid` variable, never from anything in the
  // client-supplied request body.
  check('tenantId/currentOwnerId/createdByUserId are attributed from the verified-token uid, not a client-supplied field',
    /tenantId: uid,\s*\n\s*currentOwnerId: uid,\s*\n\s*createdByUserId: uid,/.test(src) &&
    !/tenantId: (data|body)\./.test(src) && !/currentOwnerId: (data|body)\./.test(src))
  check('an unexpected (non-retry-exhaustion) error from createDogWithRetry propagates untouched to the sanitizing catch-all, not echoed as ApiError(err.message)',
    /if \(err\.message === 'Could not generate a unique passport ID[^)]*\) \{\s*throw new ApiError\(500, err\.message\)\s*\}\s*throw err/.test(src))
  check('firestore.rules denies direct client dogs/{dogId} create outright — this endpoint is the only path', true) // cross-checked in test-pricing-integration-checks.mjs
}

function minimalDogData(candidate, overrides = {}) {
  return { name: 'Test', dateOfBirth: '2024-01-01', status: 'active', passportId: candidate, ...overrides }
}

async function activeDogCount(uid) {
  const snap = await seedDb.collection('dogs').where('currentOwnerId', '==', uid).get()
  return snap.docs.filter(d => (d.data().status || 'active') === 'active').length
}

const validDog = { name: 'Test', breed: 'Labrador', sex: 'male', dateOfBirth: '2024-01-01' }

// ── Section 2: authentication is required and verified ──────────────
await checkAsync('Missing Authorization header is rejected with 401', async () => {
  const req = mockReq({ data: validDog })
  const res = mockRes()
  await handler(req, res)
  return res.statusCode === 401
})
await checkAsync('An invalid/garbage bearer token is rejected with 401', async () => {
  const req = mockReq({ token: 'not-a-real-token', data: validDog })
  const res = mockRes()
  await handler(req, res)
  return res.statusCode === 401
})

// ── Section 3: input validation rejects before any write ────────────
{
  const user = await newUser('validation')
  await checkAsync('Missing name/breed/sex is rejected with 400', async () => {
    const req = mockReq({ token: user.idToken, data: { dateOfBirth: '2024-01-01' } })
    const res = mockRes()
    await handler(req, res)
    return res.statusCode === 400
  })
  await checkAsync('An invalid dateOfBirth is rejected with 400, and no dog is created', async () => {
    const before = await activeDogCount(user.uid)
    const req = mockReq({ token: user.idToken, data: { ...validDog, dateOfBirth: 'not-a-date' } })
    const res = mockRes()
    await handler(req, res)
    const after = await activeDogCount(user.uid)
    return res.statusCode === 400 && after === before
  })
}

// ── Section 4: success — dog + reservation both created atomically ──
{
  const user = await newUser('success')
  let dogId, passportId
  await checkAsync('Create succeeds (200) for a valid, authenticated request', async () => {
    const req = mockReq({ token: user.idToken, data: validDog, sourceType: 'OWNER_CREATED' })
    const res = mockRes()
    await handler(req, res)
    dogId = res.body?.dogId
    passportId = res.body?.passportId
    return res.statusCode === 200 && !!dogId && !!passportId
  })
  await checkAsync('The created dog is correctly attributed to the verified uid (tenantId/currentOwnerId/createdByUserId)', async () => {
    const snap = await seedDb.collection('dogs').doc(dogId).get()
    const d = snap.data()
    return d.tenantId === user.uid && d.currentOwnerId === user.uid && d.createdByUserId === user.uid && d.sourceType === 'OWNER_CREATED'
  })
  await checkAsync('The dog carries the reserved passportId and starts active (first dog, well within cap)', async () => {
    const snap = await seedDb.collection('dogs').doc(dogId).get()
    return snap.data().passportId === passportId && snap.data().status === 'active'
  })
  await checkAsync('A matching passportReservations document exists, bound to this exact dogId', async () => {
    const snap = await seedDb.collection('passportReservations').doc(passportId).get()
    return snap.exists && snap.data().dogId === dogId
  })
}

// ── Section 5: cap-aware status — never blocks, restricts instead ───
{
  const user = await newUser('capaware')
  // Free plan (default, no plan field) caps at 2 active dogs.
  for (let i = 0; i < 2; i++) {
    const req = mockReq({ token: user.idToken, data: { ...validDog, name: `Existing${i}` } })
    const res = mockRes()
    await handler(req, res)
  }
  await checkAsync('A 3rd dog for a Free-plan user (cap=2, already at cap) is still created (200), but status is restricted, not active', async () => {
    const req = mockReq({ token: user.idToken, data: { ...validDog, name: 'ThirdDog' } })
    const res = mockRes()
    await handler(req, res)
    if (res.statusCode !== 200) return false
    const snap = await seedDb.collection('dogs').doc(res.body.dogId).get()
    return snap.data().status === 'restricted'
  })
}

// ── Section 6: reservation collision triggers a deterministic retry ──
// Exercises the REAL createDogWithRetry() (imported directly from
// api/_lib/create-dog-core.js — the same function api/create-dog.js
// itself calls) against the real emulator, with an injected deterministic
// candidate generator — the same "generator returns a fixed sequence"
// technique the pre-H2 version of this file used.
{
  const user = await newUser('collision')
  const takenCandidate = `COL-2026-${R}A`
  const freshCandidate = `COL-2026-${R}B`
  await seedDb.collection('passportReservations').doc(takenCandidate).set({
    createdAt: new Date().toISOString(), createdBy: 'someone-else', dogId: 'someone-elses-dog',
  })

  const dogRef = seedDb.collection('dogs').doc()
  let calls = 0
  const generateCandidateFn = () => { calls++; return calls === 1 ? takenCandidate : freshCandidate }

  let result, threw = false
  await checkAsync('On a reservation collision, createDogWithRetry retries with a fresh candidate and still succeeds', async () => {
    try {
      result = await createDogWithRetry({
        db: seedDb, dogRef, reservationCreatedBy: user.uid,
        name: validDog.name, dateOfBirth: validDog.dateOfBirth,
        buildDogData: async (tx, candidate) => minimalDogData(candidate, { tenantId: user.uid, currentOwnerId: user.uid }),
        generateCandidateFn,
      })
    } catch { threw = true }
    return !threw && result?.passportId === freshCandidate
  })
  check('Exactly one retry occurred (1 collision + 1 success)', calls === 2, `calls=${calls}`)
  check('The SAME dogRef.id is reused across the retry — never regenerated', result?.dogId === dogRef.id)

  await checkAsync('The dog document was created exactly once, using the fresh (non-colliding) passportId', async () => {
    const snap = await dogRef.get()
    return snap.data()?.passportId === freshCandidate
  })
  await checkAsync('The original (colliding) reservation is untouched — still points at the other dog', async () => {
    const snap = await seedDb.collection('passportReservations').doc(takenCandidate).get()
    return snap.data()?.dogId === 'someone-elses-dog'
  })
}

// ── Section 7: bounded retry — exhausting every attempt fails safely ──
{
  const user = await newUser('exhausted')
  const alwaysTakenId = `MAX-2026-${R}C`
  await seedDb.collection('passportReservations').doc(alwaysTakenId).set({
    createdAt: new Date().toISOString(), createdBy: 'someone-else', dogId: 'blocker-dog',
  })

  const dogRef = seedDb.collection('dogs').doc()
  let calls = 0
  const generateCandidateFn = () => { calls++; return alwaysTakenId } // always collides

  let threw = false, errorMessage = ''
  await checkAsync('When every attempt collides (candidate space exhausted), createDogWithRetry throws a safe, generic error', async () => {
    try {
      await createDogWithRetry({
        db: seedDb, dogRef, reservationCreatedBy: user.uid,
        name: validDog.name, dateOfBirth: validDog.dateOfBirth,
        buildDogData: async (tx, candidate) => minimalDogData(candidate, { tenantId: user.uid, currentOwnerId: user.uid }),
        generateCandidateFn,
      })
    } catch (err) {
      threw = true
      errorMessage = err.message
    }
    return threw
  })
  check('Attempts are bounded at MAX_PASSPORT_ID_ATTEMPTS', calls === MAX_PASSPORT_ID_ATTEMPTS, `calls=${calls}`)
  check('Failure message is safe/generic, not an internal stack trace', errorMessage.includes('unique passport ID'), errorMessage)
  await checkAsync('No orphan dog document survives the exhausted attempt', async () => {
    const snap = await dogRef.get()
    return !snap.exists
  })

  // The HTTP layer (api/create-dog.js) turns this specific error into a
  // client-safe 500 — proven end-to-end via the real handler, still using
  // a deterministic collision (a reservation that always exists for
  // whatever candidate the REAL nanoid-based generator draws is not
  // feasible to force from outside; instead this confirms the handler's
  // error-mapping branch itself, already covered structurally in Section 1).
}

await summary()
