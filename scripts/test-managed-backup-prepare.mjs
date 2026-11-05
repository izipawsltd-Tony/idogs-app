import test from 'node:test'
import assert from 'node:assert/strict'
import { prepare, verifyDatabase, dbName } from './qa/managed-backup-prepare.mjs'
import { TARGET, REQUIRED } from './qa/managed-backup-preflight.mjs'
import { QA_DENY_RULES } from './qa/provision-deletion-resources.mjs'

function fixture({ missing = [], wrongRules = false, nonempty = false } = {}) {
  const calls = [], saved = [], written = []
  let created = false, release = false
  const metadata = { name: dbName(TARGET.source), uid: 'synthetic-source-uid', locationId: TARGET.location, type: 'FIRESTORE_NATIVE', databaseEdition: 'STANDARD' }
  const rs = `projects/${TARGET.projectId}/rulesets/existing-deny`
  const api = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith(':testIamPermissions')) return { permissions: REQUIRED.filter(p => !missing.includes(p)) }
    if (url.endsWith('/billingInfo')) return { projectId: TARGET.projectId, billingEnabled: true }
    if (url.endsWith('/databases/idogs-deletion-qa')) return { ...metadata, name: `projects/${TARGET.projectId}/databases/idogs-deletion-qa` }
    if (url.includes('/databases?')) { created = true; return { name: `${dbName(TARGET.source)}/operations/synthetic` } }
    if (url.includes('/operations/')) return { done: true, response: metadata }
    if (url.endsWith('/databases/' + TARGET.source)) return created ? metadata : null
    if (url.endsWith('/databases/' + TARGET.destination)) return null
    if (url.endsWith('/releases/cloud.firestore/idogs-deletion-qa')) return { rulesetName: rs }
    if (url.endsWith('/rulesets/existing-deny')) return { source: { files: [{ name: 'firestore.rules', content: wrongRules ? 'allow read: if true;' : QA_DENY_RULES }] } }
    if (url.endsWith(':test')) return { testResults: options.body.testSuite.testCases.map(() => ({ state: 'SUCCESS' })) }
    if (url.endsWith('/releases')) { release = true; return {} }
    if (url.includes('/releases/cloud.firestore/')) return release ? { rulesetName: rs } : null
    if (url.includes('/backupSchedules')) return { name: `${dbName(TARGET.source)}/backupSchedules/synthetic`, retention: '604800s', dailyRecurrence: {} }
    return { projectId: TARGET.projectId, projectNumber: TARGET.projectNumber, lifecycleState: 'ACTIVE' }
  }
  const db = id => {
    assert.equal(id, TARGET.source)
    return { listCollections: async () => nonempty ? ['unexpected'] : [], doc: path => path,
      batch: () => ({ create: (path, data) => written.push({ path, data }), commit: async () => {} }) }
  }
  return { api, db, calls, written, saved, save: async value => saved.push(structuredClone(value)) }
}
test('rejects every unapproved database target including original QA and default', () => {
  for (const id of ['(default)', 'idogs-deletion-qa', 'production', undefined]) assert.throws(() => dbName(id), /TARGET_FORBIDDEN/)
})
test('rejects wrong edition, region, identity and missing immutable UID', () => {
  const correct = { name: dbName(TARGET.source), uid: 'qa', databaseEdition: 'STANDARD', type: 'FIRESTORE_NATIVE', locationId: TARGET.location }
  for (const change of [{ uid: '' }, { name: 'other' }, { databaseEdition: 'ENTERPRISE' }, { locationId: 'us-central1' }]) assert.throws(() => verifyDatabase({ ...correct, ...change }, TARGET.source), /DATABASE_MISMATCH/)
})
test('missing cleanup permission stops before resources or a manifest are created', async () => {
  const f = fixture({ missing: ['datastore.databases.delete'] })
  await assert.rejects(prepare(f), /PERMISSIONS_MISSING/)
  assert.equal(f.saved.length, 0)
  assert.ok(!f.calls.some(c => c.url.includes('/databases?')))
})
test('wrong existing deny-all rules fail before synthetic data is seeded', async () => {
  const f = fixture({ wrongRules: true })
  await assert.rejects(prepare(f), /DENY_RULESET_CHANGED/)
  assert.equal(f.written.length, 0)
  assert.equal(f.saved.at(-1).resourcesCreated, true)
})
test('unexpected source content is never overwritten or backed up', async () => {
  const f = fixture({ nonempty: true })
  await assert.rejects(prepare(f), /SOURCE_NOT_EMPTY/)
  assert.equal(f.written.length, 0)
  assert.ok(!f.calls.some(c => c.url.endsWith('/backupSchedules')))
})
test('creates exactly four synthetic records and one seven-day schedule without touching original QA', async () => {
  const f = fixture(), result = await prepare(f)
  assert.equal(result.status, 'waiting_for_managed_backup')
  assert.equal(result.productionReady, false)
  assert.equal(result.managedBackupRestoreVerified, false)
  assert.equal(f.written.length, 4)
  assert.ok(f.written.every(r => r.data.synthetic && r.data.nonce === result.manifest.nonce))
  assert.equal(f.calls.filter(c => c.options.method === 'POST' && c.url.endsWith('/backupSchedules')).length, 1)
  assert.ok(f.calls.filter(c => c.options.method && c.options.method !== 'GET').every(c => !c.url.endsWith('/databases/idogs-deletion-qa') && !c.url.includes('/databases/(default)')))
  assert.equal(f.saved.at(-1).scheduleName, result.manifest.scheduleName)
})
