// ADR-002 Phase A — focused API-level tests for api/passport.js, run
// against the Firestore emulator (unit/API-level, no production access).
// Imports the real handler directly and calls it with mock req/res
// objects, so this exercises the actual production code path, not a
// re-implementation of its logic.
//
// Usage (no test framework configured in this project — run manually):
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/test-passport-api.mjs

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
// Admin SDK needs cert()-shaped values to initialize, but since
// FIRESTORE_EMULATOR_HOST redirects all Firestore calls to the local
// emulator (which does not validate credentials), these never need to
// be real — only well-formed enough for cert() to construct.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-idogs-qa'
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@demo-idogs-qa.iam.gserviceaccount.com'
// A structurally-valid but disposable, locally-generated RSA key —
// cert() validates PEM/PKCS8 structure at construction time even though
// FIRESTORE_EMULATOR_HOST means it's never actually used to sign
// anything (all Firestore calls route to the local emulator). Not a
// real credential; generate a fresh one if this ever needs rotating:
// node -e "console.log(require('crypto').generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'}}).privateKey)"
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCm5knzopv4R+Qb\nki7Y1EtthwxaxcK3kygu9ddhm2IvDOAACPOvusmIcJ4UDj5oF+6eT13K2KyGu74O\n2LtHkMOxUBqh5JE/45DSGJN1LqIK+aBq/sYwgvT5GHTQTNvvJRnNEPQbI4OROo7A\no6N8C/Rk0OdkCh/RXHhY29WAPns/hZuy0MxEuxmdR4I01tKSdTTJ8hXGYtwGZpN/\nhX3Z8xvkF5i1Dba0k1SElRaiIXxCSU5kVWzCaI+5uyQwctVUDikEo0ghoD3Uuldk\nfhtBPI8lngyAGC3Ql/3KYY41vm0lXUp3u9h2e5bqvYjmpeQ3sdAWUffjZ12c8/Dr\n0GiR4O55AgMBAAECggEAC3fGI8+b6jPNYpAZODShIKvff1K4mgrKX2yswZQOy2cV\n8qaq0NuzqpR7Zisi4l3nm1jee9hGxYS7rtM5ThXuPl4f0FkvWk2ZhzghVLNRNtIX\ncdai+VUcPkvuBdyMHarl0pN8RGucqBNXGPk9e+Hp5237wkHYVRdGnStwyHyylQcN\nb6DE40BuNNrylEKChwUy0JbCoHezkMOyE0extYzDpboXFbQVG2pbnMPWmx9UOW2S\nT9tckw9Waz11VF4g/hXJqyWEhs3PwzG+QOYQR16ZMDRaOfGA6Rf5JIlClTNxW99t\nBqPP/b26FpaQklGZl62QYF6E8E72vQSH/Y2QGoNnQQKBgQDp8AgSoEK69inan0xK\n/UDN1ZhDUqgN3zumW5sUKU09tTu2pN0OSxhiF9qjcSHvF63V6Au8VkfI/mLu6LTg\npqVrjX2jXV5tGf+C6IJl+NUOJd0QjqpUD5tDGXOk6Qo5QUCogX5XOmC0C4t8Pwhq\nf7M7A2ok6PMtiKp2R1F38tcLuQKBgQC2o8EDmjR6zjDos1FsGf34m4/hdimlQkbw\n3YVSLRB6TmWXE45Vy7X/ajj/OlqKX5Eo//g6VEyF60hfIZzVsHwBNltHPsp95HMo\n+57c6vNr1XZxvVPoOxBQjYDjgqNqHVQsVjJwrnPLT6nScpQ/5OkrFsqdTQwhIP+1\nmtXle0XYwQKBgBe+oVMiqSNI8R6bpKbH5df+oiHTNfOSgP91tNvrBUgKKTF0smtM\n/ACY4zxLs2INSTu4/dfz+f1QtMIDJLjYsVmlVudKBteUF/c1mma3RwjUlwejM26s\n1tmMr8xBSyRcly+DVUuNRVuBAHtv+m6034BR7GgqrOQmRwcSXhaKs4EhAoGAWgfq\n842mZQsTTQJoFrPRYCW/DVMkQFSlh8KLH/Ea+E+BALIhLeXXd2qzYg0v6JongmB7\nyrUXa8SJzmtRVn1DA435/OrVAq4EnqU6sIgZKoT1eCfuHsJOzoaSjJQvXfXLMnfj\nMWytpAFHI3hb4AtFbXo0ssnyOrp7ktgarJ7R1YECgYEAvQEGFldohSggUB29J368\nu+i6bqTYiBNYetgTIoRB5aelBm4Pk1XNbnqY9EOhVqYNAlnoGkB2eGEuMfT42Ag0\nqlvbAcGPFCw2KY7oQXb65R58QftvrbVK1dbEQ/g20altqE8s3jSdfWhwBniAHYeB\no42wx9g4HbGZbyHxvHGAykY=\n-----END PRIVATE KEY-----\n'

const { getFirestore } = await import('firebase-admin/firestore')

// Import the real handler FIRST so its own initializeApp() (default app)
// runs before anything else touches the Admin SDK — a second named app
// would make api/passport.js's own `if (!getApps().length)` guard skip
// initializing the default app, breaking its internal getFirestore().
const { default: handler } = await import('../api/passport.js')

// Reuse the same default app (now initialized by the handler's own
// module-level code) for seeding, so both point at the same emulator.
const seedDb = getFirestore()

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
