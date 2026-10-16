import { expect, test } from 'vitest'
import { prepareRecovery } from './prepare-legacy-history-recovery.mjs'
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
