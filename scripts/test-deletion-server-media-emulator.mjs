import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import sharp from 'sharp'
import { uploadAccountMedia, reorderAccountMedia, MEDIA_OPERATIONS } from '../api/_lib/account-media-writes.js'
import { createPendingGrant, closePendingGrant } from '../api/_lib/direct-upload-grants.js'
import { buildDeletionInventory } from '../api/_lib/account-deletion-inventory.js'

const projectId = 'demo-idogs-account-deletion', bucketName = `${projectId}.firebasestorage.app`
for (const [key, expected] of [['FIRESTORE_EMULATOR_HOST', '8080'], ['FIREBASE_AUTH_EMULATOR_HOST', '9099'], ['FIREBASE_STORAGE_EMULATOR_HOST', '9199']]) {
  if (process.env.GCLOUD_PROJECT !== projectId || !new RegExp(`^(127\\.0\\.0\\.1|localhost):${expected}$`).test(process.env[key] || '')) throw new Error('emulator_only')
}
process.env.FIREBASE_PROJECT_ID = projectId
process.env.FIREBASE_STORAGE_BUCKET = bucketName
let app, db, bucket, jpeg, n = 0
const handlers = {}
before(async () => {
  app = initializeApp({ projectId, storageBucket: bucketName })
  db = getFirestore(app); bucket = getStorage(app).bucket(bucketName)
  jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'blue' } }).jpeg().toBuffer()
  for (const route of ['create-dog', 'create-litter', 'update-litter', 'delete-litter', 'remove-litter-puppy', 'create-litter-puppy',
    'save-heat-cycle', 'set-dog-status', 'reconcile-dog-cap', 'reconcile-litter-puppy', 'transfer-dog', 'claim-transferred-dogs',
    'manage-private-dog-access', 'create-showcase', 'set-showcase-enabled', 'update-showcase-puppy', 'bulk-update-showcase-puppies',
    'rotate-showcase-share', 'update-showcase-share', 'upload-document', 'upload', 'upload-showcase-media', 'update-showcase-media', 'confirm-showcase-media-upload', 'get-dog-history']) {
    handlers[route] = (await import(`../api/${route}.js`)).default
  }
})
after(async () => { await db?.terminate(); if (app) await deleteApp(app) })
async function fixture() {
  const signUp = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `qa-server-media-${++n}@example.invalid`, password: 'Synthetic-only-123!', returnSecureToken: true }),
  })
  const auth = await signUp.json(); assert.ok(auth.idToken, JSON.stringify(auth))
  const uid = auth.localId, dogId = `qa-server-media-${n}`
  const dog = { currentOwnerId: uid, tenantId: 'old-breeder', status: 'active', name: 'Synthetic', breed: 'Labrador Retriever', sex: 'female', dateOfBirth: '2023-01-01' }
  await db.doc(`dogs/${dogId}`).set(dog)
  await db.doc(`users/${uid}`).set({ role: 'breeder', plan: 'plus', email: `qa-server-media-${n}@example.invalid` })
  return { uid, dogId, dog, token: auth.idToken, freeze: () => db.doc(`accountDeletionFences/${uid}`).set({ state: 'frozen', revision: 1 }),
    open: () => db.doc(`accountDeletionFences/${uid}`).set({ state: 'open' }) }
}
async function call(route, f, body, query = {}) {
  const res = { code: 200, status(code) { this.code = code; return this }, json(body) { this.body = body; return this }, setHeader() {} }
  await handlers[route]({ method: 'POST', headers: { authorization: `Bearer ${f.token}` }, body, query }, res)
  return res
}
const frozenCases = [
  ['create-dog', f => ({ data: { name: 'Synthetic', breed: 'Labrador Retriever', sex: 'female', dateOfBirth: '2023-01-01' } })],
  ['create-litter', f => ({ damId: f.dogId })], ['update-litter', () => ({ litterId: 'qa-litter', patch: {} })],
  ['delete-litter', () => ({ litterId: 'qa-litter' })], ['remove-litter-puppy', f => ({ litterId: 'qa-litter', puppyId: f.dogId })],
  ['create-litter-puppy', f => ({ operationId: 'qa-op', litterId: 'qa-litter', dogId: f.dogId, payload: { name: 'Synthetic', sex: 'female', dateOfBirth: '2026-01-01' } })],
  ['save-heat-cycle', f => ({ dogId: f.dogId, cycle: { heatStartDate: '2026-10-01' } })],
  ['set-dog-status', f => ({ dogId: f.dogId, action: 'archive' })], ['reconcile-dog-cap', () => ({})],
  ['reconcile-litter-puppy', f => ({ dogId: f.dogId })],
  ['transfer-dog', f => ({ dogId: f.dogId, buyerName: 'Synthetic', buyerEmail: 'qa-buyer@example.invalid' })],
  ['claim-transferred-dogs', () => ({ action: 'claim' })],
  ['manage-private-dog-access', f => ({ dogId: f.dogId, action: 'revoke' })],
  ['create-showcase', () => ({ litterId: 'qa-litter' })], ['set-showcase-enabled', () => ({ litterId: 'qa-litter', enabled: true })],
  ['update-showcase-puppy', f => ({ litterId: 'qa-litter', puppyId: f.dogId, visible: true })],
  ['bulk-update-showcase-puppies', () => ({ litterId: 'qa-litter', action: 'clear_all' })],
  ['rotate-showcase-share', () => ({ litterId: 'qa-litter' })], ['update-showcase-share', () => ({ litterId: 'qa-litter', shareEnabled: false })],
  ['upload-document', f => ({ dogId: f.dogId, base64: Buffer.from('%PDF-1.4 Synthetic').toString('base64'), mediaType: 'application/pdf', documentType: 'other' })],
  ['upload', f => ({ dogId: f.dogId, base64: jpeg.toString('base64') })],
  ['upload-showcase-media', f => ({ dogId: f.dogId, base64: jpeg.toString('base64'), kind: 'photo' })],
  ['update-showcase-media', f => ({ dogId: f.dogId, kind: 'photo', order: [] })],
]
for (const [route, body] of frozenCases) test(`${route}: actual handler and emulator token reject a frozen actor without data mutation`, async () => {
  const f = await fixture(); await f.freeze()
  const before = (await db.doc(`dogs/${f.dogId}`).get()).data()
  const result = await call(route, f, body(f))
  assert.equal(result.code, 409, JSON.stringify(result.body))
  assert.equal(result.body.reason, 'ACCOUNT_WRITES_FROZEN')
  assert.deepEqual((await db.doc(`dogs/${f.dogId}`).get()).data(), before)
  assert.equal((await db.collection(MEDIA_OPERATIONS).where('uid', '==', f.uid).get()).size, 0)
})
test('healthy dog creation and status mutation succeed before the same token is fenced', async () => {
  const f = await fixture(), created = await call('create-dog', f, frozenCases[0][1](f))
  assert.equal(created.code, 200, JSON.stringify(created.body))
  assert.equal((await call('set-dog-status', f, { dogId: f.dogId, action: 'archive' })).code, 200)
  await f.freeze()
  assert.equal((await call('set-dog-status', f, { dogId: f.dogId, action: 'restore' })).code, 409)
  assert.equal((await db.doc(`dogs/${f.dogId}`).get()).data().status, 'archived')
})
test('claim checks the existing owner fence, never just the incoming buyer', async () => {
  const seller = await fixture(), buyer = await fixture()
  const email = (await getAuth(app).getUser(buyer.uid)).email
  assert.equal((await call('transfer-dog', seller, { dogId: seller.dogId, buyerName: 'Synthetic buyer', buyerEmail: email })).code, 200)
  await seller.freeze()
  assert.equal((await call('claim-transferred-dogs', buyer, { action: 'claim' })).code, 409)
  assert.equal((await db.doc(`dogs/${seller.dogId}`).get()).data().currentOwnerId, seller.uid)
  await seller.open()
  assert.equal((await call('claim-transferred-dogs', buyer, { action: 'claim' })).code, 200)
  await seller.freeze()
  assert.equal((await call('set-dog-status', buyer, { dogId: seller.dogId, action: 'archive' })).code, 200)
  await db.doc(`dogs/${seller.dogId}`).update({ name: 'PRIVATE_NEW_OWNER' })
  const historical = await call('get-dog-history', seller, { action: 'detail', dogId: seller.dogId })
  assert.equal(historical.code, 200, JSON.stringify(historical.body))
  assert.doesNotMatch(JSON.stringify(historical.body), /PRIVATE_NEW_OWNER/)
  assert.equal((await call('get-dog-history', buyer, { action: 'detail', dogId: seller.dogId })).code, 404)
})
test('direct grant issuance is frozen before quota/grant writes; pre-freeze grant remains visible on a frozen confirm', async () => {
  const f = await fixture(), mediaId = `qa-grant-${f.dogId}`
  const grant = { uid: f.uid, dogId: f.dogId, status: 'pending', kind: 'photo', quotaReserved: true,
    path: `dogs/${f.uid}/${f.dogId}/photos/direct.jpg`, expiresAt: new Date(Date.now() + 600000).toISOString() }
  await f.freeze()
  await assert.rejects(createPendingGrant(db, mediaId, grant), error => error.code === 'account_writes_frozen')
  assert.equal((await db.doc(`mediaUploadGrants/${mediaId}`).get()).exists, false)
  await f.open(); assert.equal((await createPendingGrant(db, mediaId, grant)).created, true)
  await f.freeze()
  assert.equal((await call('confirm-showcase-media-upload', f, { mediaId })).code, 409)
  assert.equal((await db.doc(`mediaUploadGrants/${mediaId}`).get()).data().status, 'pending')
})
test('direct confirmation rechecks a fence that changes after its initial preflight', async () => {
  const f = await fixture(), mediaId = `qa-late-grant-${f.dogId}`, path = `dogs/${f.uid}/${f.dogId}/photos/direct.jpg`
  await bucket.file(path).save(jpeg, { metadata: { contentType: 'image/jpeg' } })
  await createPendingGrant(db, mediaId, { uid: f.uid, dogId: f.dogId, status: 'pending', kind: 'photo', path,
    expiresAt: new Date(Date.now() + 600000).toISOString() })
  const original = db.runTransaction.bind(db); let transactions = 0
  db.runTransaction = async (...args) => {
    const result = await original(...args)
    if (++transactions === 1) await f.freeze()
    return result
  }
  try {
    const result = await call('confirm-showcase-media-upload', f, { mediaId })
    assert.equal(result.code, 409, JSON.stringify(result.body))
    assert.equal(result.body.reason, 'ACCOUNT_WRITES_FROZEN')
  } finally { db.runTransaction = original }
  assert.equal((await db.doc(`mediaUploadGrants/${mediaId}`).get()).data().status, 'pending')
  assert.equal((await bucket.file(path).exists())[0], true)
  assert.equal((await db.doc(`dogs/${f.dogId}`).get()).data().photos, undefined)
})
function args(f, extra = {}) {
  return { db, bucket, uid: f.uid, dogId: f.dogId, kind: 'document', path: `documents/${f.uid}/${f.dogId}/unique.pdf`,
    buffer: Buffer.from('%PDF-1.4 Synthetic'), contentType: 'application/pdf', ...extra }
}
async function operations(f) { return (await db.collection(MEDIA_OPERATIONS).where('uid', '==', f.uid).get()).docs.map(d => d.data()) }
test('real Storage upload records generation and commits its document with the operation', async () => {
  const f = await fixture(), ref = db.doc(`documents/${f.dogId}`)
  const result = await uploadAccountMedia(args(f, { commit: (tx, dog, generation) => tx.create(ref, { dogId: f.dogId, generation }) }))
  assert.match(result.generation, /^[1-9][0-9]*$/)
  assert.equal((await operations(f))[0].state, 'committed')
  assert.equal((await ref.get()).data().generation, result.generation)
  assert.equal((await bucket.file(result.path).exists())[0], true)
})
test('actual document, profile and note upload handlers retain their response contract', async () => {
  const f = await fixture()
  const document = await call('upload-document', f, frozenCases.find(x => x[0] === 'upload-document')[1](f))
  assert.equal(document.code, 200, JSON.stringify(document.body)); assert.ok(document.body.documentId)
  const profile = await call('upload', f, { dogId: f.dogId, base64: jpeg.toString('base64') })
  assert.equal(profile.code, 200, JSON.stringify(profile.body)); assert.ok(profile.body.fileUrl)
  const note = await call('upload', f, { dogId: f.dogId, base64: jpeg.toString('base64') }, { type: 'note' })
  assert.equal(note.code, 200, JSON.stringify(note.body))
  assert.equal((await db.doc(`dogs/${f.dogId}`).get()).data().profilePhoto, profile.body.fileUrl)
  assert.notEqual(note.body.fileUrl, profile.body.fileUrl)
  const oldProfile = (await db.doc(`dogs/${f.dogId}`).get()).data()
  const replacement = await call('upload', f, { dogId: f.dogId, base64: jpeg.toString('base64') })
  assert.equal(replacement.code, 200, JSON.stringify(replacement.body))
  const queued = await db.collection('mediaCleanupTasks').where('uid', '==', f.uid).get()
  assert.equal(queued.size, 1)
  assert.equal(queued.docs[0].data().generation, oldProfile.profilePhotoGeneration)
  assert.equal((await bucket.file(oldProfile.profilePhotoPath).exists())[0], true)
})
test('freeze during Storage upload prevents the reference commit and retains the file for reviewed cleanup', async () => {
  const f = await fixture(), ref = db.doc(`documents/${f.dogId}`)
  const injected = { name: bucket.name, file(path, options) {
    const file = bucket.file(path, options)
    if (!options) {
      const save = file.save.bind(file)
      file.save = async (...params) => { await save(...params); await f.freeze() }
    }
    return file
  } }
  await assert.rejects(uploadAccountMedia(args(f, { bucket: injected, commit: (tx, dog, generation) => tx.create(ref, { dogId: f.dogId, generation }) })), error => error.code === 'account_writes_frozen')
  assert.equal((await ref.get()).exists, false)
  assert.equal((await operations(f))[0].state, 'cleanup_required')
  assert.equal((await bucket.file(args(f).path).exists())[0], true)
})
test('ownership transfer during Storage upload prevents linking into the new owner data', async () => {
  const f = await fixture(), ref = db.doc(`documents/${f.dogId}`)
  const injected = { name: bucket.name, file(path, options) {
    const file = bucket.file(path, options)
    if (!options) { const save = file.save.bind(file); file.save = async (...p) => { await save(...p); await db.doc(`dogs/${f.dogId}`).update({ currentOwnerId: 'qa-new-owner' }) } }
    return file
  } }
  await assert.rejects(uploadAccountMedia(args(f, { bucket: injected, commit: tx => tx.create(ref, { dogId: f.dogId }) })), error => error.status === 403)
  assert.equal((await ref.get()).exists, false)
  assert.equal((await operations(f))[0].state, 'cleanup_required')
})
test('ambiguous upload response leaves a durable cleanup obligation and inventory hold', async () => {
  const f = await fixture()
  const injected = { name: bucket.name, file(path) { const file = bucket.file(path); const save = file.save.bind(file)
    file.save = async (...p) => { await save(...p); throw new Error('synthetic_lost_storage_response') }; return file } }
  await assert.rejects(uploadAccountMedia(args(f, { bucket: injected })), /synthetic_lost_storage_response/)
  assert.equal((await operations(f))[0].state, 'cleanup_required')
  assert.equal((await bucket.file(args(f).path).exists())[0], true)
  const inventory = await buildDeletionInventory({ db, uid: f.uid })
  assert.ok(inventory.holds.includes('media_operations_unsettled')); assert.equal(inventory.readyForDeletion, false)
})
test('a lost final Firestore commit response does not delete a successfully referenced object', async () => {
  const f = await fixture(), ref = db.doc(`documents/${f.dogId}`)
  const original = db.runTransaction.bind(db); let transactions = 0
  db.runTransaction = async (...args) => {
    const result = await original(...args)
    if (++transactions === 2) throw new Error('synthetic_lost_commit_response')
    return result
  }
  try {
    await assert.rejects(uploadAccountMedia(args(f, { commit: tx => tx.create(ref, { dogId: f.dogId }) })), /synthetic_lost_commit_response/)
  } finally { db.runTransaction = original }
  assert.equal((await ref.get()).exists, true)
  assert.equal((await operations(f))[0].state, 'committed')
  assert.equal((await bucket.file(args(f).path).exists())[0], true)
})
test('failed cleanup never deletes a replacement generation or claims cleanup succeeded', async () => {
  const f = await fixture(), savedPath = args(f).path
  const injected = { name: bucket.name, file(path, options) {
    const file = bucket.file(path, options)
    if (!options) { const read = file.getMetadata.bind(file); file.getMetadata = async () => {
      const metadata = await read(); await file.save(Buffer.from('REPLACEMENT')); await f.freeze(); return metadata
    } }
    return file
  } }
  await assert.rejects(uploadAccountMedia(args(f, { bucket: injected })), error => error.code === 'account_writes_frozen')
  assert.equal((await operations(f))[0].state, 'cleanup_required')
  assert.equal((await bucket.file(savedPath).download())[0].toString(), 'REPLACEMENT')
})
test('reorder validates current media in the same transaction and frozen changes leave the list intact', async () => {
  const f = await fixture(), photos = [{ id: 'one', path: 'one' }, { id: 'two', path: 'two' }]
  await db.doc(`dogs/${f.dogId}`).update({ photos })
  await reorderAccountMedia({ db, uid: f.uid, dogId: f.dogId, arrayField: 'photos', order: ['two', 'one'] })
  await f.freeze()
  assert.equal((await call('update-showcase-media', f, { dogId: f.dogId, kind: 'photo', order: [] })).code, 409)
  assert.deepEqual((await db.doc(`dogs/${f.dogId}`).get()).data().photos.map(p => p.id), ['two', 'one'])
})
test('a rejected signed grant still blocks deletion until the signed PUT window ends', async () => {
  const f = await fixture()
  await db.doc(`mediaUploadGrants/${f.dogId}`).set({ uid: f.uid, dogId: f.dogId, status: 'rejected', expiresAt: new Date(Date.now() + 600000).toISOString(), path: 'synthetic' })
  assert.ok((await buildDeletionInventory({ db, uid: f.uid })).holds.includes('signed_upload_window_open'))
})


test('full upload quota reclaims only expired own-dog slots, retaining Storage bytes and cleanup obligations', async () => {
  const f = await fixture(), other = await fixture()
  const future = new Date(Date.now() + 600000).toISOString()
  const past = new Date(Date.now() - 60000).toISOString()
  const grant = suffix => ({ uid: f.uid, dogId: f.dogId, kind: 'photo', status: 'pending', quotaReserved: true,
    path: `dogs/${f.uid}/${f.dogId}/${suffix}.jpg`, expiresAt: future })
  for (let i = 0; i < 3; i++) assert.equal((await createPendingGrant(db, `${f.dogId}-${i}`, grant(i))).created, true)
  await db.doc(`mediaUploadGrants/${f.dogId}-0`).update({ expiresAt: past })
  await bucket.file(grant(0).path).save(jpeg)
  await db.doc(`mediaUploadGrants/${other.dogId}-foreign`).set({ ...grant('foreign'), uid: other.uid, expiresAt: past })
  await db.doc(`mediaUploadGrants/${f.dogId}-invalid`).set({ ...grant('invalid'), expiresAt: 'invalid' })
  await f.freeze()
  await assert.rejects(createPendingGrant(db, `${f.dogId}-frozen`, grant('frozen')), e => e.code === 'account_writes_frozen')
  assert.equal((await db.doc(`mediaUploadGrants/${f.dogId}-0`).get()).data().status, 'pending')
  await f.open()
  const outcomes = await Promise.all(['a', 'b'].map(i => createPendingGrant(db, `${f.dogId}-${i}`, grant(i))))
  assert.equal(outcomes.filter(x => x.created).length, 1)
  assert.equal((await db.doc(`mediaUploadGrants/${f.dogId}-0`).get()).data().status, 'expired')
  assert.equal((await db.doc(`mediaUploadGrants/${other.dogId}-foreign`).get()).data().status, 'pending')
  assert.equal((await db.doc(`mediaUploadGrants/${f.dogId}-invalid`).get()).data().status, 'pending')
  assert.equal((await bucket.file(grant(0).path).exists())[0], true)
  assert.equal(await closePendingGrant(db, db.doc(`mediaUploadGrants/${f.dogId}-0`), 'expired'), false)
  const quotas = await db.collection('mediaUploadQuotas').where('uid', '==', f.uid).get()
  assert.equal(quotas.size, 2)
  for (const q of quotas.docs) assert.equal(q.data().pendingCount, 3)
})
