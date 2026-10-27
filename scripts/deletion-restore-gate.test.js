import { describe, expect, it, vi } from 'vitest'
import { assessIsolatedDeletionRestore } from '../api/_lib/deletion-restore-gate.js'

function fixture() {
  const ledger = { independentOfRestore: true, complete: true, revision: 'live-ledger-1', accounts: [
    { uid: 'qa-deleted', revision: 2, state: 'completed', retained: [{ path: 'invoices/lawfully-retained', expectedDataHash: 'a'.repeat(64) }] },
  ] }
  const view = { complete: true, auth: { state: 'absent' }, lock: { revision: 2, state: 'completed' },
    records: [{ path: 'invoices/lawfully-retained', dataHash: 'a'.repeat(64) }] }
  const options = { target: { projectId: 'idogs-app-staging', databaseId: 'idogs-deletion-qa', publicAccess: false, isolated: true },
    readLedger: vi.fn(async () => structuredClone(ledger)), inspectRestoredAccount: vi.fn(async () => structuredClone(view)) }
  return { ledger, view, options }
}

describe('isolated deletion restore gate', () => {
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
})
