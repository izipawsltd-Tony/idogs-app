// scripts/test-h8-admin-upload-authorization.mjs — Codex H1/H5/H7/H8
// remediation round 2, H8: api/upload-document.js and api/upload.js
// (both Admin SDK, bypass firestore.rules entirely) previously used
// `dog.tenantId === uid || dog.currentOwnerId === uid` — the READ-level
// check — for what are WRITE/create operations, letting a former breeder
// mutate a dog they no longer own. Both now use the shared
// api/_lib/dog-access.js (canAddDogRecord/hasDogWriteAccess), mirroring
// firestore.rules' dogWriteAccess/dogAllowsNewRecords exactly.
//
// This file exercises the REAL exported functions directly (pure logic —
// no Firebase dependency) AND the REAL handlers' rejection paths against
// the live Firestore + Auth emulator (the actual 403 decision happens
// before any Storage call, so no Storage emulator is required for that).
// The full write-succeeds path additionally needs a working Storage
// backend, which this repo's firebase.json does not configure an
// emulator for — that specific gap is called out explicitly below with
// skip(), not silently omitted; "current owner is allowed" is still
// proven directly both via the pure authorization function AND via the
// real handler clearing the 403 gate.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. node scripts/test-h8-admin-upload-authorization.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'demo-idogs-qa.firebasestorage.app'
import './test-helpers/emulator-credentials.mjs'

const { getFirestore } = await import('firebase-admin/firestore')
const { hasDogWriteAccess, canAddDogRecord } = await import('../api/_lib/dog-access.js')

// Import the real handlers FIRST so their own initializeApp() (default
// app) runs before anything else touches the Admin SDK.
const { default: uploadDocumentHandler } = await import('../api/upload-document.js')
const { default: uploadHandler } = await import('../api/upload.js')

const seedDb = getFirestore()

const { initializeApp } = await import('firebase/app')
const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')

const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'h8-upload-auth-client')
const clientAuth = getClientAuth(clientApp)
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

const { makeChecker } = await import('./_lib/test-check.mjs')
const { check, checkAsync, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — pure logic: hasDogWriteAccess / canAddDogRecord
// =========================================================================
{
  const currentOwnerDog = { tenantId: 'breeder-1', currentOwnerId: 'owner-1', status: 'active' }
  check('Current effective owner has write access', hasDogWriteAccess(currentOwnerDog, 'owner-1') === true)
  check('The former breeder (tenantId matches, but currentOwnerId has moved on) does NOT have write access', hasDogWriteAccess(currentOwnerDog, 'breeder-1') === false)
  check('An unrelated stranger does NOT have write access', hasDogWriteAccess(currentOwnerDog, 'stranger-1') === false)

  const legacyDog = { tenantId: 'legacy-breeder-1', status: 'active' } // no currentOwnerId field at all
  check('A legacy dog with no currentOwnerId field falls back to tenantId for write access', hasDogWriteAccess(legacyDog, 'legacy-breeder-1') === true)
  check('The legacy fallback still denies anyone whose uid does not match tenantId', hasDogWriteAccess(legacyDog, 'someone-else') === false)

  check('hasDogWriteAccess is false for a null/undefined dog (dog not found)', hasDogWriteAccess(null, 'owner-1') === false)
  check('hasDogWriteAccess is false for a missing uid', hasDogWriteAccess(currentOwnerDog, undefined) === false)

  const restrictedOwnedDog = { tenantId: 'breeder-1', currentOwnerId: 'owner-1', status: 'restricted' }
  check('canAddDogRecord denies the current owner on a RESTRICTED dog (§3.3 — no new records)', canAddDogRecord(restrictedOwnedDog, 'owner-1') === false)
  check('canAddDogRecord allows the current owner on a non-restricted (active) dog', canAddDogRecord(currentOwnerDog, 'owner-1') === true)
  check('canAddDogRecord still denies the former breeder even on a non-restricted dog', canAddDogRecord(currentOwnerDog, 'breeder-1') === false)

  const noStatusDog = { tenantId: 'breeder-1', currentOwnerId: 'owner-1' } // status field genuinely absent
  check('canAddDogRecord defaults a missing status field to "active" (allowed), matching firestore.rules\' dog.get(\'status\',\'active\')', canAddDogRecord(noStatusDog, 'owner-1') === true)
}

// =========================================================================
// SECTION 2 — real handlers, live emulator: rejection paths (no Storage
// emulator needed — the 403 decision happens before any Storage call)
// =========================================================================
const R = Date.now()
async function newUser(name) {
  const { user } = await createUserWithEmailAndPassword(clientAuth, `${name}.${R}@emulator.local`, 'tam12345*')
  const idToken = await user.getIdToken()
  return { uid: user.uid, idToken }
}
function mockReq({ token, body = {}, method = 'POST', query = {} } = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body, query }
}
function mockRes() {
  const res = { statusCode: 200, body: null }
  res.status = c => { res.statusCode = c; return res }
  res.json = p => { res.body = p; return res }
  return res
}
async function seedDog(id, data) {
  await seedDb.collection('dogs').doc(id).set(data)
}

const breeder = await newUser('h8breeder')
const buyer = await newUser('h8buyer')
const stranger = await newUser('h8stranger')

// A dog that has been transferred: tenantId still the breeder, but
// currentOwnerId has moved to the buyer — the exact scenario this fix
// targets.
const transferredDogId = `transferred_${R}`
await seedDog(transferredDogId, {
  tenantId: breeder.uid, currentOwnerId: buyer.uid, createdByUserId: breeder.uid,
  sourceType: 'BREEDER_ISSUED', name: 'Transferred', sex: 'male', status: 'active', dateOfBirth: '2020-01-01',
})

const restrictedDogId = `restricted_${R}`
await seedDog(restrictedDogId, {
  tenantId: buyer.uid, currentOwnerId: buyer.uid, createdByUserId: buyer.uid,
  sourceType: 'OWNER_CREATED', name: 'Restricted', sex: 'female', status: 'restricted', dateOfBirth: '2020-01-01',
})

const fakeBase64 = Buffer.from('not a real file, just needs to be non-empty').toString('base64')

// ── upload-document.js ──
await checkAsync('upload-document.js: current (effective) owner clears the authorization gate (never 403)', async () => {
  const req = mockReq({ token: buyer.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: transferredDogId, documentType: 'other' } })
  const res = mockRes()
  await uploadDocumentHandler(req, res)
  return res.statusCode !== 403
})
await checkAsync('upload-document.js: the FORMER breeder (tenantId matches, no longer currentOwnerId) is denied (403)', async () => {
  const req = mockReq({ token: breeder.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: transferredDogId, documentType: 'other' } })
  const res = mockRes()
  await uploadDocumentHandler(req, res)
  return res.statusCode === 403
})
await checkAsync('upload-document.js: an unrelated stranger is denied (403)', async () => {
  const req = mockReq({ token: stranger.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: transferredDogId, documentType: 'other' } })
  const res = mockRes()
  await uploadDocumentHandler(req, res)
  return res.statusCode === 403
})
await checkAsync('upload-document.js: a RESTRICTED dog denies even its current owner (403, no new documents)', async () => {
  const req = mockReq({ token: buyer.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: restrictedDogId, documentType: 'other' } })
  const res = mockRes()
  await uploadDocumentHandler(req, res)
  return res.statusCode === 403
})
await checkAsync('upload-document.js: cross-tenant IDOR (guessing a dogId belonging to a totally different account) is denied (403)', async () => {
  const otherTenantDogId = `other_tenant_${R}`
  await seedDog(otherTenantDogId, { tenantId: 'someone-elses-account', currentOwnerId: 'someone-elses-account', status: 'active', name: 'Other', sex: 'male', dateOfBirth: '2020-01-01' })
  const req = mockReq({ token: stranger.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: otherTenantDogId, documentType: 'other' } })
  const res = mockRes()
  await uploadDocumentHandler(req, res)
  return res.statusCode === 403
})

// ── upload.js — profile photo branch ──
await checkAsync('upload.js (profile): current owner clears the authorization gate (never 403)', async () => {
  const req = mockReq({ token: buyer.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: transferredDogId }, query: {} })
  const res = mockRes()
  await uploadHandler(req, res)
  return res.statusCode !== 403
})
await checkAsync('upload.js (profile): the FORMER breeder is denied (403)', async () => {
  const req = mockReq({ token: breeder.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: transferredDogId }, query: {} })
  const res = mockRes()
  await uploadHandler(req, res)
  return res.statusCode === 403
})
await checkAsync('upload.js (profile): a RESTRICTED dog denies even its current owner (403)', async () => {
  const req = mockReq({ token: buyer.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: restrictedDogId }, query: {} })
  const res = mockRes()
  await uploadHandler(req, res)
  return res.statusCode === 403
})

// ── upload.js — note-photo branch (?type=note) ──
await checkAsync('upload.js (note): the FORMER breeder is denied (403) — cannot stage a note photo for a dog they no longer own', async () => {
  const req = mockReq({ token: breeder.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: transferredDogId }, query: { type: 'note' } })
  const res = mockRes()
  await uploadHandler(req, res)
  return res.statusCode === 403
})
await checkAsync('upload.js (note): an unrelated stranger is denied (403)', async () => {
  const req = mockReq({ token: stranger.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: transferredDogId }, query: { type: 'note' } })
  const res = mockRes()
  await uploadHandler(req, res)
  return res.statusCode === 403
})
await checkAsync('upload.js (note): a RESTRICTED dog denies even its current owner (403)', async () => {
  const req = mockReq({ token: buyer.idToken, body: { base64: fakeBase64, mediaType: 'image/jpeg', dogId: restrictedDogId }, query: { type: 'note' } })
  const res = mockRes()
  await uploadHandler(req, res)
  return res.statusCode === 403
})

skip(
  'upload-document.js / upload.js: full write-succeeds (200) path for the current owner',
  'requires a working Firebase Storage backend — this repo\'s firebase.json does not configure a Storage emulator. "Current owner is allowed" is proven above both via the pure canAddDogRecord() unit tests and via the real handler clearing the 403 gate (reaching the Storage call, which then fails only because no real bucket exists in this test environment).'
)

await summary()
