import test from 'node:test'
import assert from 'node:assert/strict'
import { changeDeletionRequest, classifyDeletionDog, deletionStatus, requireRecentAuthentication } from '../api/_lib/account-deletion.js'
import { makeDeletionHandler } from '../api/account-deletion.js'
import { buildDeletionInventory } from '../api/_lib/account-deletion-inventory.js'

const now = Date.parse('2026-10-19T02:30:00Z')
const token = { uid: 'synthetic-owner', auth_time: now / 1000 }
function fakeDb() {
  const records = new Map()
  let writes = 0
  let chain = Promise.resolve()
  const snap = ref => ({ exists: records.has(ref.path), data: () => records.get(ref.path) })
  return {
    records, get writes() { return writes },
    collection: collection => ({ doc: id => ({ id, path: `${collection}/${id}`, get: async function () { return snap(this) } }) }),
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
  assert.equal(db.writes, 3)
  assert.equal(a.status, 'requested')
  assert.equal(a.canCancel, true)
  assert.equal(db.records.get('accountDeletionRequests/synthetic-owner').mode, 'as_soon_as_possible')
  assert.equal(db.records.get('supportConversations/account_deletion_synthetic-owner').status, 'new')
  assert.equal(db.records.get('supportMessages/account_deletion_synthetic-owner_1_request').conversationId, 'account_deletion_synthetic-owner')
})
test('cancel is idempotent; resubmission is rate limited and versioned', async () => {
  const db = fakeDb()
  await request(db)
  await request(db, { action: 'cancel' })
  await request(db, { action: 'cancel' })
  assert.equal(db.writes, 6)
  assert.equal(db.records.get('supportConversations/account_deletion_synthetic-owner').status, 'closed')
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

function inventoryDb(seed, { failCollection, nested = [] } = {}) {
  const records = new Map(Object.entries(seed))
  const snapshot = path => ({ id: path.split('/')[1], exists: records.has(path), data: () => records.get(path),
    updateTime: { toDate: () => new Date('2026-10-19T00:00:00Z') },
    ref: { path, parent: { id: path.split('/')[0] }, listCollections: async () => nested.filter(p => p.startsWith(path + '/')).map(path => ({ path })) },
  })
  return {
    listCollections: async () => [...new Set([...records.keys()].map(p => p.split('/')[0]))].map(id => ({ id })),
    collection: collection => ({
      doc: id => ({ get: async () => snapshot(`${collection}/${id}`) }),
      where: (field, operator, value) => ({ limit: size => ({ get: async () => {
        if (collection === failCollection) throw new Error('private provider detail must not leak')
        const paths = [...records].filter(([path, data]) => path.startsWith(collection + '/') && data[field] === value).map(([path]) => path).slice(0, size)
        return { size: paths.length, docs: paths.map(snapshot) }
      } }) }),
    }),
  }
}
test('inventory discovers linked and orphan records while preserving another owner; it never includes document bodies', async () => {
  const seed = {
    'users/qa': { email: 'qa@example.invalid' },
    'dogs/transferred': { tenantId: 'qa', currentOwnerId: 'new-owner', passportId: 'passport' },
    'documents/shared': { dogId: 'transferred', filePath: 'documents/qa/transferred/one.pdf', privateNotes: 'secret-body' },
    'documents/orphan': { tenantId: 'qa', dogId: 'missing-dog' },
    'supportConversations/conversation': { ownerUid: 'qa', subject: 'secret-subject' },
    'supportMessages/message': { conversationId: 'conversation', senderUid: 'operator', text: 'secret-message' },
  }
  const before = JSON.stringify(seed)
  const report = await buildDeletionInventory({ db: inventoryDb(seed), uid: 'qa' })
  assert.equal(report.records.find(r => r.path === 'documents/shared').disposition, 'preserve_other_owner')
  assert.equal(report.records.find(r => r.path === 'documents/orphan').disposition, 'review_unresolved_dog')
  assert.equal(report.records.find(r => r.path === 'supportMessages/message').disposition, 'review_account_record')
  assert.deepEqual(report.records.find(r => r.path === 'documents/shared').media.paths, ['documents/qa/transferred/one.pdf'])
  assert.doesNotMatch(JSON.stringify(report), /secret-body|secret-subject|secret-message|qa@example/)
  assert.equal(report.readyForDeletion, false)
  assert.equal(JSON.stringify(seed), before)
})
test('failed queries, limits, unknown collections, nested collections and legacy URLs are explicit holds', async () => {
  const report = await buildDeletionInventory({ uid: 'qa', limit: 1, db: inventoryDb({
    'users/qa': {}, 'dogs/one': { tenantId: 'qa', currentOwnerId: 'qa', profilePhoto: 'https://legacy.invalid/private-token' },
    'dogs/two': { tenantId: 'qa', currentOwnerId: 'qa' }, 'unknown/entry': {},
  }, { failCollection: 'documents', nested: ['dogs/one/privateHistory'] }) })
  for (const hold of ['query_failed', 'query_truncated', 'unclassified_collections', 'nested_collections_not_scanned', 'legacy_media_review']) assert.ok(report.holds.includes(hold), hold)
  assert.equal(report.complete, false)
  assert.doesNotMatch(JSON.stringify(report), /private-token|private provider detail/)
})
test('inventory fingerprint is deterministic and changes when a discovered record is added', async () => {
  const seed = { 'users/qa': {} }
  const first = await buildDeletionInventory({ db: inventoryDb(seed), uid: 'qa', now: 1 })
  const second = await buildDeletionInventory({ db: inventoryDb(seed), uid: 'qa', now: 2 })
  assert.equal(first.fingerprint, second.fingerprint)
  const third = await buildDeletionInventory({ db: inventoryDb({ ...seed, 'documents/new': { tenantId: 'qa' } }), uid: 'qa' })
  assert.notEqual(first.fingerprint, third.fingerprint)
})
test('reminder delivery inventory includes only requester metadata, never message payloads', async () => {
  const report = await buildDeletionInventory({ uid: 'qa', db: inventoryDb({
    'users/qa': {},
    'reminderEmailDeliveries/own': {tenantId: 'qa', payload: {to: ['private@example.invalid'], html: 'secret-reminder-body'}},
    'reminderEmailDeliveries/other': {tenantId: 'other', payload: {html: 'other-secret'}},
  }) })
  assert.ok(report.records.some(r => r.path === 'reminderEmailDeliveries/own'))
  assert.ok(!report.records.some(r => r.path === 'reminderEmailDeliveries/other'))
  assert.doesNotMatch(JSON.stringify(report), /private@example|secret-reminder|other-secret/)
  assert.equal(report.complete, false); assert.equal(report.readyForDeletion, false)
})
