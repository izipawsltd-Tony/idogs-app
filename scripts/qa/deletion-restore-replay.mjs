import { assessIsolatedDeletionRestore } from '../../api/_lib/deletion-restore-gate.js'
import { digest, scanDeletionDocuments, containsDeletionIdentity } from '../../api/_lib/deletion-plan.js'

const ensure = (ok, code) => { if (!ok) throw new Error(code) }

// Controlled restore of exact disposable records, not a managed-backup restore.
// Deletion job/request/lock history is deliberately outside the restored subset.
export async function rehearseDeletedRecordRestore({ scope, manifest, records }) {
  const { db, auth, uid } = scope
  await scope.assertRuntime(uid)
  ensure(manifest.disposable === true && uid === manifest.uid && records.length === 2, 'QA_RESTORE_MANIFEST_REQUIRED')
  ensure(records.every(r => manifest.recordPaths.includes(r.path) && (r.path === `users/${uid}` || r.path.startsWith('dogs/'))), 'QA_RESTORE_SCOPE_REQUIRED')
  ensure(new Set(records.map(r => r.path)).size === records.length, 'QA_RESTORE_DUPLICATE_PATH')
  const loadLedger = async () => {
    await scope.assertRuntime(uid)
    const [request, job, lock] = await Promise.all(['accountDeletionRequests', 'accountDeletionJobs', 'accountDeletionLocks'].map(c => db.doc(`${c}/${uid}`).get()))
    ensure(request.data()?.status === 'completed' && job.data()?.stage === 'completed' && lock.data()?.state === 'completed', 'QA_RESTORE_COMPLETED_LEDGER_REQUIRED')
    ensure(digest(job.data().qaManifest) === digest(manifest), 'QA_RESTORE_LEDGER_BINDING_CHANGED')
    return { independentOfRestore: true, complete: true, revision: digest([request.data(), job.data(), lock.data()]),
      accounts: [{ uid, revision: job.data().revision, state: 'completed', retained: job.data().retained || [] }] }
  }
  const inspect = async id => {
    ensure(id === uid, 'QA_RESTORE_FOREIGN_UID')
    const inventory = await scanDeletionDocuments(db)
    ensure(!inventory.holds.length, 'QA_RESTORE_INVENTORY_HELD')
    let authState = 'absent'
    try { const user = await auth.getUser(uid); authState = user.disabled ? 'disabled' : 'enabled' }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error }
    const lock = (await db.doc(`accountDeletionLocks/${uid}`).get()).data()
    return { complete: true, auth: { state: authState }, lock,
      records: inventory.records.filter(r => r.path === `users/${uid}` || r.path.startsWith(`users/${uid}/`)
        || containsDeletionIdentity(r.data, uid, [digest(manifest.email.toLowerCase())]))
        .map(r => ({ path: r.path, dataHash: digest(r.data) })) }
  }
  const check = () => assessIsolatedDeletionRestore({ target: { projectId: db.projectId, databaseId: db.databaseId, isolated: true, publicAccess: false }, readLedger: loadLedger, inspectRestoredAccount: inspect })
  ensure((await check()).replayVerified, 'QA_RESTORE_BASELINE_UNVERIFIED')
  await db.runTransaction(async tx => {
    for (const record of records) ensure(!(await tx.get(db.doc(record.path))).exists, 'QA_RESTORE_RECORD_ALREADY_PRESENT')
    for (const record of records) tx.create(db.doc(record.path), record.data)
  })
  const blocked = await check()
  ensure(!blocked.replayVerified && blocked.issues.filter(i => i.code === 'restored_account_data').length === records.length, 'QA_RESTORE_RESURRECTION_NOT_BLOCKED')
  // Replay only the exact records introduced above, with content preconditions.
  await db.runTransaction(async tx => {
    for (const record of records) {
      const restored = await tx.get(db.doc(record.path))
      ensure(restored.exists && digest(restored.data()) === digest(record.data), 'QA_RESTORE_RECORD_CHANGED')
    }
    for (const record of records) tx.delete(db.doc(record.path))
  })
  const verified = await check()
  ensure(verified.replayVerified, 'QA_RESTORE_REPLAY_UNVERIFIED')
  return { controlledRecordRestoreBlocked: true, exactRecordReplayVerified: true,
    managedBackupRestoreVerified: false, productionReady: false, keepIsolated: true }
}
