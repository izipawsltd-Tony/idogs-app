import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existedAtTransfer, makeRecoveredHistory } from '../api/_lib/legacy-history-recovery.js'
const cutoff = '2026-10-07T11:26:32.444Z'
const legacy = { historyAvailability: 'audit_only', fromOwnerId: 'former', dogId: 'dog', dog: { name: 'Old name' }, transferredAt: cutoff, auditEntries: [] }
const record = (id, updateTime, extra = {}) => ({ id, createTime: '2026-08-01T00:00:00Z', updateTime, data: { dogId: 'dog', name: id, dateGiven: '2020-01-01', ...extra } })
const media = (path, updated = '2026-08-01T00:00:00Z') => ({ path, timeCreated: '2026-08-01T00:00:00Z', updated, generation: '1234' })
const build = (records = {}, photos = []) => makeRecoveredHistory({ legacy, records, media: photos, recoveredAt: '2026-10-16T00:00:00Z' })
test('retains old records, rejects backdated additions, edited records and other dogs', () => {
  const s = build({ vaccineRecords: [record('old', '2026-08-01T00:00:00Z'), record('backdated', '2026-10-08T00:00:00Z'), record('edited', '2026-10-09T00:00:00Z'), record('other dog', '2026-08-01T00:00:00Z', { dogId: 'other' })] })
  assert.deepEqual(s.vaccineRecords.map(x => x.id), ['old']); assert.equal(s.recoveryOmissions.vaccineRecords, 3)
})
test('only exact former-owner/dog namespace and pinned generation are recovered', () => {
  const s = build({}, [media('dogs/former/dog/photos/old.jpg'), media('dogs/buyer/dog/photos/private.jpg'), media('dogs/former/other/photos/old.jpg'), media('dogs/former/dog/photos/../private.jpg'), media('dogs/former/dog/profile.jpg', '2026-10-08T00:00:00Z'), { ...media('dogs/former/dog/photos/bad.jpg'), generation: '' }])
  assert.deepEqual(s.recoveredMedia, [{ path: 'dogs/former/dog/photos/old.jpg', generation: '1234' }])
})
test('missing, invalid and contradictory timestamps fail closed', () => {
  for (const [c, u] of [[null, cutoff], [cutoff, null], ['bad', cutoff], ['2026-10-08T00:00:00Z', '2026-10-01T00:00:00Z']]) assert.equal(existedAtTransfer(c, u, cutoff), false)
})
test('does not substitute current profile, identity or profile photo', () => {
  const s = makeRecoveredHistory({ legacy: { ...legacy, dog: { ...legacy.dog, profilePhoto: 'private', breed: 'current', notes: 'private' } }, records: {}, media: [], recoveredAt: 'now' })
  assert.deepEqual(s.dog, { id: 'dog', tenantId: 'former', name: 'Old name' }); assert.equal(s.historyAvailability, 'recovered_partial')
})
test('requires owner-scoped transfer evidence', () => {
  assert.throws(() => makeRecoveredHistory({ legacy: { ...legacy, fromOwnerId: '' }, records: {}, media: [] }))
  assert.throws(() => makeRecoveredHistory({ legacy: { ...legacy, historyAvailability: 'snapshot' }, records: {}, media: [] }))
})
test('removes mutable media links from recovered records, including nested attachments', () => {
  const s = build({ activityNotes: [record('note', '2026-08-01T00:00:00Z', { text: 'Old note', photoUrl: 'https://current-image', attachments: [{ fileUrl: 'https://current-file', title: 'Old title' }] })] })
  assert.equal(s.activityNotes[0].photoUrl, undefined)
  assert.deepEqual(s.activityNotes[0].attachments, [{ title: 'Old title' }])
  assert.equal(s.activityNotes[0].text, 'Old note')
})
test('retains nanosecond precision at transfer boundary for REST and SDK metadata', () => {
  assert.equal(existedAtTransfer('2026-08-01T00:00:00Z', '2026-10-07T11:26:32.444000001Z', cutoff), false)
  assert.equal(existedAtTransfer('2026-08-01T00:00:00Z', '2026-10-07T11:26:32.443999999Z', cutoff), true)
  assert.equal(existedAtTransfer({ seconds: 1, nanoseconds: 1 }, { seconds: 2, nanoseconds: 1 }, '1970-01-01T00:00:02.000000000Z'), false)
})
test('old audit entries with absent optional fields produce Firestore-safe snapshots', () => {
  const s = makeRecoveredHistory({ legacy: { ...legacy, auditEntries: [{ id: 'audit', details: undefined, action: 'dog_transferred', createdAt: cutoff }] }, records: {}, media: [], recoveredAt: cutoff })
  assert.equal(Object.hasOwn(s.auditEntries[0], 'details'), false)
  assert.deepEqual(s, JSON.parse(JSON.stringify(s)))
})
