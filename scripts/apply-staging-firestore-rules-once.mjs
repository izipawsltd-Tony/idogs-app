#!/usr/bin/env node
// ONE-OFF staging-only Firestore Rules deploy hook.
// Guarded to the exact iDogs staging Vercel project + Firebase project.
// Remove this hook immediately after a verified successful staging deploy.
import { writeFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const STAGING_VERCEL_PROJECT_ID = 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o'
const STAGING_FIREBASE_PROJECT_ID = 'idogs-app-staging'

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

const keyPath = join('/tmp', `idogs-staging-rules-${process.pid}.json`)
const key = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: process.env.FIREBASE_PRIVATE_KEY,
}

try {
  writeFileSync(keyPath, JSON.stringify(key), { mode: 0o600 })
  const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: keyPath }

  console.log('[rules-once] Deploying firestore.rules to idogs-app-staging...')
  const deploy = spawnSync(
    'npx',
    ['--yes', 'firebase-tools@13.35.1', 'deploy', '--only', 'firestore:rules', '--project', STAGING_FIREBASE_PROJECT_ID, '--non-interactive'],
    { cwd: process.cwd(), env, encoding: 'utf8', stdio: 'inherit' }
  )
  if (deploy.status !== 0) {
    console.error('[rules-once] DEPLOY FAILED')
    process.exit(deploy.status || 1)
  }

  console.log('[rules-once] Verifying active ruleset exact content...')
  const verify = spawnSync(
    process.execPath,
    ['scripts/verify-rules-release.mjs', STAGING_FIREBASE_PROJECT_ID, 'firestore.rules'],
    { cwd: process.cwd(), env, encoding: 'utf8', stdio: 'inherit' }
  )
  if (verify.status !== 0) {
    console.error('[rules-once] VERIFY FAILED')
    process.exit(verify.status || 1)
  }

  console.log('[rules-once] PASS: staging Firestore Rules deployed and exact-content verified')
} finally {
  try { unlinkSync(keyPath) } catch {}
}
