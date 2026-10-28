import test from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest, verifyBackup, verifyRestoreOperation, continueBackup } from './qa/managed-backup-continue.mjs'
import { TARGET } from './qa/managed-backup-preflight.mjs'
const fixture = () => {
  const m = { schema: 1, ...TARGET, ownerApproval: '2026-10-28-two-databases-one-backup', nonce: '12345678-1234-1234-1234-123456789abc', sourceUid: 'immutable-source', createdAt: '2026-10-28T06:30:00Z', scheduleName: `projects/${TARGET.projectId}/databases/${TARGET.source}/backupSchedules/one` }
  m.records = [
    { id: 'deleted-profile', data: { synthetic: true, nonce: m.nonce, owner: 'qa-deleted', content: 'Synthetic profile' } },
    { id: 'deleted-document', data: { synthetic: true, nonce: m.nonce, owner: 'qa-deleted', content: 'Synthetic document' } },
    { id: 'foreign-sentinel', data: { synthetic: true, nonce: m.nonce, owner: 'qa-other', content: 'Preserve this sentinel' } },
  ]
  const b = { name: `projects/${TARGET.projectId}/locations/${TARGET.location}/backups/one`, database: `projects/${TARGET.projectId}/databases/${TARGET.source}`, databaseUid: m.sourceUid, state: 'READY', snapshotTime: '2026-10-28T07:00:00Z' }
  return { m, b }
}
test('accepts only exact approved manifest and synthetic contents', () => {
  const { m } = fixture(); validateManifest(m)
  for (const change of [{ projectId: 'idogs-app' }, { source: 'idogs-deletion-qa' }, { destination: '(default)' }, { ownerApproval: 'other' }, { sourceUid: '' }]) assert.throws(() => validateManifest({ ...m, ...change }), /MANIFEST_INVALID/)
  m.records[0].data.synthetic = false
  assert.throws(() => validateManifest(m), /FIXTURE_CHANGED/)
})
test('rejects backup from wrong database generation, region, time or readiness', () => {
  const { m, b } = fixture(); verifyBackup(b, m)
  for (const change of [{ databaseUid: 'replaced' }, { database: 'projects/idogs-app/databases/(default)' }, { name: 'projects/idogs-app-staging/locations/us-central1/backups/one' }, { state: 'CREATING' }, { snapshotTime: '2026-10-27T00:00:00Z' }]) assert.throws(() => verifyBackup({ ...b, ...change }, m), /IDENTITY_MISMATCH/)
})
test('invalid manifest fails before any cloud access', async () => {
  let calls = 0
  await assert.rejects(continueBackup({ manifest: {}, api: async () => { calls++ } }), /MANIFEST_INVALID/)
  assert.equal(calls, 0)
})
test('replaced source database stops before data access or destructive operations', async () => {
  const { m } = fixture(); let dataRead = false
  await assert.rejects(continueBackup({ manifest: m,
    api: async () => ({ name: `projects/${TARGET.projectId}/databases/${TARGET.source}`, locationId: TARGET.location, databaseEdition: 'STANDARD', type: 'FIRESTORE_NATIVE', uid: 'replaced' }),
    db: () => { dataRead = true } }), /SOURCE_REPLACED/)
  assert.equal(dataRead, false)
})

function cloudFixture({ ready = true, corruptRestore = false, restorePending = false } = {}) {
  const { m, b } = fixture(), calls = [], saved = []
  const initial = new Map(m.records.map(r => [r.id, structuredClone(r.data)]))
  initial.set('manifest', { synthetic: true, nonce: m.nonce, approval: m.ownerApproval, sourceUid: m.sourceUid })
  const stores = new Map([[TARGET.source, structuredClone(initial)]])
  const metadata = id => ({ name: `projects/${TARGET.projectId}/databases/${id}`, locationId: TARGET.location, databaseEdition: 'STANDARD', type: 'FIRESTORE_NATIVE', uid: id === TARGET.source ? m.sourceUid : 'restored-uid', etag: 'etag-1', deleteProtectionState: 'DELETE_PROTECTION_DISABLED' })
  let schedule = true, backup = true, targetRelease = false
  const ref = (id, path) => ({ path, id: path.split('/')[1], listCollections: async () => [] })
  const db = id => ({
    listCollections: async () => [{ id: 'managedBackupQa' }],
    doc: path => ref(id, path),
    collection: () => ({ limit: () => ({ get: async () => {
      const docs = [...stores.get(id)].map(([key, value]) => ({ id: key, ref: ref(id, `managedBackupQa/${key}`), data: () => structuredClone(value) }))
      return { size: docs.length, docs }
    } }) }),
    runTransaction: async fn => {
      const writes = []
      await fn({ get: async r => ({ data: () => structuredClone(stores.get(id).get(r.id)) }),
        delete: r => writes.push(() => stores.get(id).delete(r.id)),
        create: (r, data) => { assert.ok(!stores.get(id).has(r.id)); writes.push(() => stores.get(id).set(r.id, structuredClone(data))) } })
      for (const apply of writes) apply()
    },
  })
  const rs = `projects/${TARGET.projectId}/rulesets/existing`
  const api = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/backups')) return { backups: backup ? [{ ...b, state: ready ? 'READY' : 'CREATING' }] : [] }
    if (url.endsWith('/backups/one')) { if (options.method === 'DELETE') { backup = false; return {} } return backup ? b : null }
    if (url.endsWith('/backupSchedules/one')) { if (options.method === 'DELETE') { schedule = false; return {} } return schedule ? { name: m.scheduleName, retention: '604800s', dailyRecurrence: {} } : null }
    if (url.endsWith('/releases/cloud.firestore/idogs-deletion-qa')) return { rulesetName: rs }
    if (url.endsWith('/rulesets/existing')) {
      const { QA_DENY_RULES } = await import('./qa/provision-deletion-resources.mjs')
      return { source: { files: [{ content: QA_DENY_RULES }] } }
    }
    if (url.endsWith(':test')) return { testResults: options.body.testSuite.testCases.map(() => ({ state: 'SUCCESS' })) }
    if (url.endsWith('/releases')) { targetRelease = true; return {} }
    if (url.includes('/releases/cloud.firestore/')) return targetRelease ? { rulesetName: rs } : null
    if (url.endsWith('/databases:restore')) {
      assert.equal(options.body.backup, b.name)
      assert.equal(options.body.databaseId, TARGET.destination)
      stores.set(TARGET.destination, structuredClone(initial))
      if (corruptRestore) stores.get(TARGET.destination).get('foreign-sentinel').content = 'Changed by another actor'
      return { name: `projects/${TARGET.projectId}/databases/${TARGET.destination}/operations/restore` }
    }
    if (url.endsWith('/operations/restore')) return { name: `projects/${TARGET.projectId}/databases/${TARGET.destination}/operations/restore`, done: !restorePending,
      metadata: { '@type': 'type.googleapis.com/google.firestore.admin.v1.RestoreDatabaseMetadata', database: `projects/${TARGET.projectId}/databases/${TARGET.destination}`, backup: b.name }, response: metadata(TARGET.destination) }
    if (url.includes('/operations/')) return { done: true }
    for (const id of [TARGET.source, TARGET.destination]) if (url.includes(`/databases/${id}`)) {
      if (options.method === 'DELETE') { assert.match(url, /etag=etag-1/); stores.delete(id); return { name: `projects/${TARGET.projectId}/databases/${id}/operations/delete` } }
      return stores.has(id) ? metadata(id) : null
    }
    throw new Error('Unexpected fake cloud request')
  }
  return { manifest: m, api, db, calls, stores, saved, clock: () => Date.parse('2026-10-28T08:00:00Z'), save: async value => saved.push(structuredClone(value)) }
}
test('pending backup performs no cloud mutations and never invents completion', async () => {
  const f = cloudFixture({ ready: false }), result = await continueBackup(f)
  assert.equal(result.status, 'waiting_for_managed_backup')
  assert.equal(result.managedBackupRestoreVerified, false)
  assert.ok(f.calls.every(c => !c.options.method))
  assert.equal(f.stores.size, 1)
})
test('pending backup stops its exact schedule before grant expiry without renewing IAM or claiming cleanup', async () => {
  const f = cloudFixture({ ready: false }); f.clock = () => Date.parse('2026-10-29T05:24:03Z')
  const result = await continueBackup(f)
  assert.equal(result.code, 'MANAGED_BACKUP_GRANT_EXPIRY_APPROACHING')
  assert.equal(result.scheduleRemoved, true)
  assert.equal(result.resourcesRemain, true)
  assert.equal(result.managedBackupRestoreVerified, false)
  assert.equal(f.calls.filter(c => c.options.method === 'DELETE').length, 1)
  assert.ok(f.calls.find(c => c.options.method === 'DELETE').url.endsWith('/backupSchedules/one'))
})
test('real control flow blocks restored deleted data, replays exact removal, preserves sentinel and cleans only pinned resources', async () => {
  const f = cloudFixture(), result = await continueBackup(f)
  assert.equal(result.status, 'managed_backup_rehearsal_pass')
  assert.equal(result.managedBackupResurrectionBlocked, true)
  assert.equal(result.managedBackupRestoreVerified, true)
  assert.equal(result.cleanupVerified, true)
  assert.equal(result.productionReady, false)
  assert.equal(f.stores.size, 0)
  assert.ok(f.calls.filter(c => c.options.method === 'DELETE').every(c => c.url.includes(TARGET.source) || c.url.includes(TARGET.destination) || c.url.endsWith('/backups/one')))
  assert.equal(f.saved.at(-1).cleanupVerified, true)
})
test('changed restored sentinel blocks replay and all database/backup deletion', async () => {
  const f = cloudFixture({ corruptRestore: true })
  await assert.rejects(continueBackup(f), /CONTENT_PRECONDITION_FAILED/)
  assert.equal(f.stores.size, 2)
  assert.ok(!f.calls.some(c => c.options.method === 'DELETE' && !c.url.includes('/backupSchedules/')))
})
test('pending managed restore persists the exact operation and resumes it without starting a second restore', async () => {
  const f = cloudFixture({ restorePending: true }), first = await continueBackup(f)
  assert.equal(first.status, 'waiting_for_managed_restore')
  assert.equal(first.managedBackupRestoreVerified, false)
  assert.equal(f.manifest.destinationUid, 'restored-uid')
  const second = await continueBackup(f)
  assert.equal(second.status, 'waiting_for_managed_restore')
  assert.equal(f.calls.filter(c => c.url.endsWith('/databases:restore')).length, 1)
  assert.ok(!f.calls.some(c => c.options.method === 'DELETE' && !c.url.includes('/backupSchedules/')))
})
test('rejects a saved restore operation whose real database, backup or immutable UID binding differs', () => {
  const { m, b } = fixture()
  m.backupName = b.name; m.destinationUid = 'target-uid'; m.restoreOperation = { name: `projects/${TARGET.projectId}/databases/${TARGET.destination}/operations/one` }
  const op = { name: m.restoreOperation.name, metadata: { '@type': 'type.googleapis.com/google.firestore.admin.v1.RestoreDatabaseMetadata', database: `projects/${TARGET.projectId}/databases/${TARGET.destination}`, backup: b.name }, response: { uid: 'target-uid' } }
  verifyRestoreOperation(op, m)
  for (const metadata of [{ ...op.metadata, backup: 'other' }, { ...op.metadata, database: 'other' }, {}]) assert.throws(() => verifyRestoreOperation({ ...op, metadata }, m), /RESTORE_OPERATION_CHANGED/)
  assert.throws(() => verifyRestoreOperation({ ...op, response: { uid: 'replacement' } }, m), /DESTINATION_REPLACED/)
  delete m.destinationUid; m.restoreOperation.response = { uid: 'target-uid' }
  assert.throws(() => verifyRestoreOperation({ ...op, response: { uid: 'replacement' } }, m), /DESTINATION_REPLACED/)
})
