import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { preflight, TARGET } from './managed-backup-preflight.mjs'
import { QA_DENY_RULES } from './provision-deletion-resources.mjs'

export const ensure = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }) }
export function verifyDatabase(db, id) {
  ensure([TARGET.source, TARGET.destination].includes(id), 'MANAGED_BACKUP_TARGET_FORBIDDEN')
  ensure(db?.name === `projects/${TARGET.projectId}/databases/${id}` && db.databaseEdition === 'STANDARD'
    && db.locationId === TARGET.location && db.type === 'FIRESTORE_NATIVE' && typeof db.uid === 'string' && db.uid.length > 0,
  'MANAGED_BACKUP_DATABASE_MISMATCH')
}
export async function clients(env = process.env) {
  ensure(env.IDOGS_MANAGED_BACKUP_APPROVAL === '2026-10-28-two-databases-one-backup', 'BACKUP_QA_APPROVAL_REQUIRED')
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GOOGLE_CLOUD_UNIVERSE_DOMAIN']) ensure(!env[key], 'BACKUP_QA_ENDPOINT_OVERRIDE')
  let credential
  try { credential = JSON.parse(env.IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON) } catch { throw Object.assign(new Error(), { code: 'STAGING_CREDENTIAL_REQUIRED' }) }
  ensure(credential.project_id === TARGET.projectId && credential.type === 'service_account'
    && credential.client_email === 'firebase-adminsdk-fbsvc@idogs-app-staging.iam.gserviceaccount.com', 'BACKUP_QA_CREDENTIAL_MISMATCH')
  const [{ cert }, { Firestore }] = await Promise.all([import('firebase-admin/app'), import('@google-cloud/firestore')])
  const auth = cert(credential)
  const api = async (url, { method = 'GET', body, allow404 = false } = {}) => {
    const token = await auth.getAccessToken()
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) })
    if (allow404 && response.status === 404) return null
    ensure(response.ok, `MANAGED_BACKUP_API_${response.status}`)
    return response.json()
  }
  return { api, db: id => { ensure([TARGET.source, TARGET.destination].includes(id), 'MANAGED_BACKUP_TARGET_FORBIDDEN'); return new Firestore({ projectId: TARGET.projectId, databaseId: id, credentials: credential }) } }
}
export const fsUrl = path => `https://firestore.googleapis.com/v1/${path}`
export const dbName = id => { ensure([TARGET.source, TARGET.destination].includes(id), 'MANAGED_BACKUP_TARGET_FORBIDDEN'); return `projects/${TARGET.projectId}/databases/${id}` }
export async function operation(api, op) {
  ensure(typeof op.name === 'string' && op.name.startsWith(`projects/${TARGET.projectId}/`) && op.name.includes('/operations/'), 'MANAGED_BACKUP_OPERATION_MISMATCH')
  for (let n = 0; n < 80; n++) {
    const result = await api(fsUrl(op.name))
    ensure(!result.error, 'MANAGED_BACKUP_OPERATION_FAILED')
    if (result.done) return result.response
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw Object.assign(new Error(), { code: 'MANAGED_BACKUP_OPERATION_PENDING' })
}
export async function denyClients(api, id) {
  const p = TARGET.projectId, prefix = `https://firebaserules.googleapis.com/v1/`
  dbName(id)
  // Reuse an existing verified deny-all ruleset, creating no extra ruleset.
  const existing = await api(`${prefix}projects/${p}/releases/cloud.firestore/idogs-deletion-qa`)
  ensure(existing.rulesetName?.startsWith(`projects/${p}/rulesets/`), 'MANAGED_BACKUP_DENY_RULESET_MISSING')
  const ruleset = await api(prefix + existing.rulesetName)
  ensure(ruleset.source?.files?.length === 1 && ruleset.source.files[0].content === QA_DENY_RULES, 'MANAGED_BACKUP_DENY_RULESET_CHANGED')
  const tests = ['get', 'list', 'create', 'update', 'delete'].flatMap(method => [undefined, { uid: 'synthetic-client' }].map(auth => ({ expectation: 'DENY', request: { method, path: `/databases/${id}/documents/managedBackupQa/probe`, ...(auth ? { auth } : {}) } })))
  const checked = await api(`${prefix}projects/${p}:test`, { method: 'POST', body: { source: ruleset.source, testSuite: { testCases: tests } } })
  ensure(checked.testResults?.length === tests.length && checked.testResults.every(t => t.state === 'SUCCESS'), 'MANAGED_BACKUP_DENY_TEST_FAILED')
  const name = `projects/${p}/releases/cloud.firestore/${id}`
  const previous = await api(prefix + name, { allow404: true })
  if (previous) ensure(previous.rulesetName === existing.rulesetName, 'MANAGED_BACKUP_FOREIGN_RELEASE')
  else await api(`${prefix}projects/${p}/releases`, { method: 'POST', body: { name, rulesetName: existing.rulesetName } })
  ensure((await api(prefix + name)).rulesetName === existing.rulesetName, 'MANAGED_BACKUP_DENY_READBACK_FAILED')
}

export async function prepare({ api, db, report = {}, save }) {
  const checked = await preflight({ api, report })
  ensure(checked.status === 'preflight_pass', 'BACKUP_QA_PERMISSIONS_MISSING')
  report.billingVerified = checked.billingVerified
  const manifest = { schema: 1, ownerApproval: '2026-10-28-two-databases-one-backup', ...TARGET, nonce: randomUUID(), createdAt: new Date().toISOString(), resourcesCreated: false }
  await save(manifest)
  report.phase = 'create_source'
  const op = await api(fsUrl(`projects/${TARGET.projectId}/databases?databaseId=${TARGET.source}`), { method: 'POST', body: { locationId: TARGET.location, type: 'FIRESTORE_NATIVE', databaseEdition: 'STANDARD', deleteProtectionState: 'DELETE_PROTECTION_DISABLED' } })
  manifest.resourcesCreated = true; report.resourcesCreated = true; await save(manifest)
  await operation(api, op)
  const metadata = await api(fsUrl(dbName(TARGET.source)))
  verifyDatabase(metadata, TARGET.source); manifest.sourceUid = metadata.uid; await save(manifest)
  report.phase = 'verify_client_isolation'
  await denyClients(api, TARGET.source)
  report.clientIsolationVerified = true
  const source = db(TARGET.source)
  ensure((await source.listCollections()).length === 0, 'MANAGED_BACKUP_SOURCE_NOT_EMPTY')
  manifest.records = [
    { id: 'deleted-profile', data: { synthetic: true, nonce: manifest.nonce, owner: 'qa-deleted', content: 'Synthetic profile' } },
    { id: 'deleted-document', data: { synthetic: true, nonce: manifest.nonce, owner: 'qa-deleted', content: 'Synthetic document' } },
    { id: 'foreign-sentinel', data: { synthetic: true, nonce: manifest.nonce, owner: 'qa-other', content: 'Preserve this sentinel' } },
  ]
  await save(manifest)
  const batch = source.batch()
  for (const record of manifest.records) batch.create(source.doc(`managedBackupQa/${record.id}`), record.data)
  batch.create(source.doc('managedBackupQa/manifest'), { synthetic: true, nonce: manifest.nonce, approval: manifest.ownerApproval, sourceUid: manifest.sourceUid })
  await batch.commit()
  report.syntheticRecords = 4
  report.phase = 'create_single_backup_schedule'
  const schedule = await api(fsUrl(`${dbName(TARGET.source)}/backupSchedules`), { method: 'POST', body: { retention: '604800s', dailyRecurrence: {} } })
  ensure(schedule.name?.startsWith(`${dbName(TARGET.source)}/backupSchedules/`), 'MANAGED_BACKUP_SCHEDULE_MISMATCH')
  manifest.scheduleName = schedule.name; await save(manifest)
  const readback = await api(fsUrl(schedule.name))
  ensure(readback.name === schedule.name && readback.retention === '604800s' && readback.dailyRecurrence, 'MANAGED_BACKUP_SCHEDULE_READBACK_FAILED')
  return { ...report, status: 'waiting_for_managed_backup', manifest, managedBackupRestoreVerified: false, productionReady: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = { resourcesCreated: false }
  try {
    const runtime = await clients()
    console.log(JSON.stringify(await prepare({ ...runtime, report, save: m => writeFile('managed-backup-manifest.json', JSON.stringify(m, null, 2)) }), null, 2))
  } catch (error) {
    console.log(JSON.stringify({ ...report, status: 'blocked', code: /^[A-Z_0-9]{3,80}$/.test(error.code || '') ? error.code : 'MANAGED_BACKUP_PREPARE_FAILED', productionReady: false }))
    process.exitCode = 2
  }
}
