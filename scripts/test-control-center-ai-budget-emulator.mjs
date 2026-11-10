import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createAiBudget } from '../api/_lib/control-center-ai-budget.js'

const projectId = 'demo-idogs-control-center'
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8285') {
  throw new Error('Requires exact isolated demo project and loopback Firestore emulator on port 8285')
}
const app = initializeApp({ projectId }, 'control-center-budget-test')
const db = getFirestore(app)
const day = '2026-11-10'
const now = () => new Date(`${day}T00:00:00Z`)
try {
  const budgetRef = db.collection('controlCenterAiBudgets').doc(day)
  // Fresh emulator only. Never reset a preexisting quota fixture.
  assert.equal((await budgetRef.get()).exists, false, 'Use a fresh emulator for each run')
  const first = createAiBudget(db, { now })
  const second = createAiBudget(db, { now })
  for (let index = 0; index < 19; index++) assert.ok(await first.reserve('test-admin'))
  const results = await Promise.all([first, second, first, second, first].map(budget => budget.reserve('test-admin')))
  assert.equal(results.filter(Boolean).length, 1, 'Only one remaining reservation may succeed across instances')
  assert.equal((await budgetRef.get()).data().attempts, 20)
  const audits = await db.collection('controlCenterAiAudit').get()
  assert.equal(audits.size, 20)
  const ticket = results.find(Boolean)
  await second.finish(ticket, 'UNAVAILABLE')
  assert.equal((await db.collection('controlCenterAiAudit').doc(ticket.auditId).get()).data().outcome, 'UNAVAILABLE')
  assert.equal((await budgetRef.get()).data().attempts, 20, 'Failed/unknown provider attempt cannot refund quota')
  assert.equal(await second.reserve('test-admin'), null)
  const privateAudit = await fetch(`http://127.0.0.1:8285/v1/projects/${projectId}/databases/(default)/documents/controlCenterAiAudit/${ticket.auditId}`)
  assert.equal(privateAudit.status, 403, 'Audit documents must be inaccessible to unauthenticated clients under real rules')
  console.log('PASS: actual Firestore SDK transactions enforce cross-instance daily ceiling and audit, without refunds')
} finally {
  await db.terminate()
  await deleteApp(app)
}
