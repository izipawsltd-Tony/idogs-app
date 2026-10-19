import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { makeDeletionHandler } from '../api/account-deletion.js'
import { buildDeletionInventory } from '../api/_lib/account-deletion-inventory.js'

// No fallback to live Firebase, Google credentials, project or bucket.
const PROJECT = 'demo-idogs-account-deletion'
for (const [name, port] of [['FIRESTORE_EMULATOR_HOST', 8080], ['FIREBASE_AUTH_EMULATOR_HOST', 9099]]) {
  if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${port}$`).test(process.env[name] || '')) {
    throw new Error(`${name} must identify the expected loopback emulator`)
  }
}
if (process.env.GCLOUD_PROJECT !== PROJECT) throw new Error('Refusing non-demo project')

let app, db, auth, server, origin, rules, first, second
async function signup(name) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${name}@example.invalid`, password: 'Synthetic-emulator-only-123!', returnSecureToken: true }),
  })
  assert.equal(response.status, 200)
  return response.json()
}
async function call(identity, method = 'GET', body) {
  const response = await fetch(`${origin}/api/account-deletion`, {
    method, headers: { ...(identity ? { Authorization: `Bearer ${identity.idToken}` } : {}), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') }
}
const requestBody = { action: 'request', confirmation: 'DELETE MY ACCOUNT' }
const ref = () => db.collection('accountDeletionRequests').doc(first.localId)

before(async () => {
  app = initializeApp({ projectId: PROJECT })
  db = getFirestore(app); auth = getAuth(app)
  rules = await initializeTestEnvironment({ projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  })
  first = await signup('deletion-owner')
  second = await signup('other-owner')
  const handler = makeDeletionHandler({ db, authenticate: token => auth.verifyIdToken(token, true) })
  server = createServer(async (req, res) => {
    res.status = code => { res.statusCode = code; return res }
    res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res }
    try {
      let text = ''
      for await (const chunk of req) text += chunk
      req.body = text ? JSON.parse(text) : undefined
      await handler(req, res)
    } catch { res.status(500).json({ error: 'Fixture server failed' }) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  server?.closeAllConnections()
  if (server) await new Promise(resolve => server.close(resolve))
  await rules?.cleanup()
  if (app) await deleteApp(app)
})

test('HTTP request without identity is rejected before persistence', async () => {
  assert.equal((await call(null, 'POST', requestBody)).status, 401)
  assert.equal((await ref().get()).exists, false)
})
test('real Auth token and Firestore transactions persist exactly one request under concurrency', async () => {
  const responses = await Promise.all(Array.from({ length: 5 }, () => call(first, 'POST', requestBody)))
  for (const response of responses) {
    assert.equal(response.status, 200)
    assert.equal(response.body.status, 'requested')
    assert.equal(response.cache, 'private, no-store')
    assert.equal(response.body.uid, undefined)
  }
  const stored = (await ref().get()).data()
  assert.equal(stored.revision, 1)
  assert.equal(stored.uid, first.localId)
  assert.equal(stored.mode, 'as_soon_as_possible')
  assert.equal((await call(first)).body.requestedAt, stored.requestedAt)
  assert.equal((await db.collection('supportConversations').doc(stored.supportConversationId).get()).data().status, 'new')
  const messages = await db.collection('supportMessages').where('conversationId', '==', stored.supportConversationId).get()
  assert.equal(messages.size, 1)
})
test('another authenticated account cannot read or redirect the first account request', async () => {
  assert.equal((await call(second)).body.status, 'none')
  assert.equal((await call(second, 'POST', { ...requestBody, uid: first.localId })).status, 400)
  assert.equal((await db.collection('accountDeletionRequests').doc(second.localId).get()).exists, false)
  assert.equal((await ref().get()).data().revision, 1)
})
test('actual Firestore Rules deny direct request reads and forged status writes', async () => {
  for (const uid of [first.localId, second.localId]) {
    const client = rules.authenticatedContext(uid).firestore()
    await assertFails(getDoc(doc(client, 'accountDeletionRequests', first.localId)))
    await assertFails(setDoc(doc(client, 'accountDeletionRequests', uid), { status: 'completed' }))
  }
})
test('receiving and cancelling a request never removes owned or transferred dog records', async () => {
  const owned = db.collection('dogs').doc('synthetic-owned')
  const transferred = db.collection('dogs').doc('synthetic-transferred')
  await owned.set({ tenantId: first.localId, currentOwnerId: first.localId, name: 'Synthetic only' })
  await transferred.set({ tenantId: first.localId, currentOwnerId: second.localId, name: 'Synthetic only' })
  const cancel = await call(first, 'POST', { action: 'cancel' })
  assert.equal(cancel.status, 200)
  assert.equal(cancel.body.status, 'cancelled')
  assert.equal((await call(first, 'POST', { action: 'cancel' })).body.status, 'cancelled')
  assert.equal((await db.collection('supportConversations').doc(`account_deletion_${first.localId}`).get()).data().status, 'closed')
  assert.equal((await owned.get()).exists, true)
  assert.equal((await transferred.get()).data().currentOwnerId, second.localId)
})
test('processing state cannot be cancelled or reset through the public API', async () => {
  await ref().update({ status: 'processing' })
  assert.equal((await call(first, 'POST', { action: 'cancel' })).status, 409)
  const duplicate = await call(first, 'POST', requestBody)
  assert.equal(duplicate.body.status, 'processing')
  assert.equal(duplicate.body.canCancel, false)
  assert.equal((await ref().get()).data().status, 'processing')
})
test('read-only inventory discovers related records and preserves current-owner isolation in real Firestore', async () => {
  await db.collection('users').doc(first.localId).set({ email: 'deletion-owner@example.invalid' })
  const record = db.collection('documents').doc('synthetic-shared-document')
  await record.set({ dogId: 'synthetic-transferred', filePath: `documents/${first.localId}/synthetic-transferred/one.pdf`, notes: 'synthetic-private-content' })
  await db.collection('supportConversations').doc('synthetic-thread').set({ ownerUid: first.localId })
  await db.collection('supportMessages').doc('synthetic-reply').set({ conversationId: 'synthetic-thread', text: 'synthetic-private-message', senderUid: 'operator' })
  const before = (await record.get()).updateTime.toMillis()
  const report = await buildDeletionInventory({ db, uid: first.localId })
  assert.equal(report.records.find(r => r.path === record.path).disposition, 'preserve_other_owner')
  assert.ok(report.records.find(r => r.path === 'supportMessages/synthetic-reply'))
  assert.doesNotMatch(JSON.stringify(report), /synthetic-private-content|synthetic-private-message/)
  assert.equal((await record.get()).updateTime.toMillis(), before)
  assert.equal(report.readyForDeletion, false)
  assert.deepEqual(report.errors, [])
})
test('revoked identity token is rejected by real emulator Auth checks', async () => {
  // auth_time and tokensValidAfterTime have second precision.
  await new Promise(resolve => setTimeout(resolve, 1100))
  await auth.revokeRefreshTokens(first.localId)
  assert.equal((await call(first)).status, 401)
})
