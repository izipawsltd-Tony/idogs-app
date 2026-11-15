import { mock, test } from 'node:test'
import assert from 'node:assert/strict'

let signed = []
const before = 'documents/former/dog/before.pdf'
const after = 'documents/former/dog/after.pdf'
const dog = { tenantId: 'former', currentOwnerId: 'buyer' }
const snapshots = [{ dogId: 'dog', fromOwnerId: 'former', documents: [{ filePath: before }] }]
const db = { collection(name) {
  if (name === 'dogs') return { doc: () => ({ get: async () => ({ exists: true, data: () => dog }) }) }
  assert.equal(name, 'ownershipHistorySnapshots')
  const filters = []
  const query = { where(key, _op, value) { filters.push([key, value]); return this },
    get: async () => ({ docs: snapshots.filter(s => filters.every(([k, v]) => s[k] === v)).map(s => ({ data: () => s })) }) }
  return query
} }
mock.module('firebase-admin/app', { namedExports: { getApps: () => [{}], initializeApp() {}, cert() {} } })
mock.module('firebase-admin/auth', { namedExports: { getAuth: () => ({ verifyIdToken: async uid => ({ uid }) }) } })
mock.module('firebase-admin/firestore', { namedExports: { getFirestore: () => db } })
mock.module('firebase-admin/storage', { namedExports: { getStorage: () => ({ bucket: () => ({ file: path => ({
  exists: async () => [true], getSignedUrl: async () => { signed.push(path); return ['https://files.test/authorized'] },
}) }) }) } })
mock.module('../api/_lib/require-config.js', { namedExports: { requireStorageBucket: () => 'staging.test', logConfigError() {} } })
mock.module('../api/_lib/http-helpers.js', { namedExports: { logSanitizedError() {} } })
const { default: handler } = await import('../api/get-signed-url.js')
async function request(filePath, uid) {
  const res = { code: 200, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'POST', headers: { authorization: uid ? `Bearer ${uid}` : '' }, body: { filePath } }, res)
  return res
}
test('document signing follows immutable snapshot membership and current ownership', async t => {
  await t.test('former owner can open an exact document path saved in their snapshot', async () => {
    assert.equal((await request(before, 'former')).code, 200)
  })
  await t.test('former owner cannot open a new file even under the old tenant path', async () => {
    const count = signed.length
    assert.equal((await request(after, 'former')).code, 403)
    assert.equal(signed.length, count)
  })
  await t.test('stranger cannot open either historical or new documents', async () => {
    for (const path of [before, after]) assert.equal((await request(path, 'stranger')).code, 403)
  })
  await t.test('current owner retains access to transferred original files and new files', async () => {
    for (const path of [before, after]) assert.equal((await request(path, 'buyer')).code, 200)
  })
  await t.test('current owner cannot sign a different tenant namespace', async () => {
    assert.equal((await request('documents/unrelated/dog/secret.pdf', 'buyer')).code, 403)
  })
  await t.test('unauthenticated requests cannot open historical files', async () => {
    assert.equal((await request(before, '')).code, 401)
  })
})
