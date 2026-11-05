import { initializeApp, cert, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { cloudFixtureScope } from './deletion-cloud-runtime.mjs'
import { digest } from '../../api/_lib/deletion-plan.js'
import { writeFileSync } from 'node:fs'

const manifest = {"uid":"qa-deletion-qa-72a132cea3b14d259d95e9040f70c3e4","email":"qa-deletion-qa-72a132cea3b14d259d95e9040f70c3e4@example.invalid","runId":"deletion-qa-72a132cea3b14d259d95e9040f70c3e4","disposable":true,"authCreatedAt":"Wed, 04 Nov 2026 23:22:56 GMT","recordPaths":["users/qa-deletion-qa-72a132cea3b14d259d95e9040f70c3e4","dogs/deletion-qa-72a132cea3b14d259d95e9040f70c3e4-dog","vaccineRecords/deletion-qa-72a132cea3b14d259d95e9040f70c3e4-vaccine","wormingRecords/deletion-qa-72a132cea3b14d259d95e9040f70c3e4-worm","documents/deletion-qa-72a132cea3b14d259d95e9040f70c3e4-document"],"mediaPaths":["documents/qa-deletion-qa-72a132cea3b14d259d95e9040f70c3e4/proof.txt","documents/qa-deletion-qa-72a132cea3b14d259d95e9040f70c3e4/orphan.txt"],"stripeCustomerId":"cus_VZMEagaVoSl5QW","stripeSubscriptionId":"sub_1UYDW7GHgBd6ZgJEbLI5WdXr"}
const ensure = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }) }
let app
try {
  ensure(process.env.GITHUB_REPOSITORY === 'izipawsltd-Tony/idogs-app'
    && process.env.GITHUB_REF === 'refs/heads/release/ios-app-store-20261025'
    && process.env.GITHUB_ACTIONS === 'true', 'HELD_FIXTURE_CI_REQUIRED')
  const credential = JSON.parse(process.env.IDOGS_STAGING_FIREBASE_SERVICE_ACCOUNT_JSON || '{}')
  ensure(credential.project_id === 'idogs-app-staging', 'HELD_FIXTURE_PROJECT_REQUIRED')
  app = initializeApp({ credential: cert(credential), projectId: 'idogs-app-staging' }, 'held-replay-readback')
  const db = getFirestore(app, 'idogs-deletion-qa')
  const auth = getAuth(app)
  const bucket = getStorage(app).bucket('idogs-app-staging-deletion-qa')
  const scope = cloudFixtureScope({ db, auth, bucket, runId: manifest.runId, manifest })
  await scope.assertRuntime(manifest.uid)
  const job = await db.doc(`accountDeletionJobs/${manifest.uid}`).get()
  const request = await db.doc(`accountDeletionRequests/${manifest.uid}`).get()
  const lock = await db.doc(`accountDeletionLocks/${manifest.uid}`).get()
  ensure(digest(job.data()?.qaManifest) === digest(manifest), 'HELD_FIXTURE_MANIFEST_CHANGED')
  const records = await Promise.all(manifest.recordPaths.map(async path => {
    const snap = await db.doc(path).get()
    return { pathHash: digest(path), exists: snap.exists, version: snap.updateTime?.toDate().toISOString() || null }
  }))
  let authAbsent = false
  try { await auth.getUser(manifest.uid) } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    authAbsent = true
  }
  const media = await Promise.all(manifest.mediaPaths.map(async path => ({
    pathHash: digest(path), exists: (await bucket.file(path).exists())[0],
  })))
  const fresh = await db.doc(`accountDeletionJobs/${manifest.uid}`).get()
  ensure(job.updateTime?.isEqual(fresh.updateTime), 'HELD_FIXTURE_JOB_CHANGED')
  const report = { schema: 1, readOnly: true, originalRunId: '41932867457',
    originalSource: 'aadf3b70adad192bafc6840d1f570478769a993d',
    manifestHash: digest(manifest), jobStage: job.data()?.stage || null,
    requestStatus: request.data()?.status || null, lockState: lock.data()?.state || null,
    authAbsent, records, media, cleanupVerified: false, productionReady: false }
  writeFileSync('held-replay-readback.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  console.error(JSON.stringify({ status: 'held', code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'HELD_FIXTURE_READBACK_FAILED' }))
  process.exitCode = 2
} finally {
  if (app) await deleteApp(app)
}