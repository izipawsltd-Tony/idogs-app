import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import cloudHandler from '../api/account-recovery.js'
import { assertRecoveryQaRuntime, makeRecoveryQaService, makeRecoveryQaHandler, RECOVERY_COLLECTION } from '../api/_lib/account-recovery-qa.js'

assertRecoveryQaRuntime()
const projectId = 'demo-idogs-account-mobile'
let app, auth, db, rules, server, origin, userCount, baseline
let time = Date.now(), serial = 0
const messages = new Map(), phone = '+61400000101'
const secret = randomBytes(32).toString('hex')
const device = n => `synthetic-device-${n}`
const ip = n => `127.0.0.${n}`
let service
function context(n) { return { device: device(n), ip: ip(n) } }
async function start(number = phone, n = ++serial) { time += 60001; return { ...(await service.start({ phone: number, ...context(n) })), ...context(n) } }
function proof(receipt) { return { challenge: receipt.challenge, code: messages.get(receipt.challenge)?.code || '123456', device: receipt.device, ip: receipt.ip } }
async function rejected(promise) { await assert.rejects(promise, e => e.status === 400) }
async function post(body, path = '') {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') }
}
before(async () => {
  app = initializeApp({ projectId }, 'recovery-admin'); auth = getAuth(app); db = getFirestore(app)
  await auth.createUser({ uid: 'rec-main', email: 'recovery@example.invalid', emailVerified: true, phoneNumber: phone, password: 'Emulator-only-password-123!' })
  await auth.createUser({ uid: 'rec-incomplete', phoneNumber: '+61400000102' })
  await db.doc('users/rec-main').set({ name: 'Synthetic recovery', stripeCustomerId: 'cus_recovery_fixture', plan: 'plus' })
  baseline = (await db.doc('users/rec-main').get()).data()
  userCount = (await auth.listUsers()).users.length
  rules = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 9280, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } })
  service = makeRecoveryQaService({ auth, db, secret, now: () => time, sms: { fake: true, async send(message) { messages.set(message.challenge, message) } } })
  const handler = makeRecoveryQaHandler(service)
  server = createServer(async (req, res) => {
    res.status = status => { res.statusCode = status; return res }
    res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res }
    if (req.url === '/cloud') return cloudHandler(req, res)
    let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 2048) { res.status(413).json({ error: 'Request too large' }); return } }
    req.body = text
    await handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => { server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); if (rules) await rules.cleanup(); if (db) await db.terminate(); if (app) await deleteApp(app) })

test('rejects cloud projects, non-loopback emulators, real SMS transports and weak secrets', () => {
  assert.throws(() => assertRecoveryQaRuntime({ ...process.env, GCLOUD_PROJECT: 'idogs-app' }))
  assert.throws(() => assertRecoveryQaRuntime({ ...process.env, FIREBASE_AUTH_EMULATOR_HOST: 'remote.invalid:9299' }))
  assert.throws(() => makeRecoveryQaService({ auth, db, sms: { fake: false }, secret }))
  assert.throws(() => makeRecoveryQaService({ auth, db, sms: { fake: true }, secret: 'weak' }))
})
test('start discloses no email/UID/OTP; unknown phones get the same receipt and never create Auth users', async () => {
  const known = await start(), unknown = await start('+61400000999')
  const publicKeys = ['challenge', 'expiresIn', 'message', 'retryAfter']
  assert.deepEqual(Object.keys(known).filter(k => !['device', 'ip'].includes(k)).sort(), publicKeys)
  assert.equal(known.message, unknown.message); assert.equal(known.expiresIn, unknown.expiresIn)
  assert.equal(messages.has(unknown.challenge), false)
  const stored = (await db.collection(RECOVERY_COLLECTION).doc(known.challenge).get()).data()
  assert.notEqual(stored.mac, messages.get(known.challenge).code)
  assert.equal(stored.code, undefined); assert.equal(stored.email, undefined)
  await rejected(service.verify(proof(unknown)))
  assert.equal((await auth.listUsers()).users.length, userCount)
  await assert.rejects(auth.getUserByPhoneNumber('+61400000999'), e => e.code === 'auth/user-not-found')
})
test('reveals only the verified email after valid OTP, with no sign-in token or data/subscription changes', async () => {
  const receipt = await start(), result = await service.verify(proof(receipt))
  assert.deepEqual(result, { status: 'found', email: 'recovery@example.invalid' })
  assert.deepEqual((await db.doc('users/rec-main').get()).data(), baseline)
  assert.equal((await auth.listUsers()).users.length, userCount)
  await rejected(service.verify(proof(receipt)))
})
test('concurrent successful verifications can reveal email exactly once', async () => {
  const receipt = await start()
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => service.verify(proof(receipt))))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
})
test('five wrong codes commit their attempt counts and prevent even the correct code afterwards', async () => {
  const receipt = await start(), correct = proof(receipt), wrong = correct.code === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++) await rejected(service.verify({ ...correct, code: wrong }))
  const stored = (await db.collection(RECOVERY_COLLECTION).doc(receipt.challenge).get()).data()
  assert.equal(stored.attempts, 5); assert.equal(stored.consumed, true)
  await rejected(service.verify(correct))
})
test('expiry is enforced by code even before Firestore TTL housekeeping', async () => {
  // Move into a new day to reset the deliberately low per-phone send limit.
  time += 86400000
  const receipt = await start(); time += 300001
  await rejected(service.verify(proof(receipt)))
})
test('challenge cannot be used from another device', async () => {
  const receipt = await start()
  await rejected(service.verify({ ...proof(receipt), device: 'different-device-12345' }))
  assert.equal((await service.verify(proof(receipt))).status, 'found')
})
test('a changed phone or reassignment to another UID invalidates pending recovery', async () => {
  const receipt = await start()
  await auth.updateUser('rec-main', { phoneNumber: '+61400000103' })
  await auth.updateUser('rec-incomplete', { phoneNumber: phone })
  await rejected(service.verify(proof(receipt)))
  await auth.updateUser('rec-incomplete', { phoneNumber: '+61400000102' })
  await auth.updateUser('rec-main', { phoneNumber: phone })
})
test('disabled and deletion-requested accounts cannot disclose email', async () => {
  const disabled = await start(); await auth.updateUser('rec-main', { disabled: true })
  await rejected(service.verify(proof(disabled))); await auth.updateUser('rec-main', { disabled: false })
  time += 86400000
  const deleting = await start(); await db.doc('accountDeletionRequests/rec-main').set({ status: 'requested' })
  await rejected(service.verify(proof(deleting))); await db.doc('accountDeletionRequests/rec-main').delete()
})
test('incomplete phone accounts receive completion guidance without exposing an unverified email', async () => {
  await auth.updateUser('rec-incomplete', { email: 'unverified@example.invalid', emailVerified: false })
  const receipt = await start('+61400000102'), result = await service.verify(proof(receipt))
  assert.equal(result.status, 'incomplete'); assert.equal(result.email, undefined)
})
test('concurrent starts send only one code; delivery failure never retries or discloses email', async () => {
  time += 86400000
  const request = { phone, ...context(++serial) }, count = messages.size
  const receipts = await Promise.allSettled([service.start(request), service.start(request)])
  assert.equal(receipts.filter(r => r.status === 'fulfilled').length, 1); assert.equal(messages.size, count + 1)
  time += 60001; let calls = 0
  const failed = makeRecoveryQaService({ auth, db, secret, now: () => time, sms: { fake: true, async send() { calls++; throw new Error('Provider payload must not escape') } } })
  const receipt = await failed.start({ phone, ...context(++serial) })
  assert.equal(calls, 1); assert.equal(receipt.email, undefined)
  await rejected(failed.verify({ ...receipt, ...context(serial), code: '123456' }))
})
test('challenge and limit collections deny direct anonymous and signed-in client reads/writes', async () => {
  const receipt = await start()
  for (const client of [rules.unauthenticatedContext(), rules.authenticatedContext('rec-main')]) {
    const firestore = client.firestore()
    await assertFails(getDoc(doc(firestore, RECOVERY_COLLECTION, receipt.challenge)))
    await assertFails(setDoc(doc(firestore, RECOVERY_COLLECTION, receipt.challenge), { consumed: false }))
    await assertFails(getDoc(doc(firestore, 'accountRecoveryLimits', 'anything')))
    await assertFails(setDoc(doc(firestore, 'accountRecoveryLimits', 'anything'), { count: 0 }))
  }
})
test('HTTP responses use no-store and generic errors; the deployed cloud endpoint always fails closed', async () => {
  time += 86400000
  const started = await post({ action: 'start', phone, device: 'http-device-fixture-1' })
  assert.equal(started.status, 200); assert.equal(started.cache, 'private, no-store'); assert.equal(started.data.email, undefined)
  const result = await post({ action: 'verify', challenge: started.data.challenge, code: messages.get(started.data.challenge).code, device: 'http-device-fixture-1' })
  assert.equal(result.status, 200); assert.equal(result.data.email, 'recovery@example.invalid'); assert.equal(result.cache, 'private, no-store')
  assert.equal((await post('{')).status, 400)
  assert.equal((await post({ action: 'start', phone, device: 'http-device-fixture-1', ip: 'spoofed' })).status, 400)
  assert.equal((await post({}, '/cloud')).status, 503)
})
test('revoking account sessions after code issuance invalidates pending recovery', async () => {
  time += 86400000
  const receipt = await start()
  // Firebase's valid-since timestamp has second precision.
  await delay(1200); await auth.revokeRefreshTokens('rec-main')
  await rejected(service.verify(proof(receipt)))
})
test('per-phone daily, per-IP and per-device limits are enforced on the server', async () => {
  time += 86400000
  for (let i = 0; i < 5; i++) await start()
  time += 60001
  await assert.rejects(service.start({ phone, ...context(++serial) }), e => e.status === 429)
  time += 86400000
  for (let i = 0; i < 10; i++) await service.start({ phone: `+61400003${String(i).padStart(3, '0')}`, device: 'device-limit-fixture-1', ip: ip(i + 50) })
  await assert.rejects(service.start({ phone: '+61400003999', device: 'device-limit-fixture-1', ip: ip(99) }), e => e.status === 429)
  time += 86400000
  for (let i = 0; i < 20; i++) await service.start({ phone: `+61400004${String(i).padStart(3, '0')}`, device: device(i + 100), ip: '127.0.0.240' })
  await assert.rejects(service.start({ phone: '+61400004999', device: device(199), ip: '127.0.0.240' }), e => e.status === 429)
  assert.equal((await auth.listUsers()).users.length, userCount)
})
test('the global daily send budget stops requests before lookup or transport', async () => {
  time += 86400000
  const key = createHmac('sha256', secret).update(`start-global|all|${Math.floor(time / 86400000)}`).digest('hex')
  await db.collection('accountRecoveryLimits').doc(key).set({ count: 100, resetAt: time + 86400000 })
  const count = messages.size
  await assert.rejects(service.start({ phone, ...context(++serial) }), e => e.status === 429)
  assert.equal(messages.size, count)
})
