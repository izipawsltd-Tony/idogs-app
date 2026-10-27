import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const validUid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

// Read-only, isolated restore rehearsal. The authoritative ledger must be read
// outside the restored snapshot. This does not erase records or authorise a
// Production restore; callers must keep restored data inaccessible.
export async function assessIsolatedDeletionRestore({ target, readLedger, inspectRestoredAccount }) {
  if (target?.projectId !== 'idogs-app-staging' || target?.databaseId !== 'idogs-deletion-qa'
    || target?.publicAccess !== false || target?.isolated !== true) throw new Error('ISOLATED_RESTORE_REQUIRED')
  if (typeof readLedger !== 'function' || typeof inspectRestoredAccount !== 'function') throw new Error('RESTORE_READERS_REQUIRED')
  const before = await readLedger()
  if (!before || before.independentOfRestore !== true || before.complete !== true
    || before.nextPageToken || !Array.isArray(before.accounts) || before.accounts.length > 200
    || typeof before.revision !== 'string' || !before.revision) throw new Error('AUTHORITATIVE_RESTORE_LEDGER_REQUIRED')
  const fingerprint = hash(before)
  const seen = new Set(), issues = []
  for (const account of before.accounts) {
    if (!validUid(account.uid) || seen.has(account.uid) || !Number.isSafeInteger(account.revision)
      || account.revision < 1 || !['processing', 'completed'].includes(account.state)
      || !Array.isArray(account.retained) || account.retained.length > 1000) throw new Error('RESTORE_LEDGER_INVALID')
    seen.add(account.uid)
    const retained = new Map()
    for (const record of account.retained) {
      if (typeof record.path !== 'string' || !record.path || retained.has(record.path)
        || !/^[a-f0-9]{64}$/.test(record.expectedDataHash || '')) throw new Error('RESTORE_RETAINED_BINDING_REQUIRED')
      retained.set(record.path, record.expectedDataHash)
    }
    const view = await inspectRestoredAccount(account.uid)
    if (!view || view.complete !== true || view.nextPageToken || !Array.isArray(view.records)
      || !view.auth || !['absent', 'disabled', 'enabled'].includes(view.auth.state)) throw new Error('RESTORE_INVENTORY_INCOMPLETE')
    if (view.lock?.revision !== account.revision || view.lock?.state !== account.state) issues.push({ uid: account.uid, code: 'restore_tombstone_missing_or_changed' })
    if (account.state !== 'completed') issues.push({ uid: account.uid, code: 'deletion_still_processing' })
    if (view.auth.state !== 'absent') issues.push({ uid: account.uid, code: 'restored_auth_identity' })
    const paths = new Set()
    for (const record of view.records) {
      if (!record || typeof record.path !== 'string' || paths.has(record.path)
        || !/^[a-f0-9]{64}$/.test(record.dataHash || '')) throw new Error('RESTORE_INVENTORY_INVALID')
      paths.add(record.path)
      if (retained.get(record.path) !== record.dataHash) issues.push({ uid: account.uid, code: 'restored_account_data', path: record.path })
    }
    for (const path of retained.keys()) if (!paths.has(path)) issues.push({ uid: account.uid, code: 'retained_record_missing', path })
  }
  // A deletion accepted while the restored copy was inspected invalidates the
  // whole result. An empty/stale backup ledger must never replace live history.
  if (hash(await readLedger()) !== fingerprint) throw new Error('RESTORE_LEDGER_CHANGED')
  return { mode: 'isolated-restore-rehearsal', productionReady: false, ledgerFingerprint: fingerprint,
    checkedAccounts: seen.size, replayVerified: issues.length === 0, keepIsolated: true, issues }
}
