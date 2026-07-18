// ADR-002 Phase A — focused API-level tests for api/passport.js, run
// against the Firestore emulator (unit/API-level, no production access).
// Imports the real handler directly and calls it with mock req/res
// objects, so this exercises the actual production code path, not a
// re-implementation of its logic.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/test-passport-api.mjs

// Admin SDK needs cert()-shaped values to initialize, but since
// FIRESTORE_EMULATOR_HOST redirects all Firestore calls to the local
// emulator (which does not validate credentials), these never need to
// be real — only well-formed enough for cert() to construct. See
// test-helpers/emulator-credentials.mjs for the shared setup (also sets
// FIRESTORE_EMULATOR_HOST).
import './test-helpers/emulator-credentials.mjs'

const { getFirestore } = await import('firebase-admin/firestore')

// Import the real handler FIRST so its own initializeApp() (default app)
// runs before anything else touches the Admin SDK — a second named app
// would make api/passport.js's own `if (!getApps().length)` guard skip
// initializing the default app, breaking its internal getFirestore().
const { default: handler } = await import('../api/passport.js')

// Reuse the same default app (now initialized by the handler's own
// module-level code) for seeding, so both point at the same emulator.
const seedDb = getFirestore()

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

// ADR-002 Phase C1 — handler now checks rate-limiting first, which reads
// req.headers/req.socket. All mock requests below go through this so
// every call is well-formed; a fixed test IP is fine here since this
// suite's ~6 calls stay far under the default per-window limit.
function mockReq(query) {
  return { method: 'GET', query, headers: { 'x-forwarded-for': '198.51.100.10' }, socket: {} }
}

function mockRes() {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  return res
}

const R = Date.now()

// ── Seed test data ──
const dog1Id = `passportTestDog1_${R}`
await seedDb.collection('dogs').doc(dog1Id).set({
  passportId: `TST-2024-${R.toString(36).toUpperCase().slice(-4)}A`,
  name: 'Rex', breed: 'Labrador Retriever', sex: 'male', dateOfBirth: '2024-01-15',
  colour: 'Golden', microchip: '956000012345678', ankc: '3100012345',
  lifeStage: 'adult', profilePhoto: null, status: 'active',
  tenantId: 'breederUid123', currentOwnerId: 'breederUid123', createdByUserId: 'breederUid123',
  sourceType: 'BREEDER_ISSUED', isDeceased: false,
  notes: 'private breeder notes', buyerName: 'Jane Buyer', buyerEmail: 'jane@example.com',
  breederIdType: 'DACO_SA', breederIdValue: 'DACO12345',
})
await seedDb.collection('vaccineRecords').add({ dogId: dog1Id, name: 'C5', dateGiven: '2024-06-01', nextDue: '2025-06-01' })
await seedDb.collection('healthTests').add({ dogId: dog1Id, testType: 'hip', result: 'Excellent', dateTested: '2024-08-01', certNumber: 'CERT-123' })

// Legacy dog — no sourceType/isDeceased field at all
const dog2Id = `passportTestDog2_${R}`
await seedDb.collection('dogs').doc(dog2Id).set({
  passportId: `LEG-2020-${R.toString(36).toUpperCase().slice(-4)}B`,
  name: 'Legacy Dog', breed: 'Poodle', sex: 'female', dateOfBirth: '2020-01-01',
  colour: 'White', lifeStage: 'senior', status: 'active',
  tenantId: 'legacyUid', currentOwnerId: 'legacyUid',
  // sourceType and isDeceased intentionally absent
})

// Deceased dog
const dog3Id = `passportTestDog3_${R}`
await seedDb.collection('dogs').doc(dog3Id).set({
  passportId: `DEC-2018-${R.toString(36).toUpperCase().slice(-4)}C`,
  name: 'Remembered Dog', breed: 'Beagle', sex: 'male', dateOfBirth: '2018-01-01',
  colour: 'Tricolour', lifeStage: 'remembered', status: 'active',
  tenantId: 'uid3', currentOwnerId: 'uid3', sourceType: 'OWNER_CREATED', isDeceased: true,
})

// ── Test 1: valid passport returns approved fields ──
{
  const req = mockReq({ passportId: (await seedDb.collection('dogs').doc(dog1Id).get()).data().passportId })
  const res = mockRes()
  await handler(req, res)
  check('Valid passport returns 200', res.statusCode === 200, `got ${res.statusCode}`)
  check('Returns dog.name', res.body?.dog?.name === 'Rex')
  check('Returns dog.breed/sex/dateOfBirth/colour/lifeStage/passportId/status',
    res.body?.dog?.breed === 'Labrador Retriever' && res.body?.dog?.sex === 'male' &&
    res.body?.dog?.dateOfBirth === '2024-01-15' && res.body?.dog?.colour === 'Golden' &&
    res.body?.dog?.lifeStage === 'adult' && res.body?.dog?.status === 'active')
  check('Returns vaccines array', Array.isArray(res.body?.vaccines) && res.body.vaccines.length === 1)
  check('Returns healthTests array', Array.isArray(res.body?.healthTests) && res.body.healthTests.length === 1)

  // ── sourceType/isDeceased present ──
  check('sourceType present and correct', res.body?.dog?.sourceType === 'BREEDER_ISSUED')
  check('isDeceased present and false', res.body?.dog?.isDeceased === false)

  // ── microchip/ANKC excluded ──
  check('microchip field absent from response', !('microchip' in (res.body?.dog || {})))
  check('ankc field absent from response', !('ankc' in (res.body?.dog || {})))

  // ── private ownership fields excluded ──
  const dogKeys = Object.keys(res.body?.dog || {})
  check('tenantId absent', !dogKeys.includes('tenantId'))
  check('currentOwnerId absent', !dogKeys.includes('currentOwnerId'))
  check('createdByUserId absent', !dogKeys.includes('createdByUserId'))
  check('notes absent', !dogKeys.includes('notes'))
  check('buyerName absent', !dogKeys.includes('buyerName'))
  check('buyerEmail absent', !dogKeys.includes('buyerEmail'))
  check('breederIdType absent', !dogKeys.includes('breederIdType'))
  check('breederIdValue absent', !dogKeys.includes('breederIdValue'))

  // ── no raw document leakage — response dog object has only the
  // explicit allowlisted keys, nothing else ──
  const allowedKeys = ['id', 'name', 'breed', 'sex', 'dateOfBirth', 'colour', 'lifeStage', 'profilePhoto', 'passportId', 'status', 'sourceType', 'isDeceased']
  const unexpectedKeys = dogKeys.filter(k => !allowedKeys.includes(k))
  check('No unexpected keys beyond the explicit allowlist', unexpectedKeys.length === 0, `extra keys: ${unexpectedKeys.join(',')}`)
}

// ── Test 2: legacy dog — sourceType fallback ──
{
  const req = mockReq({ passportId: (await seedDb.collection('dogs').doc(dog2Id).get()).data().passportId })
  const res = mockRes()
  await handler(req, res)
  check('Legacy dog (no sourceType field) falls back to BREEDER_ISSUED', res.body?.dog?.sourceType === 'BREEDER_ISSUED')
  check('Legacy dog (no isDeceased field) falls back to false', res.body?.dog?.isDeceased === false)
}

// ── Test 3: deceased dog ──
{
  const req = mockReq({ passportId: (await seedDb.collection('dogs').doc(dog3Id).get()).data().passportId })
  const res = mockRes()
  await handler(req, res)
  check('Deceased dog isDeceased=true in response', res.body?.dog?.isDeceased === true)
  check('Deceased dog sourceType correctly OWNER_CREATED (not overridden by fallback)', res.body?.dog?.sourceType === 'OWNER_CREATED')
}

// ── Test 4: unknown passport returns safe not-found response ──
{
  const req = mockReq({ passportId: `NONEXISTENT-${R}` })
  const res = mockRes()
  await handler(req, res)
  check('Unknown passport returns 404', res.statusCode === 404, `got ${res.statusCode}`)
  check('404 body has no dog data', !res.body?.dog)
}

// ── Test 5: missing passportId param ──
{
  const req = mockReq({})
  const res = mockRes()
  await handler(req, res)
  check('Missing passportId returns 400', res.statusCode === 400, `got ${res.statusCode}`)
}

await summary()
