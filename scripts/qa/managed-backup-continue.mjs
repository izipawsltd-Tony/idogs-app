import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { clients, ensure, fsUrl, dbName, verifyDatabase, denyClients, operation } from './managed-backup-prepare.mjs'
import { TARGET } from './managed-backup-preflight.mjs'
import { digest } from '../../api/_lib/deletion-plan.js'
import { assessIsolatedDeletionRestore } from '../../api/_lib/deletion-restore-gate.js'

export function validateManifest(m) {
  ensure(m?.schema === 1 && m.ownerApproval === '2026-10-28-two-databases-one-backup'
    && Object.entries(TARGET).every(([k, v]) => m[k] === v)
    && /^[0-9a-f-]{36}$/.test(m.nonce || '') && typeof m.sourceUid === 'string' && m.sourceUid
    && m.scheduleName?.startsWith(`${dbName(TARGET.source)}/backupSchedules/`), 'MANAGED_BACKUP_MANIFEST_INVALID')
  const expected = [
    { id: 'deleted-profile', data: { synthetic: true, nonce: m.nonce, owner: 'qa-deleted', content: 'Synthetic profile' } },
    { id: 'deleted-document', data: { synthetic: true, nonce: m.nonce, owner: 'qa-deleted', content: 'Synthetic document' } },
    { id: 'foreign-sentinel', data: { synthetic: true, nonce: m.nonce, owner: 'qa-other', content: 'Preserve this sentinel' } },
  ]
  ensure(digest(m.records) === digest(expected), 'MANAGED_BACKUP_FIXTURE_CHANGED')
}
export function verifyBackup(b, m) {
  ensure(b?.database === dbName(TARGET.source) && b.databaseUid === m.sourceUid
    && b.name?.startsWith(`projects/${TARGET.projectId}/locations/${TARGET.location}/backups/`)
    && b.state === 'READY' && Number.isFinite(Date.parse(b.snapshotTime))
    && Date.parse(b.snapshotTime) >= Date.parse(m.createdAt), 'MANAGED_BACKUP_IDENTITY_MISMATCH')
}
export function verifyRestoreOperation(op, m) {
  ensure(op?.name === m.restoreOperation?.name
    && op.name.startsWith(`${dbName(TARGET.destination)}/operations/`)
    && op.metadata?.['@type'] === 'type.googleapis.com/google.firestore.admin.v1.RestoreDatabaseMetadata'
    && op.metadata.database === dbName(TARGET.destination) && op.metadata.backup === m.backupName,
  'MANAGED_BACKUP_RESTORE_OPERATION_CHANGED')
  ensure(!op.error, 'MANAGED_BACKUP_OPERATION_FAILED')
  const boundUid = m.destinationUid || m.restoreOperation?.response?.uid
  if (boundUid && op.response?.uid) ensure(op.response.uid === boundUid, 'MANAGED_BACKUP_DESTINATION_REPLACED')
}
async function inventory(db, m, { deleted = false, tombstone = false } = {}) {
  const collections = await db.listCollections()
  ensure(collections.length === 1 && collections[0].id === 'managedBackupQa', 'MANAGED_BACKUP_FOREIGN_COLLECTION')
  const snapshot = await db.collection('managedBackupQa').limit(11).get()
  const expected = new Map(m.records.filter(r => !deleted || r.id === 'foreign-sentinel').map(r => [r.id, r.data]))
  expected.set('manifest', { synthetic: true, nonce: m.nonce, approval: m.ownerApproval, sourceUid: m.sourceUid })
  if (tombstone) expected.set('tombstone', { synthetic: true, nonce: m.nonce, revision: 1, state: 'completed' })
  ensure(snapshot.size === expected.size && snapshot.docs.every(d => expected.has(d.id) && digest(d.data()) === digest(expected.get(d.id))), 'MANAGED_BACKUP_CONTENT_PRECONDITION_FAILED')
  for (const doc of snapshot.docs) ensure((await doc.ref.listCollections()).length === 0, 'MANAGED_BACKUP_NESTED_CONTENT')
  return snapshot
}
export async function continueBackup({ api, db, manifest: m, save, report = {}, clock = Date.now }) {
  validateManifest(m)
  const sourceMetadata = await api(fsUrl(dbName(TARGET.source)))
  verifyDatabase(sourceMetadata, TARGET.source)
  ensure(sourceMetadata.uid === m.sourceUid, 'MANAGED_BACKUP_SOURCE_REPLACED')
  const source = db(TARGET.source)
  await inventory(source, m, { deleted: m.sourceDeleted === true })
  const listed = await api(fsUrl(`projects/${TARGET.projectId}/locations/${TARGET.location}/backups`))
  ensure(!listed.nextPageToken, 'MANAGED_BACKUP_LIST_INCOMPLETE')
  const backups = (listed.backups || []).filter(b => b.database === dbName(TARGET.source))
  ensure(backups.length <= 1, 'MANAGED_BACKUP_MULTIPLE_COPIES')
  if (!backups.length || backups[0].state !== 'READY') {
    // The owner approved one 24-hour grant, not automatic renewal. Stop the
    // schedule one hour before expiry if Google has not produced a usable copy.
    const now = clock()
    ensure(Number.isFinite(now), 'MANAGED_BACKUP_CLOCK_INVALID')
    if (now >= Date.parse('2026-10-29T06:24:03Z') - 3600000) {
      const schedule = await api(fsUrl(m.scheduleName), { allow404: true })
      if (schedule) {
        ensure(schedule.name === m.scheduleName && schedule.retention === '604800s' && schedule.dailyRecurrence, 'MANAGED_BACKUP_SCHEDULE_CHANGED')
        await api(fsUrl(m.scheduleName), { method: 'DELETE' })
        ensure(await api(fsUrl(m.scheduleName), { allow404: true }) === null, 'MANAGED_BACKUP_SCHEDULE_REMAINS')
      }
      m.scheduleStoppedBeforeGrantExpiry = true; await save(m)
      return { status: 'owner_gate', code: 'MANAGED_BACKUP_GRANT_EXPIRY_APPROACHING', scheduleRemoved: true, resourcesRemain: true, managedBackupRestoreVerified: false, productionReady: false }
    }
    return { status: 'waiting_for_managed_backup', managedBackupRestoreVerified: false, productionReady: false }
  }
  const backup = backups[0]; verifyBackup(backup, m)
  if (m.backupName) ensure(m.backupName === backup.name, 'MANAGED_BACKUP_SELECTION_CHANGED')
  m.backupName = backup.name; await save(m)
  const schedule = await api(fsUrl(m.scheduleName), { allow404: true })
  if (schedule) {
    ensure(schedule.name === m.scheduleName && schedule.retention === '604800s' && schedule.dailyRecurrence, 'MANAGED_BACKUP_SCHEDULE_CHANGED')
    await api(fsUrl(m.scheduleName), { method: 'DELETE' })
    ensure(await api(fsUrl(m.scheduleName), { allow404: true }) === null, 'MANAGED_BACKUP_SCHEDULE_REMAINS')
  }
  report.scheduleRemoved = true
  // Deletion happens AFTER the snapshot. This ledger is stored in the workflow
  // artifact outside both databases, not reconstructed from restored content.
  if (!m.sourceDeleted) {
    m.ledger = { independentOfRestore: true, complete: true, revision: m.nonce,
      accounts: [{ uid: 'qa-deleted', revision: 1, state: 'completed', retained: [] }] }
    await save(m)
    await source.runTransaction(async tx => {
      for (const r of m.records.slice(0, 2)) ensure(digest((await tx.get(source.doc(`managedBackupQa/${r.id}`))).data()) === digest(r.data), 'MANAGED_BACKUP_DELETE_PRECONDITION')
      for (const r of m.records.slice(0, 2)) tx.delete(source.doc(`managedBackupQa/${r.id}`))
    })
    m.sourceDeleted = true; await save(m)
  }
  ensure(digest(m.ledger) === digest({ independentOfRestore: true, complete: true, revision: m.nonce, accounts: [{ uid: 'qa-deleted', revision: 1, state: 'completed', retained: [] }] }), 'MANAGED_BACKUP_LEDGER_CHANGED')
  await inventory(source, m, { deleted: true })
  report.phase = 'restore_managed_backup'
  const prior = await api(fsUrl(dbName(TARGET.destination)), { allow404: true })
  if (!m.restoreOperation) {
    ensure(prior === null, 'MANAGED_BACKUP_DESTINATION_EXISTS')
    // Install verified deny-all release BEFORE restore creates the destination.
    await denyClients(api, TARGET.destination)
    const op = await api(fsUrl(`projects/${TARGET.projectId}/databases:restore`), { method: 'POST', body: { databaseId: TARGET.destination, backup: backup.name } })
    m.restoreOperation = op; await save(m)
  }
  // Google restore is asynchronous. Re-read the exact saved operation and its
  // database/backup binding; a provider wait is not a failed rehearsal and must
  // never cause a second restore request or a replacement fixture.
  const restoreStatus = await api(fsUrl(m.restoreOperation.name))
  verifyRestoreOperation(restoreStatus, m)
  if (!m.destinationUid && m.restoreOperation.response?.uid) m.destinationUid = m.restoreOperation.response.uid
  m.restoreOperation = restoreStatus
  if (restoreStatus.response?.uid) m.destinationUid = restoreStatus.response.uid
  await save(m)
  if (!restoreStatus.done) return { ...report, status: 'waiting_for_managed_restore',
    restoreOperation: restoreStatus.name, managedBackupRestoreVerified: false, productionReady: false }
  const targetMetadata = await api(fsUrl(dbName(TARGET.destination)))
  verifyDatabase(targetMetadata, TARGET.destination)
  if (m.destinationUid) ensure(m.destinationUid === targetMetadata.uid, 'MANAGED_BACKUP_DESTINATION_REPLACED')
  m.destinationUid = targetMetadata.uid; await save(m)
  await denyClients(api, TARGET.destination)
  const destination = db(TARGET.destination)
  await inventory(destination, m)
  const inspect = async () => {
    const snapshot = await destination.collection('managedBackupQa').limit(11).get()
    return { complete: true, auth: { state: 'absent' }, lock: snapshot.docs.find(d => d.id === 'tombstone')?.data(),
      records: snapshot.docs.filter(d => d.data().owner === 'qa-deleted').map(d => ({ path: d.ref.path, dataHash: digest(d.data()) })) }
  }
  const check = () => assessIsolatedDeletionRestore({ target: { projectId: TARGET.projectId, databaseId: TARGET.destination, rehearsal: 'managed-backup', isolated: true, publicAccess: false }, readLedger: async () => structuredClone(m.ledger), inspectRestoredAccount: inspect })
  const blocked = await check()
  ensure(!blocked.replayVerified && blocked.issues.filter(i => i.code === 'restored_account_data').length === 2
    && blocked.issues.some(i => i.code === 'restore_tombstone_missing_or_changed'), 'MANAGED_BACKUP_QUARANTINE_NOT_BLOCKED')
  report.managedBackupResurrectionBlocked = true
  await destination.runTransaction(async tx => {
    for (const r of m.records.slice(0, 2)) ensure(digest((await tx.get(destination.doc(`managedBackupQa/${r.id}`))).data()) === digest(r.data), 'MANAGED_BACKUP_REPLAY_PRECONDITION')
    for (const r of m.records.slice(0, 2)) tx.delete(destination.doc(`managedBackupQa/${r.id}`))
    tx.create(destination.doc('managedBackupQa/tombstone'), { synthetic: true, nonce: m.nonce, revision: 1, state: 'completed' })
  })
  await inventory(destination, m, { deleted: true, tombstone: true })
  ensure((await check()).replayVerified, 'MANAGED_BACKUP_REPLAY_UNVERIFIED')
  report.managedBackupRestoreVerified = true
  // Cleanup exact immutable database identities only, with content and etag guards.
  report.phase = 'cleanup'
  for (const id of [TARGET.destination, TARGET.source]) {
    const metadata = await api(fsUrl(dbName(id)))
    verifyDatabase(metadata, id)
    ensure(metadata.uid === (id === TARGET.source ? m.sourceUid : m.destinationUid) && metadata.etag
      && metadata.deleteProtectionState === 'DELETE_PROTECTION_DISABLED', 'MANAGED_BACKUP_CLEANUP_IDENTITY_CHANGED')
    await inventory(db(id), m, { deleted: true, tombstone: id === TARGET.destination })
    await operation(api, await api(fsUrl(`${dbName(id)}?etag=${encodeURIComponent(metadata.etag)}`), { method: 'DELETE' }))
    ensure(await api(fsUrl(dbName(id)), { allow404: true }) === null, 'MANAGED_BACKUP_DATABASE_REMAINS')
  }
  verifyBackup(await api(fsUrl(backup.name)), m)
  await api(fsUrl(backup.name), { method: 'DELETE' })
  ensure(await api(fsUrl(backup.name), { allow404: true }) === null, 'MANAGED_BACKUP_COPY_REMAINS')
  m.cleanupVerified = true; await save(m)
  return { ...report, status: 'managed_backup_rehearsal_pass', cleanupVerified: true, productionReady: false }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = { productionReady: false }
  try {
    const manifest = JSON.parse(await readFile('managed-backup-manifest.json', 'utf8'))
    const runtime = await clients()
    const result = await continueBackup({ ...runtime, manifest, report, save: m => writeFile('managed-backup-manifest.json', JSON.stringify(m, null, 2)) })
    console.log(JSON.stringify(result, null, 2))
    if (result.status === 'owner_gate') process.exitCode = 2
  } catch (error) { console.log(JSON.stringify({ ...report, status: 'blocked', code: /^[A-Z_0-9]{3,80}$/.test(error.code || '') ? error.code : 'MANAGED_BACKUP_CONTINUE_FAILED' })); process.exitCode = 2 }
}
