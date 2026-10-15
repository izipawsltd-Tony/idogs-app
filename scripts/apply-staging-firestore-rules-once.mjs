#!/usr/bin/env node
// ONE-OFF staging-only Firestore Rules deploy hook.
// Guarded to the exact iDogs staging Vercel project + Firebase project.
// Remove this hook immediately after a verified successful staging deploy.
import { readFileSync } from 'node:fs'
import { cert } from 'firebase-admin/app'
import { getAccessToken } from './_lib/rules-release-verifier.mjs'
import { spawnSync } from 'node:child_process'

const STAGING_VERCEL_PROJECT_ID = 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o'
const STAGING_FIREBASE_PROJECT_ID = 'idogs-app-staging'
const RULES_API_BASE = 'https://firebaserules.googleapis.com/v1'

if (process.env.VERCEL_PROJECT_ID !== STAGING_VERCEL_PROJECT_ID) {
  console.log('[rules-once] SKIP: not the exact staging Vercel project')
  process.exit(0)
}
if (process.env.FIREBASE_PROJECT_ID !== STAGING_FIREBASE_PROJECT_ID) {
  console.error('[rules-once] FAIL CLOSED: FIREBASE_PROJECT_ID is not idogs-app-staging')
  process.exit(1)
}
if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('[rules-once] FAIL CLOSED: staging Firebase service-account env is incomplete')
  process.exit(1)
}

const credential = cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
})
const accessToken = await getAccessToken(credential)
const authHeaders = {
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
}

const rulesContent = readFileSync('firestore.rules', 'utf8')
console.log('[rules-once] Creating staging Firestore ruleset via Rules Management API...')
const createRes = await fetch(
  `${RULES_API_BASE}/projects/${encodeURIComponent(STAGING_FIREBASE_PROJECT_ID)}/rulesets`,
  {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      source: { files: [{ name: 'firestore.rules', content: rulesContent }] },
    }),
  }
)
const created = await createRes.json().catch(() => null)
if (!createRes.ok || !created?.name) {
  console.error(`[rules-once] CREATE RULESET FAILED: HTTP ${createRes.status}`)
  process.exit(1)
}
const expectedPrefix = `projects/${STAGING_FIREBASE_PROJECT_ID}/rulesets/`
if (!created.name.startsWith(expectedPrefix)) {
  console.error('[rules-once] FAIL CLOSED: created ruleset returned wrong project/resource')
  process.exit(1)
}

const releaseName = `projects/${STAGING_FIREBASE_PROJECT_ID}/releases/cloud.firestore`
console.log('[rules-once] Updating staging cloud.firestore release...')
const releaseRes = await fetch(
  `${RULES_API_BASE}/${releaseName}`,
  {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      release: { name: releaseName, rulesetName: created.name },
      updateMask: 'rulesetName',
    }),
  }
)
const release = await releaseRes.json().catch(() => null)
if (!releaseRes.ok || release?.rulesetName !== created.name) {
  console.error(`[rules-once] UPDATE RELEASE FAILED: HTTP ${releaseRes.status}`)
  process.exit(1)
}

console.log('[rules-once] Verifying active ruleset exact content...')
const verify = spawnSync(
  process.execPath,
  ['scripts/verify-rules-release.mjs', STAGING_FIREBASE_PROJECT_ID, 'firestore.rules'],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8', stdio: 'inherit' }
)
if (verify.status !== 0) {
  console.error('[rules-once] VERIFY FAILED')
  process.exit(verify.status || 1)
}

console.log('[rules-once] PASS: staging Firestore Rules deployed and exact-content verified')
