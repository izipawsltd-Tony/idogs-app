import { readFile, writeFile } from 'node:fs/promises'
import { clients, dbName, fsUrl, ensure } from './managed-backup-prepare.mjs'
import { TARGET } from './managed-backup-preflight.mjs'
import { validateManifest, verifyRestoreOperation } from './managed-backup-continue.mjs'

// Metadata-only diagnosis after a partial cleanup. No write/delete/restore API.
try {
  const m = JSON.parse(await readFile('managed-backup-manifest.json', 'utf8'))
  validateManifest(m)
  const { api } = await clients()
  const result = { mode: 'read-only-cleanup-diagnosis', manifestNonce: m.nonce, sourceUid: m.sourceUid, destinationUid: m.destinationUid, productionReady: false, databases: {} }
  result.restoreOperation = await api(fsUrl(m.restoreOperation.name), { allow404: true })
  // Deleting a database can change availability of its old operations. Record
  // the actual metadata for diagnosis; this does not authorize any mutation or
  // relax the restore/replay gate used by the continuation workflow.
  try { verifyRestoreOperation(result.restoreOperation, m); result.restoreBindingVerified = true }
  catch (error) { result.restoreBindingVerified = false; result.restoreBindingError = error.code }
  for (const id of [TARGET.destination, TARGET.source]) {
    const metadata = await api(fsUrl(dbName(id)), { allow404: true })
    const operations = await api(fsUrl(`${dbName(id)}/operations?pageSize=100`), { allow404: true })
    ensure(!operations?.nextPageToken && !operations?.unreachable?.length, 'MANAGED_BACKUP_DIAGNOSIS_INCOMPLETE')
    result.databases[id] = { metadata, operations: operations?.operations || [] }
  }
  result.backup = await api(fsUrl(m.backupName), { allow404: true })
  result.schedule = await api(fsUrl(m.scheduleName), { allow404: true })
  await writeFile('managed-backup-diagnosis.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.log(JSON.stringify({ status: 'blocked', mode: 'read-only-cleanup-diagnosis', code: /^[A-Z_0-9]{3,80}$/.test(error.code || '') ? error.code : 'MANAGED_BACKUP_DIAGNOSIS_FAILED', productionReady: false }))
  process.exitCode = 2
}
