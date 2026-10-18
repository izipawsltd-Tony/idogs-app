import { expect, test } from 'vitest'
import { prepareRecovery, ownedMediaPath, applyStagingRecovery } from './prepare-legacy-history-recovery.mjs'
const cutoff = '2026-10-07T11:26:32.444Z'
const before = '2026-08-01T00:00:00Z'
const after = '2026-10-08T00:00:00Z'
function fixture({ evidence = true, existing = false, metadataFailure = false, boundary = true } = {}) {
  const reads = [], writes = []
  const rows = {
    auditLogs: evidence ? [{ id: 'transfer', tenantId: 'former', dogId: 'dog', dogName: 'Old name', action: 'dog_transferred', createdAt: cutoff }] : [],
    ownershipHistorySnapshots: existing ? [{ id: 'saved', fromOwnerId: 'former', dogId: 'dog' }] : [],
    vaccineRecords: [{ id: 'old', dogId: 'dog', name: 'Old vaccine' }, { id: 'new', dogId: 'dog', name: 'New private vaccine', dateGiven: '2020-01-01' }],
  }
  const wrap = data => ({ id: data.id, createTime: before, updateTime: data.id === 'new' ? after : before, data: () => data })
  const db = { collection: name => ({
    where: (key, op, value) => ({ get: async () => { reads.push({ name, key, op, value }); return { docs: (rows[name] || []).filter(x => x[key] === value).map(wrap) } } }),
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ previousOwnerId: boundary ? 'former' : 'other', transferredAt: cutoff, name: 'Private current name', notes: 'Private notes', photos: [{ path: 'dogs/former/dog/photos/old.jpg' }, { path: 'dogs/buyer/dog/photos/new.jpg' }] }) }), create: value => writes.push(value) }),
  }) }
  const bucket = { name: 'bucket', file: path => ({ getMetadata: async () => { if (metadataFailure) throw Error('metadata unavailable'); return [{ generation: '123', timeCreated: before, updated: before }] } }) }
  return { db, bucket, reads, writes }
}
test('prepares a read-only, owner-scoped candidate without exposing current profile or backdated additions', async () => {
  const f = fixture(); const plan = await prepareRecovery({ ...f, dogId: 'dog', fromOwnerId: 'former' })
  expect(plan.snapshot.vaccineRecords.map(x => x.name)).toEqual(['Old vaccine'])
  expect(plan.snapshot.dog.name).toBe('Old name'); expect(JSON.stringify(plan)).not.toContain('Private')
  expect(plan.snapshot.recoveredMedia).toHaveLength(1); expect(f.writes).toHaveLength(0)
  expect(f.reads[0]).toEqual({ name: 'auditLogs', key: 'tenantId', op: '==', value: 'former' })
})
test('missing ownership evidence, existing history and missing storage metadata stop recovery', async () => {
  await expect(prepareRecovery({ ...fixture({ evidence: false }), dogId: 'dog', fromOwnerId: 'former' })).rejects.toThrow('NO_OWNER_SCOPED_TRANSFER_EVIDENCE')
  await expect(prepareRecovery({ ...fixture({ existing: true }), dogId: 'dog', fromOwnerId: 'former' })).rejects.toThrow('HISTORY_ALREADY_EXISTS')
  await expect(prepareRecovery({ ...fixture({ metadataFailure: true }), dogId: 'dog', fromOwnerId: 'former' })).rejects.toThrow('metadata unavailable')
  await expect(prepareRecovery({ ...fixture({ boundary: false }), dogId: 'dog', fromOwnerId: 'former' })).rejects.toThrow('TRANSFER_BOUNDARY_MISMATCH')
})
test('recognizes same-bucket historical profile/note URLs while rejecting foreign media', () => {
  const prefix = 'dogs/former/dog/'
  expect(ownedMediaPath('https://storage.googleapis.com/bucket/dogs/former/dog/profile.jpg', 'bucket', prefix)).toBe(prefix + 'profile.jpg')
  expect(ownedMediaPath('https://firebasestorage.googleapis.com/v0/b/bucket/o/dogs%2Fformer%2Fdog%2Fnotes%2Fold.jpg?alt=media', 'bucket', prefix)).toBe(prefix + 'notes/old.jpg')
  for (const url of ['https://storage.googleapis.com/other/dogs/former/dog/x.jpg', 'https://example.test/dogs/former/dog/x.jpg', 'https://storage.googleapis.com/bucket/dogs/buyer/dog/x.jpg', 'http://storage.googleapis.com/bucket/dogs/former/dog/x.jpg']) expect(ownedMediaPath(url, 'bucket', prefix)).toBeNull()
})
test('an old profile photo is recovered but a post-transfer overwrite is excluded', async () => {
  const f = fixture()
  f.db.collection = ((base) => name => {
    const col = base(name)
    return name === 'dogs' ? { ...col, doc: () => ({ get: async () => ({ exists: true, data: () => ({ previousOwnerId: 'former', transferredAt: cutoff, profilePhoto: 'https://storage.googleapis.com/bucket/dogs/former/dog/profile.jpg' }) }) }) } : col
  })(f.db.collection)
  const plan = await prepareRecovery({ ...f, dogId: 'dog', fromOwnerId: 'former' })
  expect(plan.snapshot.recoveredMedia.map(m => m.path)).toEqual(['dogs/former/dog/profile.jpg'])
  f.bucket.file = () => ({ getMetadata: async () => [{ generation: '222', timeCreated: before, updated: after }] })
  expect((await prepareRecovery({ ...f, dogId: 'dog', fromOwnerId: 'former' })).snapshot.recoveredMedia).toEqual([])
})
test('apply refuses production before requesting a database transaction', async () => {
  await expect(applyStagingRecovery({ db: { runTransaction() { throw Error('must not run') } }, project: 'idogs-app', plan: {} })).rejects.toThrow('PRODUCTION_WRITES_NOT_SUPPORTED')
  await expect(applyStagingRecovery({ db: { projectId: 'idogs-app', runTransaction() { throw Error('must not run') } }, project: 'idogs-app-staging', plan: {} })).rejects.toThrow('PROJECT_MISMATCH')
})
test('staging application rechecks ownership and existing history inside the transaction', async () => {
  const writes = []
  let duplicate = true
  const db = { projectId: 'idogs-app-staging', collection: name => ({ doc: id => ({ name, id }), where: () => ({ name }) }), runTransaction: async fn => fn({
    get: async ref => ref.name === 'dogs' ? { exists: true, data: () => ({ previousOwnerId: 'former', transferredAt: cutoff }) } : { docs: duplicate ? [{ data: () => ({ dogId: 'dog' }) }] : [] },
    create: (ref, data) => writes.push({ ref, data }),
  }) }
  const plan = { id: 'recovered', snapshot: { fromOwnerId: 'former', dogId: 'dog', transferredAt: cutoff } }
  await expect(applyStagingRecovery({ db, project: db.projectId, plan })).rejects.toThrow('HISTORY_ALREADY_EXISTS')
  expect(writes).toEqual([])
  duplicate = false
  await applyStagingRecovery({ db, project: db.projectId, plan })
  expect(writes).toEqual([{ ref: { name: 'ownershipHistorySnapshots', id: 'recovered' }, data: plan.snapshot }])
})
