// Read-only staging QA. Never list users, write documents, log emails/UIDs or import contacts.
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

export const PROJECT_ID = 'idogs-app-staging'
export function evaluateConsent(raw, expected, now = Date.now()) {
  if (!['opt_in','opt_out'].includes(expected)) throw Error('INVALID_EXPECTATION')
  const c = raw?.marketingConsent
  if (!c || c.channel !== 'email_marketing' || c.checkboxDefault !== false ||
      c.choice !== expected || c.source !== 'account_settings' ||
      c.policyVersion !== 'marketing-v1-2026-10') throw Error('CONSENT_MISMATCH')
  if (expected === 'opt_out' &&
      (c.evidenceRef !== 'settings-opt-out-v1' || !Number.isFinite(Date.parse(c.revokedAt)) ||
       Date.parse(c.revokedAt) > now)) throw Error('REVOCATION_NOT_PERSISTED')
  if (expected === 'opt_in' &&
      (c.evidenceRef !== 'settings-opt-in-v1' || c.revokedAt !== null ||
       !Number.isFinite(Date.parse(c.optedInAt)) || Date.parse(c.optedInAt) > now)) throw Error('OPT_IN_NOT_PERSISTED')
  return { result: 'PASS', expected, scope: 'single-staging-qa-user', action: 'read-only' }
}
async function main() {
  const uid = process.env.QA_UID
  const expected = process.env.EXPECTED_CHOICE
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
  if (project !== PROJECT_ID || !uid || !/^[a-zA-Z0-9]{15,128}$/.test(uid) ||
      !['opt_in','opt_out'].includes(expected)) throw Error('INVALID_STAGING_SCOPE')
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, 'consent-staging-qa')
  try {
    const snapshot = await getFirestore(app).doc('users/' + uid).get()
    if (!snapshot.exists) throw Error('QA_USER_NOT_FOUND')
    const result = evaluateConsent(snapshot.data(), expected)
    console.log(JSON.stringify(result))
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import('node:fs/promises')
      await appendFile(process.env.GITHUB_STEP_SUMMARY, '### Firestore staging consent QA\n\nPASS — single QA document, no PII; expected: ' + expected + '\n')
    }
  } finally { await deleteApp(app) }
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch(err => { console.error('FAIL:', err?.message || 'READ_FAILED'); process.exitCode = 1 })
}
