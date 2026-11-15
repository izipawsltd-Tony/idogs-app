import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { legacyTransferHistory } from '../api/_lib/ownership-history.js'

const own = (id, dogId, action, createdAt, extra = {}) => ({
  id, dogId, action, createdAt, tenantId: 'former', dogName: `Old ${dogId}`, details: id, ...extra,
})

describe('legacy transfer history without live-data fallback', () => {
  it('opens both legacy transfers using only the former owner audit records', () => {
    const result = legacyTransferHistory([
      own('t1', 'first', 'dog_transferred', '2026-10-14T12:00:00Z'),
      own('t2', 'second', 'dog_transferred', '2026-10-14T13:00:00Z'),
    ], 'former')
    assert.deepEqual(result.map(s => s.dogId), ['first', 'second'])
    for (const s of result) {
      assert.equal(s.historyAvailability, 'audit_only')
      assert.equal(s.snapshotVersion, 0)
      assert.equal(s.vaccineRecords, undefined)
      assert.equal(s.documents, undefined)
      assert.equal(s.dog.sex, undefined)
    }
  })
  it('excludes other users and every post-transfer entry even if a clinical date is backdated', () => {
    const result = legacyTransferHistory([
      own('before', 'first', 'vaccine_added', '2026-10-13T00:00:00Z'),
      own('transfer', 'first', 'dog_transferred', '2026-10-14T00:00:00Z'),
      own('after', 'first', 'worming_added', '2026-10-15T00:00:00Z', { dateGiven: '2020-01-01' }),
      own('buyer', 'first', 'vaccine_added', '2026-10-13T00:00:00Z', { tenantId: 'buyer' }),
      own('buyer-transfer', 'second', 'dog_transferred', '2026-10-13T00:00:00Z', { tenantId: 'buyer' }),
    ], 'former')
    assert.equal(result.length, 1)
    assert.deepEqual(result[0].auditEntries.map(e => e.id), ['transfer', 'before'])
  })
  it('returns no historical access for a stranger, missing transfer, or invalid timestamp', () => {
    const events = [own('bad', 'first', 'dog_transferred', 'bad-date'), own('note', 'second', 'dog_updated', '2026-10-13T00:00:00Z')]
    assert.deepEqual(legacyTransferHistory(events, 'former'), [])
    assert.deepEqual(legacyTransferHistory([own('t', 'first', 'dog_transferred', '2026-10-14T00:00:00Z')], 'stranger'), [])
  })
  it('selects the latest transfer and projects no hidden extra fields from audit entries', () => {
    const s = legacyTransferHistory([
      own('one', 'first', 'dog_transferred', '2026-10-13T00:00:00Z'),
      own('two', 'first', 'dog_transferred', '2026-10-14T00:00:00Z', { privateField: 'not-returned' }),
    ], 'former')[0]
    assert.equal(s.transferredAt, '2026-10-14T00:00:00Z')
    assert.equal(JSON.stringify(s).includes('privateField'), false)
  })
})
