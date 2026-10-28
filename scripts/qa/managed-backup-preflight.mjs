import { pathToFileURL } from 'node:url'

export const TARGET = Object.freeze({ projectId: 'idogs-app-staging', projectNumber: '530003937245', location: 'asia-southeast1', source: 'idogs-deletion-backup-qa', destination: 'idogs-deletion-restore-qa' })
export const REQUIRED = Object.freeze([
  'datastore.databases.create', 'datastore.databases.getMetadata', 'datastore.databases.delete',
  'datastore.locations.get', 'datastore.locations.list',
  'datastore.backups.get', 'datastore.backups.list', 'datastore.backups.delete', 'datastore.backups.restoreDatabase',
  'datastore.backupSchedules.create', 'datastore.backupSchedules.get', 'datastore.backupSchedules.list', 'datastore.backupSchedules.delete',
  'datastore.operations.get', 'datastore.entities.create', 'datastore.entities.get', 'datastore.entities.list', 'datastore.entities.delete',
  'firebaserules.rulesets.create', 'firebaserules.rulesets.get', 'firebaserules.rulesets.test',
  'firebaserules.releases.create', 'firebaserules.releases.get', 'firebaserules.releases.update',
])
const ensure = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }) }

// Read-only: validates permission/billing/identity before any resources exist.
export async function preflight({ api, report = {} }) {
  const p = TARGET.projectId
  const project = await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${p}`)
  ensure(project.projectId === p && String(project.projectNumber) === TARGET.projectNumber && project.lifecycleState === 'ACTIVE', 'BACKUP_QA_PROJECT_MISMATCH')
  report.projectVerified = true
  const baseline = await api(`https://firestore.googleapis.com/v1/projects/${p}/databases/idogs-deletion-qa`)
  ensure(baseline.name === `projects/${p}/databases/idogs-deletion-qa` && baseline.databaseEdition === 'STANDARD' && baseline.type === 'FIRESTORE_NATIVE' && baseline.locationId === TARGET.location, 'BACKUP_QA_EDITION_MISMATCH')
  report.editionVerified = true
  const result = await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${p}:testIamPermissions`, { method: 'POST', body: { permissions: REQUIRED } })
  report.missingPermissions = REQUIRED.filter(permission => !result.permissions?.includes(permission))
  // No IAM changes and no speculative provisioning when cleanup/isolation cannot run.
  if (report.missingPermissions.length) return { ...report, status: 'owner_gate', code: 'BACKUP_QA_PERMISSIONS_MISSING', resourcesCreated: false, productionReady: false }
  const billing = await api(`https://cloudbilling.googleapis.com/v1/projects/${p}/billingInfo`)
  ensure(billing.projectId === p && billing.billingEnabled === true, 'BACKUP_QA_BILLING_UNVERIFIED')
  report.billingVerified = true
  for (const id of [TARGET.source, TARGET.destination]) {
    ensure(await api(`https://firestore.googleapis.com/v1/projects/${p}/databases/${id}`, { allow404: true }) === null, 'BACKUP_QA_DATABASE_ALREADY_EXISTS')
  }
  return { ...report, status: 'preflight_pass', resourcesCreated: false, productionReady: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = { projectId: TARGET.projectId, resourcesCreated: false }
  try {
    ensure(process.env.IDOGS_MANAGED_BACKUP_APPROVAL === '2026-10-28-two-databases-one-backup', 'BACKUP_QA_APPROVAL_REQUIRED')
    for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GOOGLE_CLOUD_UNIVERSE_DOMAIN']) ensure(!process.env[key], 'BACKUP_QA_ENDPOINT_OVERRIDE')
    let credential
    try { credential = JSON.parse(process.env.IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON) } catch { throw Object.assign(new Error(), { code: 'STAGING_CREDENTIAL_REQUIRED' }) }
    ensure(credential.project_id === TARGET.projectId && credential.type === 'service_account' && credential.client_email?.endsWith('@idogs-app-staging.iam.gserviceaccount.com'), 'BACKUP_QA_CREDENTIAL_MISMATCH')
    const { cert } = await import('firebase-admin/app')
    const auth = cert(credential)
    const api = async (url, { method = 'GET', body, allow404 = false } = {}) => {
      const token = await auth.getAccessToken()
      const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) })
      if (allow404 && response.status === 404) return null
      if (!response.ok) throw Object.assign(new Error(), { code: 'BACKUP_QA_API_DENIED', httpStatus: response.status, api: new URL(url).hostname })
      return response.json()
    }
    const result = await preflight({ api, report })
    console.log(JSON.stringify(result, null, 2))
    if (result.status !== 'preflight_pass') process.exitCode = 2
  } catch (error) {
    console.log(JSON.stringify({ ...report, status: 'owner_gate', code: /^[A-Z_]{3,80}$/.test(error.code || '') ? error.code : 'BACKUP_QA_PREFLIGHT_FAILED', httpStatus: error.httpStatus, api: error.api, productionReady: false }))
    process.exitCode = 2
  }
}
