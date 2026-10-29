import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { clients, ensure, fsUrl, dbName, verifyDatabase, denyClients } from './managed-backup-prepare.mjs'
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
  ensure([dbName(TARGET.source), `projects/${TARGET.projectId}/databases/${m.sourceUid}`].includes(b?.database) && b.databaseUid === m.sourceUid
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
export function cleanupReceipt(m) {
  return { nonce: m.nonce, sourceUid: m.sourceUid, destinationUid: m.destinationUid,
    backupName: m.backupName, restoreOperation: m.restoreOperation.name,
    managedBackupResurrectionBlocked: true, managedBackupRestoreVerified: true }
}
export function verifyDeletedRestore(actual, m) {
  const canonical = `projects/${TARGET.projectId}/databases/${m.destinationUid}`
  const suffix = m.restoreOperation.name.split('/operations/')[1]
  ensure(m.destinationUid && actual?.name === `${canonical}/operations/${suffix}` && actual.done === true && !actual.error
    && actual.metadata?.['@type'] === 'type.googleapis.com/google.firestore.admin.v1.RestoreDatabaseMetadata'
    && actual.metadata.database === canonical && actual.metadata.backup === m.backupName
    && actual.response?.uid === m.destinationUid && actual.response.previousId === TARGET.destination
    && actual.response.name === canonical && Number.isFinite(Date.parse(actual.response.deleteTime))
    && Date.parse(actual.response.deleteTime) >= Date.parse(actual.metadata.endTime)
    && actual.response.sourceInfo?.backup?.backup === m.backupName, 'MANAGED_BACKUP_DELETED_IDENTITY_UNVERIFIED')
}
export async function recoverVerifiedLegacyCleanup({ api, manifest: m, save, loadEvidence }) {
  validateManifest(m)
  // One diagnosed pre-receipt run only. Never infer replay success from missing
  // data or an operator-provided boolean; authenticate the exact historical job.
  ensure(m.nonce === '28944b70-51c1-401e-94f6-3a1e7692a60f'
    && m.sourceUid === 'e9cbde7b-2372-47eb-9000-1ccb7baf6ecf'
    && m.destinationUid === '7bfd4493-b0ae-4429-8861-3779aec1a253', 'MANAGED_BACKUP_LEGACY_SCOPE_MISMATCH')
  verifyRestoreOperation(m.restoreOperation, m)
  const { run, job, logs } = await loadEvidence()
  ensure(run.id === 40655659645 && run.head_sha === '942b2b17d03a55668fb97e978be06c58136e26e7'
    && run.head_branch === 'release/ios-app-store-20261025' && run.event === 'workflow_dispatch'
    && run.path === '.github/workflows/managed-backup-continue.yml' && run.status === 'completed'
    && job.id === 122705971553 && job.run_id === run.id && job.conclusion === 'failure'
    && typeof logs === 'string' && logs.split('\n').some(line => line.includes('"phase":"cleanup"')
      && line.includes('"managedBackupResurrectionBlocked":true') && line.includes('"managedBackupRestoreVerified":true')
      && line.includes('"code":"MANAGED_BACKUP_OPERATION_PENDING"') && line.includes('"productionReady":false')),
  'MANAGED_BACKUP_LEGACY_REPLAY_EVIDENCE_REQUIRED')
  const deleted = await api(fsUrl(m.restoreOperation.name))
  verifyDeletedRestore(deleted, m)
  ensure(await api(fsUrl(dbName(TARGET.destination)), { allow404: true }) === null, 'MANAGED_BACKUP_DELETED_DATABASE_REAPPEARED')
  m.replayReceipt = cleanupReceipt(m)
  m.cleanupOperations = { [TARGET.destination]: { uid: m.destinationUid, absenceVerified: true,
    historicalDeletionProof: { runId: run.id, jobId: job.id, deleteTime: deleted.response.deleteTime } } }
  await save(m)
}
export function verifyDeletedCleanup(metadata, saved, id, uid) {
  const canonical = `projects/${TARGET.projectId}/databases/${uid}`
  const initial = saved.operation?.response
  ensure(saved.uid === uid && saved.etag && initial?.uid === uid && initial.name === canonical
    && initial.previousId === id && Number.isFinite(Date.parse(initial.deleteTime))
    && metadata?.name === canonical && metadata.uid === uid && metadata.previousId === id
    && metadata.deleteTime === initial.deleteTime && metadata.createTime === initial.createTime
    && Number.isFinite(Date.parse(metadata.createTime)) && Date.parse(metadata.deleteTime) >= Date.parse(metadata.createTime)
    && metadata.databaseEdition === 'STANDARD' && metadata.locationId === TARGET.location
    && metadata.type === 'FIRESTORE_NATIVE', 'MANAGED_BACKUP_DELETED_CLEANUP_UNVERIFIED')
}
export async function cleanupBackup({ api, db, manifest: m, save, report = {} }) {
  validateManifest(m)
  ensure(m.destinationUid && m.backupName && m.restoreOperation?.done === true
    && digest(m.replayReceipt) === digest(cleanupReceipt(m)), 'MANAGED_BACKUP_REPLAY_RECEIPT_REQUIRED')
  verifyRestoreOperation(m.restoreOperation, m)
  ensure(await api(fsUrl(m.scheduleName), { allow404: true }) === null, 'MANAGED_BACKUP_SCHEDULE_REMAINS')
  m.cleanupOperations ||= {}
  const pending = () => ({ ...report, phase: 'cleanup', status: 'waiting_for_managed_cleanup',
    managedBackupResurrectionBlocked: true, managedBackupRestoreVerified: true, cleanupVerified: false, productionReady: false })
  for (const id of [TARGET.destination, TARGET.source]) {
    const uid = id === TARGET.source ? m.sourceUid : m.destinationUid
    let saved = m.cleanupOperations[id]
    if (saved?.historicalDeletionProof) {
      ensure(id === TARGET.destination && saved.uid === m.destinationUid && saved.historicalDeletionProof.runId === 40655659645
        && saved.historicalDeletionProof.jobId === 122705971553, 'MANAGED_BACKUP_LEGACY_SCOPE_MISMATCH')
      const deleted = await api(fsUrl(m.restoreOperation.name)); verifyDeletedRestore(deleted, m)
      ensure(deleted.response.deleteTime === saved.historicalDeletionProof.deleteTime
        && await api(fsUrl(dbName(id)), { allow404: true }) === null, 'MANAGED_BACKUP_DELETED_DATABASE_REAPPEARED')
      continue
    }
    if (!saved) {
      const metadata = await api(fsUrl(dbName(id)))
      verifyDatabase(metadata, id)
      ensure(metadata.uid === uid && metadata.etag && metadata.deleteProtectionState === 'DELETE_PROTECTION_DISABLED', 'MANAGED_BACKUP_CLEANUP_IDENTITY_CHANGED')
      await inventory(db(id), m, { deleted: true, tombstone: id === TARGET.destination })
      const operation = await api(fsUrl(`${dbName(id)}?etag=${encodeURIComponent(metadata.etag)}`), { method: 'DELETE' })
      ensure([dbName(id), `projects/${TARGET.projectId}/databases/${uid}`].some(base => operation.name?.startsWith(`${base}/operations/`)), 'MANAGED_BACKUP_CLEANUP_OPERATION_CHANGED')
      saved = { uid, etag: metadata.etag, operation }; m.cleanupOperations[id] = saved
      await save(m)
    }
    const canonicalBase = `projects/${TARGET.projectId}/databases/${uid}`
    const suffix = saved.operation?.name?.split('/operations/')[1]
    ensure(saved.uid === uid && /^[A-Za-z0-9_-]+$/.test(suffix || '')
      && [dbName(id), canonicalBase].some(base => saved.operation.name === `${base}/operations/${suffix}`), 'MANAGED_BACKUP_CLEANUP_OPERATION_CHANGED')
    // The public database ID stops resolving after deletion. Query the same
    // operation suffix through the already-verified immutable database UID.
    const actual = await api(fsUrl(`${canonicalBase}/operations/${suffix}`))
    if (![dbName(id), canonicalBase].some(base => actual.name === `${base}/operations/${suffix}`)) {
      // A changed operation identifier is not operation-completion evidence.
      // Independently prove deletion against the original DELETE response;
      // retain that response instead of overwriting its immutable identity.
      ensure(actual.done === true && !actual.error
        && actual.metadata?.['@type'] === 'type.googleapis.com/google.firestore.admin.v1.DeleteDatabaseMetadata', 'MANAGED_BACKUP_CLEANUP_OPERATION_CHANGED')
      const deleted = await api(fsUrl(canonicalBase))
      verifyDeletedCleanup(deleted, saved, id, uid)
      ensure(await api(fsUrl(dbName(id)), { allow404: true }) === null, 'MANAGED_BACKUP_DELETED_DATABASE_REAPPEARED')
      saved.deletedMetadataProof = { uid, previousId: id, deleteTime: deleted.deleteTime,
        createTime: deleted.createTime, operationIdentityVerified: false }
      saved.absenceVerified = true; await save(m)
      continue
    }
    ensure([dbName(id), canonicalBase].some(base => actual.name === `${base}/operations/${suffix}`) && !actual.error
      && (!actual.metadata?.['@type'] || actual.metadata['@type'] === 'type.googleapis.com/google.firestore.admin.v1.DeleteDatabaseMetadata'), 'MANAGED_BACKUP_CLEANUP_OPERATION_CHANGED')
    if (actual.response?.uid) ensure(actual.response.uid === uid
      && (!actual.response.previousId || actual.response.previousId === id), 'MANAGED_BACKUP_CLEANUP_IDENTITY_CHANGED')
    saved.operation = actual; await save(m)
    if (!actual.done) return pending()
    const remaining = await api(fsUrl(dbName(id)), { allow404: true })
    if (remaining) {
      ensure(remaining.uid === uid, 'MANAGED_BACKUP_CLEANUP_IDENTITY_CHANGED')
      return pending()
    }
    saved.absenceVerified = true; await save(m)
  }
  const backup = await api(fsUrl(m.backupName), { allow404: true })
  if (backup) {
    verifyBackup(backup, m)
    if (!m.backupDeleteRequested) {
      m.backupDeleteRequested = true; await save(m)
      await api(fsUrl(m.backupName), { method: 'DELETE' })
    }
    if (await api(fsUrl(m.backupName), { allow404: true })) return pending()
  } else ensure(m.backupDeleteRequested === true, 'MANAGED_BACKUP_UNEXPLAINED_BACKUP_ABSENCE')
  m.cleanupVerified = true; await save(m)
  return { ...report, status: 'managed_backup_rehearsal_pass', managedBackupResurrectionBlocked: true,
    managedBackupRestoreVerified: true, cleanupVerified: true, productionReady: false }
}
export async function continueBackup({ api, db, manifest: m, save, report = {}, clock = Date.now }) {
  validateManifest(m)
  if (m.replayReceipt) return cleanupBackup({ api, db, manifest: m, save, report })
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
  const inspect = async uid => {
    ensure(uid === 'qa-deleted', 'MANAGED_BACKUP_RESTORE_ACCOUNT_MISMATCH')
    const snapshot = await destination.collection('managedBackupQa').limit(11).get()
    return { uid, complete: true, auth: { state: 'absent' }, lock: snapshot.docs.find(d => d.id === 'tombstone')?.data(),
      records: snapshot.docs.filter(d => d.data().owner === 'qa-deleted').map(d => ({ path: d.ref.path, dataHash: digest(d.data()) })) }
  }
  const check = () => assessIsolatedDeletionRestore({ target: { projectId: TARGET.projectId, databaseId: TARGET.destination, rehearsal: 'managed-backup', isolated: true, publicAccess: false }, expectedAccounts: [{ uid: 'qa-deleted', revision: 1 }], readLedger: async () => structuredClone(m.ledger), inspectRestoredAccount: inspect })
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
  // Persist actual verified replay before destructive cleanup starts. Every
  // asynchronous delete operation is saved and resumed, never recreated.
  m.replayReceipt = cleanupReceipt(m); await save(m)
  report.phase = 'cleanup'
  return cleanupBackup({ api, db, manifest: m, save, report })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = { productionReady: false }
  try {
    const manifest = JSON.parse(await readFile('managed-backup-manifest.json', 'utf8'))
    const runtime = await clients()
    if (!manifest.replayReceipt && manifest.restoreOperation?.done === true && manifest.destinationUid === '7bfd4493-b0ae-4429-8861-3779aec1a253') {
      await recoverVerifiedLegacyCleanup({ ...runtime, manifest, save: m => writeFile('managed-backup-manifest.json', JSON.stringify(m, null, 2)), loadEvidence: async () => {
        ensure(process.env.GH_TOKEN, 'MANAGED_BACKUP_LEGACY_EVIDENCE_AUTH_REQUIRED')
        const get = async (path, raw = false) => {
          const response = await fetch(`https://api.github.com/repos/izipawsltd-Tony/idogs-app/${path}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) })
          ensure(response.ok, 'MANAGED_BACKUP_LEGACY_EVIDENCE_UNAVAILABLE')
          return raw ? response.text() : response.json()
        }
        const [run, job, logs] = await Promise.all([get('actions/runs/40655659645'), get('actions/jobs/122705971553'), get('actions/jobs/122705971553/logs', true)])
        return { run, job, logs }
      } })
    }
    const result = await continueBackup({ ...runtime, manifest, report, save: m => writeFile('managed-backup-manifest.json', JSON.stringify(m, null, 2)) })
    console.log(JSON.stringify(result, null, 2))
    if (result.status === 'owner_gate') process.exitCode = 2
  } catch (error) { console.log(JSON.stringify({ ...report, status: 'blocked', code: /^[A-Z_0-9]{3,80}$/.test(error.code || '') ? error.code : 'MANAGED_BACKUP_CONTINUE_FAILED' })); process.exitCode = 2 }
}
