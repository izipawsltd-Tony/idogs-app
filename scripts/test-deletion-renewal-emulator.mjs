import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { changeDeletionRequest } from '../api/_lib/account-deletion.js'
import { runRenewalRehearsal } from './qa/deletion/renewal.mjs'

const PROJECT = 'demo-idogs-account-deletion'
if (process.env.GCLOUD_PROJECT !== PROJECT || !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('emulator_only')
let app, db, sequence = 0
const clock = Date.parse('2026-10-21T00:00:00Z')
before(() => { app = initializeApp({ projectId: PROJECT }, 'renewal-rehearsal'); db = getFirestore(app) })
after(async () => { await deleteApp(app) })
async function seed() {
  const uid = `qa-deletion-renewal-${++sequence}`
  const token = { uid, auth_time: clock / 1000 }
  const requestRef = db.doc(`accountDeletionRequests/${uid}`)
  await changeDeletionRequest({ db, token, body: { action: 'request', confirmation: 'DELETE MY ACCOUNT' }, now: clock })
  const subscriptions = [
    { id: `base-${sequence}`, ownerUid: uid, createdAt: new Date(clock - 86400000).toISOString(), status: 'active', cancelAtPeriodEnd: false },
    { id: `sms-${sequence}`, ownerUid: uid, createdAt: new Date(clock - 1000).toISOString(), status: 'trialing', cancelAtPeriodEnd: false },
  ]
  const events = []
  const billing = { kind: 'synthetic-memory',
    async discoverSubscriptions() { return { complete: true, subscriptions: structuredClone(subscriptions) } },
    async readSubscription(id) { return structuredClone(subscriptions.find(s => s.id === id)) },
    async cancelAtPeriodEnd(id, key) { subscriptions.find(s => s.id === id).cancelAtPeriodEnd = true; events.push({ id, key }) },
  }
  const taskRef = db.doc(`accountDeletionRenewalTasks/${uid}_1`)
  return { uid, token, requestRef, taskRef, subscriptions, events, billing, run: (extra = {}) => runRenewalRehearsal({ db, uid, revision: 1, workerId: 'worker-a', billing, now: () => clock, ...extra }) }
}
test('request acceptance queues renewal independently of blocked cleanup; receipts persist and retry is a no-op', async () => {
  const f = await seed()
  assert.ok((await f.requestRef.get()).data().holds.includes('ownership_inventory'))
  assert.equal((await f.run()).status, 'verified_stopped')
  assert.equal(f.events.length, 2)
  assert.ok(f.subscriptions.every(s => s.cancelAtPeriodEnd))
  assert.equal((await f.requestRef.get()).data().status, 'requested')
  assert.equal((await f.taskRef.get()).data().status, 'verified_stopped')
  assert.equal((await f.run()).status, 'already_verified')
  assert.equal(f.events.length, 2)
})
test('cancellation preserves queued renewal work; later login/request cancellation never resubscribes', async () => {
  const f = await seed()
  await changeDeletionRequest({ db, token: f.token, body: { action: 'cancel' }, now: clock })
  await f.run()
  assert.equal((await f.requestRef.get()).data().status, 'cancelled')
  assert.equal((await f.requestRef.get()).data().renewalStatus, 'verified_stopped')
  assert.ok(f.subscriptions.every(s => s.cancelAtPeriodEnd))
})
test('lost response after provider cancellation resumes by readback without a second cancellation', async () => {
  const f = await seed(), original = f.billing.cancelAtPeriodEnd
  let lost = false
  f.billing.cancelAtPeriodEnd = async (...args) => { await original(...args); if (!lost) { lost = true; throw new Error('lost_response') } }
  await assert.rejects(f.run(), /lost_response/)
  assert.equal((await f.taskRef.get()).data().status, 'review_required')
  await f.run({ workerId: 'restarted-worker' })
  assert.equal(f.events.length, 2)
  assert.equal(new Set(f.events.map(e => e.key)).size, 2)
})
test('incomplete discovery and foreign identity block every provider mutation', async () => {
  for (const cause of ['incomplete', 'foreign', 'unknown-time']) {
    const f = await seed()
    if (cause === 'incomplete') f.billing.discoverSubscriptions = async () => ({ complete: false, subscriptions: f.subscriptions })
    if (cause === 'foreign') f.subscriptions[1].ownerUid = 'qa-deletion-other'
    if (cause === 'unknown-time') delete f.subscriptions[1].createdAt
    await assert.rejects(f.run(), /billing_/)
    assert.equal(f.events.length, 0)
    assert.equal((await f.requestRef.get()).data().renewalStatus, 'review_required')
  }
})
test('subscriptions created after acceptance are excluded and no-subscription proof is durable', async () => {
  const f = await seed()
  for (const s of f.subscriptions) s.createdAt = new Date(clock + 1).toISOString()
  assert.equal((await f.run()).status, 'verified_no_subscription')
  assert.equal(f.events.length, 0)
  assert.equal((await f.requestRef.get()).data().renewalStatus, 'verified_no_subscription')
})
test('a newer request revision rejects stale task execution before discovery', async () => {
  const f = await seed()
  await f.requestRef.update({ revision: 2 })
  f.billing.discoverSubscriptions = async () => { throw new Error('must_not_discover') }
  await assert.rejects(f.run(), /task_identity_changed/)
  assert.equal(f.events.length, 0)
})
test('worker lease excludes another worker and expired workers cannot write success', async () => {
  const f = await seed(), discover = f.billing.discoverSubscriptions
  f.billing.discoverSubscriptions = async () => {
    await assert.rejects(f.run({ workerId: 'worker-b' }), /worker_busy/)
    return discover()
  }
  await f.run()
  assert.equal(f.events.length, 2)
  const g = await seed(), original = g.billing.cancelAtPeriodEnd
  g.billing.cancelAtPeriodEnd = async (...args) => { await original(...args); await g.taskRef.update({ workerId: 'successor', epoch: 99 }) }
  await assert.rejects(g.run(), /worker_fenced/)
  assert.notEqual((await g.requestRef.get()).data().renewalStatus, 'verified_stopped')
  assert.equal((await g.taskRef.get()).data().epoch, 99)
})
test('synthetic harness refuses production adapters before any database access', async () => {
  const f = await seed()
  await assert.rejects(f.run({ billing: { kind: 'production' } }), /synthetic_only/)
  await assert.rejects(f.run({ uid: 'real-owner' }), /synthetic_only/)
  assert.equal(f.events.length, 0)
})
