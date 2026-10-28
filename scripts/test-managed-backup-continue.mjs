import test from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest, verifyBackup, continueBackup } from './qa/managed-backup-continue.mjs'
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
