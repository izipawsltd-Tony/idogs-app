import { describe, expect, it, vi } from 'vitest'
import { assessIsolatedDeletionRestore } from '../api/_lib/deletion-restore-gate.js'
import { scopedRestoredRecords } from '../api/_lib/deletion-restore-inventory.js'

describe('bounded restore discovery', () => {
  const options = () => ({ uid: 'qa-deleted', dogIds: ['approved-dog'], records: [] })
  it('includes path-only account and dog descendants without granting ownership', () => {
    const paths = ['users/qa-deleted/private/note', 'puppyFollowers/qa-deleted/dogs/other-dog', 'puppyProfiles/approved-dog/media/item', 'dogs/approved-dog/details/item']
    expect(scopedRestoredRecords({ ...options(), records: paths.map(path => ({ path, data: { public: false } })) }).map(r => r.path)).toEqual([...paths].sort())
  })
  it('excludes exact-segment collisions and never infers dog scope from restored ownership', () => {
    const records = ['puppyProfiles/approved-dog-collision/media/item', 'puppyFollowers/qa-deleted-collision/dogs/other-dog', 'dogs/other-dog'].map(path => ({ path, data: { status: 'active' } }))
    expect(scopedRestoredRecords({ ...options(), records })).toEqual([])
  })
  it('still includes payload identity and emits hashes without private contents', () => {
    const record = { path: 'documents/restored', data: { ownerUid: 'qa-deleted', name: 'private synthetic name' } }
    const selected = scopedRestoredRecords({ ...options(), records: [record] })
    expect(selected).toEqual([{ path: record.path, dataHash: expect.stringMatching(/^[a-f0-9]{64}$/) }])
    expect(JSON.stringify(selected)).not.toContain(record.data.name)
  })
  it.each([undefined, ['approved-dog', 'approved-dog'], ['../foreign'], Array(26).fill('dog')].map(value => [value]))('rejects invalid manifest dog scope %s', dogIds => {
    expect(() => scopedRestoredRecords({ ...options(), dogIds })).toThrow('RESTORE_DISCOVERY_SCOPE_REQUIRED')
  })
  it.each(['dogs/../details/item', 'dogs//details/item', 'dogs/odd/collection', '/dogs/item'])('rejects malformed document path %s', path => {
    expect(() => scopedRestoredRecords({ ...options(), records: [{ path, data: {} }] })).toThrow('RESTORE_DISCOVERY_RECORD_INVALID')
  })
  it('rejects duplicate paths and over-limit input instead of silently truncating', () => {
    const record = { path: 'dogs/approved-dog', data: {} }
    expect(() => scopedRestoredRecords({ ...options(), records: [record, record] })).toThrow('RESTORE_DISCOVERY_RECORD_INVALID')
    expect(() => scopedRestoredRecords({ ...options(), records: Array(5001).fill(record) })).toThrow('RESTORE_DISCOVERY_INCOMPLETE')
  })
})

function fixture() {
  const ledger = { independentOfRestore: true, complete: true, revision: 'live-ledger-1', accounts: [
    { uid: 'qa-deleted', revision: 2, state: 'completed', retained: [{ path: 'invoices/lawfully-retained', expectedDataHash: 'a'.repeat(64), category: 'reviewed_financial_record', reason: 'Synthetic lawful retention review', reviewAfter: '2026-10-29T00:00:00Z' }] },
  ] }
  const view = { uid: 'qa-deleted', complete: true, auth: { state: 'absent' }, lock: { revision: 2, state: 'completed' },
    records: [{ path: 'invoices/lawfully-retained', dataHash: 'a'.repeat(64) }] }
  const options = { target: { projectId: 'idogs-app-staging', databaseId: 'idogs-deletion-qa', publicAccess: false, isolated: true },
    expectedAccounts: [{ uid: 'qa-deleted', revision: 2 }], clock: () => Date.parse('2026-10-28T00:00:00Z'), readLedger: vi.fn(async () => structuredClone(ledger)), inspectRestoredAccount: vi.fn(async () => structuredClone(view)) }
  return { ledger, view, options }
}

describe('isolated deletion restore gate', () => {
  it.each([undefined, [], Array.from({ length: 201 }, (_, i) => ({ uid: `qa-${i}`, revision: 1 }))].map(value => [value]))('requires bounded nonempty approved account scope before reads: %s', async expectedAccounts => {
    const f = fixture(); f.options.expectedAccounts = expectedAccounts
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_ACCOUNT_SCOPE_REQUIRED')
    expect(f.options.readLedger).not.toHaveBeenCalled()
  })
  it.each([
    [{ uid: 'qa-deleted', revision: 0 }],
    [{ uid: '../foreign', revision: 2 }],
    [{ uid: 'qa-deleted', revision: 2 }, { uid: 'qa-deleted', revision: 2 }],
  ].map(value => [value]))('rejects invalid or duplicated approved scope: %s', async expectedAccounts => {
    const f = fixture(); f.options.expectedAccounts = expectedAccounts
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_ACCOUNT_SCOPE_INVALID')
    expect(f.options.readLedger).not.toHaveBeenCalled()
  })
  it.each(['empty', 'foreign', 'revision', 'duplicate', 'extra'])('cannot accept a self-declared complete ledger with %s scope', async kind => {
    const f = fixture(), account = f.ledger.accounts[0]
    if (kind === 'empty') f.ledger.accounts = []
    if (kind === 'foreign') account.uid = 'qa-other'
    if (kind === 'revision') account.revision++
    if (kind === 'duplicate') f.ledger.accounts.push(structuredClone(account))
    if (kind === 'extra') f.ledger.accounts.push({ ...account, uid: 'qa-other' })
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_LEDGER_SCOPE_MISMATCH')
    expect(f.options.inspectRestoredAccount).not.toHaveBeenCalled()
  })
  it.each([undefined, 'qa-other'])('rejects inventory not bound to the requested account: %s', async uid => {
    const f = fixture(); f.view.uid = uid
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_INVENTORY_ACCOUNT_MISMATCH')
  })
  it('captures approved account scope before awaiting an external ledger read', async () => {
    const f = fixture()
    f.options.readLedger.mockImplementation(async () => {
      f.options.expectedAccounts[0].uid = 'qa-other'
      return structuredClone(f.ledger)
    })
    expect((await assessIsolatedDeletionRestore(f.options)).replayVerified).toBe(true)
    expect(f.options.inspectRestoredAccount).toHaveBeenCalledWith('qa-deleted')
  })
  it('allows the separately approved managed restore target only with explicit rehearsal type', async () => {
    const f = fixture(); f.options.target.databaseId = 'idogs-deletion-restore-qa'
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('ISOLATED_RESTORE_REQUIRED')
    f.options.target.rehearsal = 'managed-backup'
    expect((await assessIsolatedDeletionRestore(f.options)).productionReady).toBe(false)
    f.options.target.databaseId = 'idogs-deletion-backup-qa'
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('ISOLATED_RESTORE_REQUIRED')
  })
  it('verifies replay without granting Production readiness or exposure', async () => {
    const f = fixture(), result = await assessIsolatedDeletionRestore(f.options)
    expect(result).toMatchObject({ replayVerified: true, keepIsolated: true, productionReady: false, checkedAccounts: 1 })
    expect(f.options.readLedger).toHaveBeenCalledTimes(2)
  })
  it.each([
    target => { target.projectId = 'idogs-app' },
    target => { target.databaseId = '(default)' },
    target => { target.publicAccess = true },
    target => { target.isolated = false },
  ])('rejects unsafe restore targets before reads', async mutate => {
    const f = fixture(); mutate(f.options.target)
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('ISOLATED_RESTORE_REQUIRED')
    expect(f.options.readLedger).not.toHaveBeenCalled()
  })
  it.each([
    ledger => { ledger.independentOfRestore = false },
    ledger => { ledger.complete = false },
    ledger => { ledger.nextPageToken = 'more' },
  ])('rejects backup-derived or incomplete deletion history', async mutate => {
    const f = fixture(); mutate(f.ledger)
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('AUTHORITATIVE_RESTORE_LEDGER_REQUIRED')
  })
  it.each(['enabled', 'disabled'])('holds restored Auth identity even when %s', async state => {
    const f = fixture(); f.view.auth.state = state
    expect((await assessIsolatedDeletionRestore(f.options)).issues).toContainEqual({ uid: 'qa-deleted', code: 'restored_auth_identity' })
  })
  it('holds restored data and altered retained content instead of ignoring approved paths', async () => {
    const f = fixture(); f.view.records[0].dataHash = 'b'.repeat(64)
    f.view.records.push({ path: 'users/qa-deleted', dataHash: 'c'.repeat(64) })
    const result = await assessIsolatedDeletionRestore(f.options)
    expect(result.replayVerified).toBe(false); expect(result.issues).toHaveLength(2)
  })
  it('holds lost tombstones and ongoing deletion', async () => {
    const f = fixture(); f.ledger.accounts[0].state = 'processing'; f.view.lock = null
    const result = await assessIsolatedDeletionRestore(f.options)
    expect(result.issues.map(x => x.code)).toEqual(['restore_tombstone_missing_or_changed', 'deletion_still_processing'])
  })
  it('rejects a concurrently accepted deletion instead of returning a stale pass', async () => {
    const f = fixture(); f.options.inspectRestoredAccount.mockImplementation(async () => {
      f.ledger.revision = 'live-ledger-2'; return f.view
    })
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_LEDGER_CHANGED')
  })
  it.each([
    view => { view.nextPageToken = 'more' },
    view => { view.complete = false },
    view => { delete view.auth },
  ])('rejects incomplete restored inventories', async mutate => {
    const f = fixture(); mutate(f.view)
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_INVENTORY_INCOMPLETE')
  })
  it.each(['reviewed_financial_record', 'reviewed_history'])('holds expired %s despite unchanged retained content', async category => {
    const f = fixture(); Object.assign(f.ledger.accounts[0].retained[0], { category, reviewAfter: '2026-10-27T00:00:00Z' })
    const result = await assessIsolatedDeletionRestore(f.options)
    expect(result.replayVerified).toBe(false)
    expect(result.issues).toContainEqual({ uid: 'qa-deleted', code: 'retention_review_expired', path: 'invoices/lawfully-retained' })
  })
  it('rechecks retention expiry after asynchronous inventory and ledger reads', async () => {
    const f = fixture(); let now = Date.parse('2026-10-28T00:00:00Z'); f.options.clock = () => now
    f.options.inspectRestoredAccount.mockImplementation(async () => { now = Date.parse('2026-10-29T00:00:00Z'); return f.view })
    expect((await assessIsolatedDeletionRestore(f.options)).issues.map(i => i.code)).toContain('retention_review_expired')
  })
  it.each([undefined, '', 'not-a-date', 0])('rejects missing or malformed retention review dates: %s', async reviewAfter => {
    const f = fixture(); f.ledger.accounts[0].retained[0].reviewAfter = reviewAfter
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_RETENTION_REVIEW_REQUIRED')
    expect(f.options.inspectRestoredAccount).not.toHaveBeenCalled()
  })
  it('preserves current-owner history without inventing a financial retention deadline', async () => {
    const f = fixture(); Object.assign(f.ledger.accounts[0].retained[0], { category: 'current_owner_history', reviewAfter: undefined, reason: undefined })
    expect((await assessIsolatedDeletionRestore(f.options)).replayVerified).toBe(true)
  })
  it.each([undefined, 'unknown'])('rejects unclassified retained records: %s', async category => {
    const f = fixture(); f.ledger.accounts[0].retained[0].category = category
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_RETAINED_BINDING_REQUIRED')
  })
  it('rejects invalid or backwards clocks instead of treating an expired approval as current', async () => {
    const f = fixture(); f.options.clock = () => NaN
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_CLOCK_INVALID')
    expect(f.options.readLedger).not.toHaveBeenCalled()
    f.options.clock = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(99)
    await expect(assessIsolatedDeletionRestore(f.options)).rejects.toThrow('RESTORE_CLOCK_INVALID')
  })
})
