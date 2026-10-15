import { mock, test } from 'node:test'
import assert from 'node:assert/strict'

let fixtures = { ownershipHistorySnapshots: [], auditLogs: [] }
let reads = []
const db = { collection(name) {
  reads.push(name)
  assert.ok(['ownershipHistorySnapshots', 'auditLogs'].includes(name), 'history must never read live records')
  return { where(key, op, value) {
    assert.equal(op, '==')
    assert.ok((name === 'auditLogs' && key === 'tenantId') || (name === 'ownershipHistorySnapshots' && key === 'fromOwnerId'))
    return { get: async () => ({ docs: fixtures[name].filter(d => d[key] === value).map(d => ({ id: d.id, data: () => d })) }) }
  } }
} }
mock.module('firebase-admin/app', { namedExports: { getApps: () => [{}], initializeApp: () => {}, cert: () => ({}) } })
mock.module('firebase-admin/auth', { namedExports: { getAuth: () => ({ verifyIdToken: async token => {
  if (token === 'bad') throw new Error('invalid')
  return { uid: token }
} }) } })
mock.module('firebase-admin/firestore', { namedExports: { getFirestore: () => db } })
const { default: handler } = await import('../api/get-dog-history.js')

async function request(body, token = 'former', method = 'POST') {
  const res = { code: 200, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method, headers: { authorization: token ? `Bearer ${token}` : '' }, body }, res)
  return res
}
const transfer = (id, dogId, uid = 'former') => ({ id, dogId, tenantId: uid, dogName: `Old ${dogId}`, action: 'dog_transferred', createdAt: '2026-10-14T00:00:00.000Z' })

test('history API authentication, two legacy transfers, immutable snapshots and tenant isolation', async t => {
  await t.test('requires a valid token and supported action', async () => {
    assert.equal((await request({}, '')).code, 401)
    assert.equal((await request({}, 'bad')).code, 401)
    assert.equal((await request({}, 'former', 'GET')).code, 405)
    assert.equal((await request({ action: 'unknown' })).code, 400)
    assert.equal((await request({ action: 'detail' })).code, 400)
  })
  fixtures = { ownershipHistorySnapshots: [], auditLogs: [transfer('t1', 'first'), transfer('t2', 'second'), transfer('t3', 'third', 'buyer')] }
  await t.test('lists both transferred dogs using only caller-owned audit data', async () => {
    const r = await request({ action: 'list' })
    assert.equal(r.code, 200)
    assert.deepEqual(r.body.dogs.map(d => d.id), ['first', 'second'])
    assert.ok(r.body.dogs.every(d => d.currentOwnerId === '__historical__' && d.historyAvailability === 'audit_only'))
  })
  await t.test('opens each legacy transfer with an explicit missing-snapshot state', async () => {
    for (const dogId of ['first', 'second']) {
      const r = await request({ action: 'detail', dogId })
      assert.equal(r.code, 200)
      assert.equal(r.body.snapshot.historyAvailability, 'audit_only')
      assert.equal(r.body.snapshot.dog.name, `Old ${dogId}`)
    }
  })
  await t.test('ignores a caller-supplied owner identity and denies other tenants', async () => {
    assert.equal((await request({ action: 'detail', dogId: 'first', fromOwnerId: 'former' }, 'stranger')).code, 404)
    assert.deepEqual((await request({ action: 'list', uid: 'former' }, 'stranger')).body.dogs, [])
  })
  fixtures.ownershipHistorySnapshots = [
    { id: 's1', dogId: 'first', fromOwnerId: 'former', transferredAt: '2026-10-13T00:00:00Z', dog: { name: 'OLDER' } },
    { id: 's2', dogId: 'first', fromOwnerId: 'former', transferredAt: '2026-10-14T00:00:00Z', dog: { name: 'FROZEN' }, vaccineRecords: [{ id: 'before' }] },
    { id: 'private', dogId: 'first', fromOwnerId: 'buyer', transferredAt: '2026-10-15T00:00:00Z', dog: { name: 'PRIVATE LATER NAME' }, vaccineRecords: [{ id: 'after' }] },
  ]
  await t.test('chooses the latest snapshot owned by the caller, before considering legacy audit', async () => {
    const r = await request({ action: 'detail', dogId: 'first' })
    assert.equal(r.code, 200)
    assert.equal(r.body.snapshot.id, 's2')
    assert.equal(r.body.snapshot.dog.name, 'FROZEN')
    assert.deepEqual(r.body.snapshot.vaccineRecords, [{ id: 'before' }])
    assert.equal(JSON.stringify(r.body).includes('PRIVATE'), false)
    const list = await request({ action: 'list' })
    assert.equal(list.body.dogs.filter(d => d.id === 'first').length, 1)
    assert.equal(list.body.dogs.find(d => d.id === 'first').historyAvailability, 'snapshot')
  })
  await t.test('never accesses live dog, health, documents, media, reminders, breeding or scans', () => {
    assert.ok(reads.every(name => ['ownershipHistorySnapshots', 'auditLogs'].includes(name)))
  })
})
