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
  result.cleanupOperations = {}
  result.canonicalCleanupOperations = {}
  result.deletedDatabaseMetadata = {}
  for (const id of [TARGET.destination, TARGET.source]) {
    const saved = m.cleanupOperations?.[id]
    if (!saved?.operation?.name) continue
    const uid = id === TARGET.source ? m.sourceUid : m.destinationUid
    ensure([dbName(id), `projects/${TARGET.projectId}/databases/${uid}`].some(base => saved.operation.name.startsWith(`${base}/operations/`)), 'MANAGED_BACKUP_DIAGNOSIS_OPERATION_SCOPE')
    result.cleanupOperations[id] = await api(fsUrl(saved.operation.name), { allow404: true })
    const canonical = `projects/${TARGET.projectId}/databases/${uid}`
    const suffix = saved.operation.name.split('/operations/')[1]
    ensure(/^[A-Za-z0-9_-]+$/.test(suffix || ''), 'MANAGED_BACKUP_DIAGNOSIS_OPERATION_SCOPE')
    result.canonicalCleanupOperations[id] = await api(fsUrl(`${canonical}/operations/${suffix}`), { allow404: true })
    result.deletedDatabaseMetadata[id] = await api(fsUrl(canonical), { allow404: true })
  }
  await writeFile('managed-backup-diagnosis.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.log(JSON.stringify({ status: 'blocked', mode: 'read-only-cleanup-diagnosis', code: /^[A-Z_0-9]{3,80}$/.test(error.code || '') ? error.code : 'MANAGED_BACKUP_DIAGNOSIS_FAILED', productionReady: false }))
  process.exitCode = 2
}
