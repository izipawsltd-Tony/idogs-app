import test from 'node:test'
import assert from 'node:assert/strict'
import { preflight, REQUIRED, TARGET } from './qa/managed-backup-preflight.mjs'

function fixture({ missing = [], existing = false, billing = true, edition = 'STANDARD', project = TARGET.projectId } = {}) {
  const calls = []
  const api = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith(':testIamPermissions')) return { permissions: REQUIRED.filter(x => !missing.includes(x)) }
    if (url.endsWith('/billingInfo')) return { projectId: TARGET.projectId, billingEnabled: billing }
    if (url.endsWith('/databases/idogs-deletion-qa')) return { name: `projects/${TARGET.projectId}/databases/idogs-deletion-qa`, locationId: TARGET.location, type: 'FIRESTORE_NATIVE', databaseEdition: edition }
    if (url.includes('/databases/')) return existing ? { name: 'existing' } : null
    return { projectId: project, projectNumber: TARGET.projectNumber, lifecycleState: 'ACTIVE' }
  }
  return { calls, api }
}
test('reports missing privileges without attempting provisioning or billing changes', async () => {
  const f = fixture({ missing: ['datastore.databases.create', 'datastore.backups.restoreDatabase'] })
  const result = await preflight(f)
  assert.deepEqual(result.missingPermissions, ['datastore.databases.create', 'datastore.backups.restoreDatabase'])
  assert.equal(result.resourcesCreated, false)
  assert.equal(result.status, 'owner_gate')
  assert.ok(f.calls.every(c => !c.options.method || (c.options.method === 'POST' && c.url.endsWith(':testIamPermissions'))))
})
test('checks billing and both absent exact destinations but never creates resources', async () => {
  const f = fixture(), result = await preflight(f)
  assert.equal(result.status, 'preflight_pass')
  assert.equal(result.billingVerified, true)
  assert.equal(result.productionReady, false)
  assert.equal(f.calls.filter(c => c.options.allow404).length, 2)
  assert.ok(f.calls.every(c => c.url.includes(TARGET.projectId)))
})
test('fails on either pre-existing destination', async () => {
  await assert.rejects(preflight(fixture({ existing: true })), /BACKUP_QA_DATABASE_ALREADY_EXISTS/)
})
test('fails when billing is disabled', async () => {
  await assert.rejects(preflight(fixture({ billing: false })), /BACKUP_QA_BILLING_UNVERIFIED/)
})
test('fails on a mismatched project before permission checks', async () => {
  const f = fixture({ project: 'idogs-app' })
  await assert.rejects(preflight(f), /BACKUP_QA_PROJECT_MISMATCH/)
  assert.equal(f.calls.length, 1)
})
test('fails on unexpected edition before permission checks', async () => {
  const f = fixture({ edition: 'ENTERPRISE' })
  await assert.rejects(preflight(f), /BACKUP_QA_EDITION_MISMATCH/)
  assert.equal(f.calls.length, 2)
})
