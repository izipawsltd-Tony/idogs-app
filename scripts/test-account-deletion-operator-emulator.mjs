import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { makeAccountDeletionsHandler } from '../api/super-admin/account-deletions.js'
import { processDeletion } from '../api/_lib/account-deletion-operator.js'
import { changeDeletionRequest } from '../api/_lib/account-deletion.js'

// Full operator flow against the Auth + Firestore emulators. Storage, Stripe
// and email are recording fakes; nothing reaches a real service.
const PROJECT = 'demo-idogs-account-deletion'
for (const [name, port] of [['FIRESTORE_EMULATOR_HOST', 8080], ['FIREBASE_AUTH_EMULATOR_HOST', 9099]]) {
  if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${port}$`).test(process.env[name] || '')) throw new Error(`${name} must identify the loopback emulator`)
}
if (process.env.GCLOUD_PROJECT !== PROJECT) throw new Error('Refusing non-demo project')

let app, db, auth, server, origin, owner, other
const files = new Map(), emails = [], stripeCalls = []
let stripeFails = false, emailFails = false, storageFailsOnce = false
const bucket = {
  async getFiles({ prefix }) { if (storageFailsOnce) { storageFailsOnce = false; throw new Error('storage outage') } return [[...files.keys()].filter(k => k.startsWith(prefix)).map(k => ({ delete: async () => files.delete(k) }))] },
  file: k => ({ exists: async () => [files.has(k)], delete: async () => files.delete(k) }),
}
const subs = { sub_plus: 'active', sub_old: 'canceled' }
const stripe = { subscriptions: {
  list: async () => { if (stripeFails) throw new Error('down'); return { data: Object.entries(subs).map(([id, status]) => ({ id, status })) } },
  retrieve: async id => ({ id, status: subs[id] }),
  cancel: async id => { stripeCalls.push(id); subs[id] = 'canceled' },
} }
const sendEmail = async m => { if (emailFails) throw new Error('down'); emails.push(m) }

async function signup(name) {
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${name}@example.invalid`, password: 'Synthetic-emulator-only-123!', returnSecureToken: true }) })
  return r.json()
}
async function admin(method, body, query = '') {
  const r = await fetch(`${origin}/api/super-admin/account-deletions${query}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: await r.json() }
}
const req = () => db.collection('accountDeletionRequests').doc(owner.localId)

before(async () => {
  app = initializeApp({ projectId: PROJECT }); db = getFirestore(app); auth = getAuth(app)
  owner = await signup('operator-owner'); other = await signup('operator-other')
  const handler = makeAccountDeletionsHandler({ db, auth, bucket: () => bucket, stripe: () => stripe, sendEmail,
    verify: async (rq, rs) => rq.headers['x-test-admin'] === 'no' ? (rs.status(403).json({ error: 'Forbidden' }), null) : { email: 'operator@example.invalid' } })
  server = createServer(async (rq, rs) => {
    rs.status = c => { rs.statusCode = c; return rs }
    rs.json = b => { rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify(b)); return rs }
    let t = ''; for await (const c of rq) t += c
    rq.body = t ? JSON.parse(t) : undefined
    rq.query = Object.fromEntries(new URL(rq.url, 'http://x').searchParams)
    await handler(rq, rs)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${server.address().port}`

  const u = owner.localId
  await db.collection('users').doc(u).set({ email: 'operator-owner@example.invalid', firstName: 'Test', lastName: 'Owner', stripeCustomerId: 'cus_test', stripeSubscriptionId: 'sub_plus' })
  await db.collection('users').doc(other.localId).set({ email: 'operator-other@example.invalid' })
  await db.collection('dogs').doc('own-dog').set({ tenantId: u, currentOwnerId: u, name: 'Synthetic', status: 'active', profilePhotoPath: `dogs/${u}/own-dog/profile.jpg` })
  await db.collection('dogs').doc('own-dog').collection('weights').doc('w1').set({ kg: 10 })
  await db.collection('dogs').doc('sold-dog').set({ tenantId: other.localId, currentOwnerId: other.localId, originBreederId: u, status: 'active', name: 'Sold' })
  await db.collection('vaccineRecords').doc('v-own').set({ dogId: 'own-dog', tenantId: u })
  await db.collection('vaccineRecords').doc('v-sold').set({ dogId: 'sold-dog', tenantId: other.localId })
  await db.collection('documents').doc('d-own').set({ dogId: 'own-dog', tenantId: u, filePath: `documents/${u}/own-dog/cert.pdf` })
  await db.collection('plusPromotionCheckouts').doc(u).set({ sessionId: 'cs_test' })
  for (const k of [`documents/${u}/own-dog/cert.pdf`, `dogs/${u}/own-dog/profile.jpg`, `dogs/${u}/own-dog/notes/n.jpg`, `dogs/${u}/sold-dog/profile.jpg`, `documents/${other.localId}/x/y.pdf`]) files.set(k, 1)
  await changeDeletionRequest({ db, token: { uid: u, email: 'operator-owner@example.invalid', auth_time: Date.now() / 1000 }, body: { action: 'request', confirmation: 'DELETE MY ACCOUNT' } })
})
after(async () => { server?.closeAllConnections(); if (server) await new Promise(r => server.close(r)); if (app) await deleteApp(app) })

test('non-admin is refused', async () => {
  const r = await fetch(`${origin}/api/super-admin/account-deletions`, { headers: { 'x-test-admin': 'no' } })
  assert.equal(r.status, 403)
})
test('mark_completed is refused before processing', async () => {
  const r = await admin('POST', { action: 'mark_completed', uid: owner.localId })
  assert.equal(r.status, 409); assert.match(r.body.error, /Cannot record completion/)
  assert.equal((await req().get()).data().status, 'requested')
})
test('preview is read-only and separates deleted from retained', async () => {
  const r = await admin('POST', { action: 'preview', uid: owner.localId })
  assert.equal(r.status, 200)
  const p = r.body.plan
  assert.deepEqual(p.blockers, [])
  for (const path of [`users/${owner.localId}`, 'dogs/own-dog', 'vaccineRecords/v-own', 'documents/d-own']) assert.ok(p.deletePaths.includes(path), path)
  for (const path of ['dogs/sold-dog', 'vaccineRecords/v-sold', `plusPromotionCheckouts/${owner.localId}`]) assert.ok(p.retained.some(x => x.path === path), path)
  assert.equal((await db.doc('dogs/own-dog').get()).exists, true)
})
test('process refuses without the typed confirmation', async () => {
  assert.equal((await admin('POST', { action: 'process', uid: owner.localId })).status, 400)
})
test('a Stripe failure stops before anything is deleted', async () => {
  stripeFails = true
  const r = await admin('POST', { action: 'process', uid: owner.localId, confirmation: `DELETE ${owner.localId}` })
  stripeFails = false
  assert.equal(r.status, 502)
  assert.equal((await req().get()).data().status, 'review_required')
  assert.equal((await db.doc(`users/${owner.localId}`).get()).exists, true)
  assert.equal((await auth.getUser(owner.localId)).disabled, false)
})
test('process cancels Stripe, deletes scoped data/files/sign-in, keeps other owners, emails once', async () => {
  emailFails = true
  const r = await admin('POST', { action: 'process', uid: owner.localId, confirmation: `DELETE ${owner.localId}` })
  assert.equal(r.status, 200)
  assert.deepEqual(stripeCalls, ['sub_plus'])
  for (const path of [`users/${owner.localId}`, 'dogs/own-dog', 'dogs/own-dog/weights/w1', 'vaccineRecords/v-own', 'documents/d-own']) assert.equal((await db.doc(path).get()).exists, false, path)
  for (const path of ['dogs/sold-dog', 'vaccineRecords/v-sold', `users/${other.localId}`, `plusPromotionCheckouts/${owner.localId}`]) assert.equal((await db.doc(path).get()).exists, true, path)
  assert.deepEqual([...files.keys()].sort(), [`documents/${other.localId}/x/y.pdf`, `dogs/${owner.localId}/sold-dog/profile.jpg`])
  await assert.rejects(auth.getUser(owner.localId), e => e.code === 'auth/user-not-found')
  assert.equal(r.body.evidence.email, 'failed')
  // Email failed: completion must still be refused, then a retry sends it.
  assert.equal((await admin('POST', { action: 'mark_completed', uid: owner.localId })).status, 409)
  emailFails = false
  const retry = await admin('POST', { action: 'process', uid: owner.localId, confirmation: `DELETE ${owner.localId}` })
  assert.equal(retry.body.evidence.email, 'sent')
  assert.equal(emails.length, 1)
  assert.equal(emails[0].to, 'operator-owner@example.invalid')
  assert.equal(emails[0].idempotencyKey, `account-deletion-v1/${owner.localId}`)
  assert.match(emails[0].text, /Hello Test Owner/)
  assert.deepEqual(stripeCalls, ['sub_plus'])
})
test('mark_completed records completion only after full evidence', async () => {
  const r = await admin('POST', { action: 'mark_completed', uid: owner.localId })
  assert.equal(r.status, 200); assert.equal(r.body.status, 'completed')
  const d = (await req().get()).data()
  assert.equal(d.status, 'completed'); assert.equal(d.completedBy, 'operator@example.invalid')
  assert.equal(d.evidence.auth, 'deleted'); assert.equal(d.evidence.stripe.cancelled[0], 'sub_plus')
  assert.equal((await admin('POST', { action: 'process', uid: owner.localId, confirmation: `DELETE ${owner.localId}` })).status, 409)
})
test('pending transfer blocks processing', async () => {
  const u = other.localId
  await db.collection('dogs').doc('pending-dog').set({ tenantId: u, currentOwnerId: u, status: 'transferred', transferStatus: 'pendingClaim', name: 'P' })
  await changeDeletionRequest({ db, token: { uid: u, email: 'operator-other@example.invalid', auth_time: Date.now() / 1000 }, body: { action: 'request', confirmation: 'DELETE MY ACCOUNT' } })
  const plan = (await admin('POST', { action: 'preview', uid: u })).body.plan
  assert.match(plan.blockers.join(' '), /pending transfer/)
  const r = await admin('POST', { action: 'process', uid: u, confirmation: `DELETE ${u}` })
  assert.equal(r.status, 409)
  assert.equal((await db.doc(`users/${u}`).get()).exists, true)
})

test('Storage failure after data removal: retry still removes the original files before email/completion', async () => {
  const t = await signup('operator-retry')
  const u = t.localId
  await db.collection('users').doc(u).set({ email: 'operator-retry@example.invalid', firstName: 'Retry' })
  await db.collection('dogs').doc('retry-dog').set({ tenantId: u, currentOwnerId: u, status: 'active', name: 'R' })
  await db.collection('documents').doc('retry-doc').set({ dogId: 'retry-dog', tenantId: u, filePath: `documents/${u}/retry-dog/cert.pdf` })
  files.set(`documents/${u}/retry-dog/cert.pdf`, 1); files.set(`dogs/${u}/retry-dog/profile.jpg`, 1)
  await changeDeletionRequest({ db, token: { uid: u, email: 'operator-retry@example.invalid', auth_time: Date.now() / 1000 }, body: { action: 'request', confirmation: 'DELETE MY ACCOUNT' } })
  const sentBefore = emails.length
  storageFailsOnce = true
  const first = await admin('POST', { action: 'process', uid: u, confirmation: `DELETE ${u}` })
  assert.equal(first.status, 500)
  // Records that pointed at the files are already gone; the files are not.
  assert.equal((await db.doc('dogs/retry-dog').get()).exists, false)
  assert.ok(files.has(`dogs/${u}/retry-dog/profile.jpg`))
  const mid = (await db.collection('accountDeletionRequests').doc(u).get()).data()
  assert.equal(mid.status, 'processing'); assert.equal(mid.lease, null)
  assert.ok(mid.targets.storagePrefixes.includes(`dogs/${u}/retry-dog/`))
  assert.equal((await admin('POST', { action: 'mark_completed', uid: u })).status, 409)
  assert.equal(emails.length, sentBefore)
  const retry = await admin('POST', { action: 'process', uid: u, confirmation: `DELETE ${u}` })
  assert.equal(retry.status, 200)
  assert.equal(retry.body.evidence.verification.passed, true)
  assert.equal(files.has(`dogs/${u}/retry-dog/profile.jpg`), false)
  assert.equal(files.has(`documents/${u}/retry-dog/cert.pdf`), false)
  assert.equal(emails.length, sentBefore + 1)
  assert.equal((await admin('POST', { action: 'mark_completed', uid: u })).status, 200)
})

test('overlapping runs: a second process call is refused while the first holds the lease', async () => {
  const t = await signup('operator-overlap')
  const u = t.localId
  await db.collection('users').doc(u).set({ email: 'operator-overlap@example.invalid' })
  await changeDeletionRequest({ db, token: { uid: u, email: 'operator-overlap@example.invalid', auth_time: Date.now() / 1000 }, body: { action: 'request', confirmation: 'DELETE MY ACCOUNT' } })
  await db.collection('accountDeletionRequests').doc(u).update({ lease: { runId: 'other-run', until: new Date(Date.now() + 600000).toISOString() } })
  const r = await admin('POST', { action: 'process', uid: u, confirmation: `DELETE ${u}` })
  assert.equal(r.status, 409); assert.match(r.body.error, /already being processed/)
  assert.equal((await db.doc(`users/${u}`).get()).exists, true)
  // Two real runs at once: exactly one proceeds.
  await db.collection('accountDeletionRequests').doc(u).update({ lease: null })
  const deps = { db, auth, bucket, stripe, sendEmail, uid: u, operator: 'operator@example.invalid' }
  const results = await Promise.allSettled([processDeletion({ ...deps, runId: 'a' }), processDeletion({ ...deps, runId: 'b' })])
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal(results.filter(x => x.status === 'rejected' && x.reason.status === 409).length, 1)
  const d = (await db.collection('accountDeletionRequests').doc(u).get()).data()
  assert.equal(d.status, 'processed'); assert.equal(d.evidence.verification.passed, true); assert.equal(d.lease, null)
})
