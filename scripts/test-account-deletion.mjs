import test from 'node:test'
import assert from 'node:assert/strict'
import { changeDeletionRequest, classifyDeletionDog, deletionStatus, requireRecentAuthentication } from '../api/_lib/account-deletion.js'
import { makeDeletionHandler } from '../api/account-deletion.js'

const now = Date.parse('2026-10-19T02:30:00Z')
const token = { uid: 'synthetic-owner', auth_time: now / 1000 }
function fakeDb() {
  const records = new Map()
  let writes = 0
  let chain = Promise.resolve()
  const snap = ref => ({ exists: records.has(ref.path), data: () => records.get(ref.path) })
  return {
    records, get writes() { return writes },
    collection: collection => ({ doc: id => ({ path: `${collection}/${id}`, get: async function () { return snap(this) } }) }),
    runTransaction: fn => {
      const work = chain.then(() => fn({ get: async ref => snap(ref), set: (ref, data) => { writes++; records.set(ref.path, data) } }))
      chain = work.catch(() => {})
      return work
    },
  }
}
const request = (db, body = { action: 'request', confirmation: 'DELETE MY ACCOUNT' }, other = {}) => changeDeletionRequest({ db, token, body, now, ...other })

test('recent authentication checks auth_time, not refreshed token iat', () => {
  for (const auth_time of [undefined, NaN, now / 1000 - 301, now / 1000 + 31]) {
    assert.throws(() => requireRecentAuthentication({ auth_time, iat: now / 1000 }, now), { status: 401 })
  }
  assert.doesNotThrow(() => requireRecentAuthentication(token, now))
})
test('confirmation, actions and caller-supplied identity are validated before writing', async () => {
  const db = fakeDb()
  for (const body of [{ action: 'request' }, { action: 'erase' }, { action: 'request', confirmation: 'DELETE MY ACCOUNT', uid: 'victim' }, null]) {
    await assert.rejects(request(db, body), { status: 400 })
  }
  assert.equal(db.writes, 0)
})
test('concurrent duplicate requests produce one durable job and stable receipt', async () => {
  const db = fakeDb()
  const [a, b] = await Promise.all([request(db), request(db)])
  assert.deepEqual(a, b)
  assert.equal(db.writes, 1)
  assert.equal(a.status, 'requested')
  assert.equal(a.canCancel, true)
  assert.equal(db.records.get('accountDeletionRequests/synthetic-owner').mode, 'as_soon_as_possible')
})
test('cancel is idempotent; resubmission is rate limited and versioned', async () => {
  const db = fakeDb()
  await request(db)
  await request(db, { action: 'cancel' })
  await request(db, { action: 'cancel' })
  assert.equal(db.writes, 2)
  await assert.rejects(request(db), { status: 429 })
  await request(db, undefined, { now: now + 60001 })
  assert.equal(db.records.get('accountDeletionRequests/synthetic-owner').revision, 2)
})
test('processing wins a cancellation race and cannot be reset by requesting again', async () => {
  const db = fakeDb()
  db.records.set('accountDeletionRequests/synthetic-owner', { status: 'processing', requestedAt: 'synthetic' })
  await assert.rejects(request(db, { action: 'cancel' }), { status: 409 })
  assert.equal((await request(db)).status, 'processing')
  assert.equal(db.writes, 0)
})
test('status excludes identity, billing identifiers and private operator notes', () => {
  const result = JSON.stringify(deletionStatus({ status: 'review_required', uid: 'secret-uid', stripeCustomerId: 'secret-customer', notes: 'secret-note' }))
  assert.doesNotMatch(result, /secret-/)
})
test('current owner and pending transfer always override original tenant', () => {
  assert.equal(classifyDeletionDog({ tenantId: token.uid, currentOwnerId: 'new-owner' }, token.uid), 'preserve_other_owner')
  assert.equal(classifyDeletionDog({ tenantId: token.uid, currentOwnerId: token.uid, transferStatus: 'pendingClaim' }, token.uid), 'review_pending_transfer')
  assert.equal(classifyDeletionDog({ tenantId: token.uid }, token.uid), 'review_legacy_ownership')
  assert.equal(classifyDeletionDog({ tenantId: 'other', currentOwnerId: token.uid }, token.uid), 'review_owned_data')
})
function response() { return { headers: {}, setHeader(k,v) { this.headers[k] = v }, status(n) { this.code = n; return this }, json(data) { this.data = data; return this } } }
test('API rejects revoked tokens, missing auth and unsupported methods', async () => {
  const db = fakeDb()
  const handler = makeDeletionHandler({ db, authenticate: async () => { throw new Error('revoked') } })
  for (const headers of [{}, { authorization: 'Bearer synthetic' }]) {
    const res = response(); await handler({ method: 'GET', headers }, res); assert.equal(res.code, 401)
  }
  const res = response(); await handler({ method: 'DELETE', headers: {} }, res); assert.equal(res.code, 405)
  assert.equal(db.writes, 0)
})
test('API status lookup is scoped solely to authenticated uid', async () => {
  const db = fakeDb()
  db.records.set('accountDeletionRequests/victim', { status: 'processing' })
  const handler = makeDeletionHandler({ db, authenticate: async () => token })
  const res = response()
  await handler({ method: 'GET', headers: { authorization: 'Bearer synthetic' }, query: { uid: 'victim' } }, res)
  assert.equal(res.code, 200)
  assert.equal(res.data.status, 'none')
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
})
