import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './qa/deletion/fixture.mjs'
import { runDeletionRehearsal, stopRenewal } from './qa/deletion/processor.mjs'
const run = f => runDeletionRehearsal(f)

test('exclusive data only; transferred dog survives; both renewals stop; Auth last', async () => {
  const f = fixture(); await run(f)
  assert.equal(f.state.records.has('dogs/owned'), false)
  assert.equal(f.state.records.get('dogs/transferred').currentOwnerId, 'qa-deletion-other')
  assert.ok(f.state.subscriptions.every(s => s.cancelAtPeriodEnd))
  assert.deepEqual(f.state.events, ['billing', 'billing', 'record', 'object', 'auth', 'complete'])
  const before = [...f.state.events]; await run(f); assert.deepEqual(f.state.events, before)
})
for (const [label, mutate] of [
  ['current owner changed from original breeder', f => { f.state.records.get('dogs/owned').currentOwnerId = 'qa-deletion-other' }],
  ['pending claim', f => { f.state.records.get('dogs/owned').pendingTransfer = true }],
  ['version changed', f => { f.state.records.get('dogs/owned').version = 'v3' }],
  ['write freeze missing', f => { f.state.frozen = false }],
  ['incomplete inventory', f => { f.state.plan.complete = false }],
  ['unscanned collection hold', f => { f.state.plan.holds.push('unknown_collection') }],
  ['provider retention unknown', f => { f.state.plan.providerRetentionVerified = false }],
  ['backup inventory unknown', f => { f.state.plan.backupsVerified = false }],
  ['policy not approved', f => { f.state.plan.policyApproved = false }],
]) test(`blocks before private cleanup: ${label}`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(run(f))
  assert.equal(f.state.records.size, 2); assert.equal(f.state.authExists, true)
  assert.notEqual(f.state.request.status, 'completed')
})
test('cancel wins before atomic claim; no resubscription', async () => {
  const f = fixture(); const read = f.store.readApprovedPlan
  f.store.readApprovedPlan = async () => { const plan = await read(); f.state.request.status = 'cancelled'; return plan }
  await assert.rejects(run(f), /claim_conflict/)
  assert.equal(f.state.records.size, 2); assert.ok(f.state.subscriptions.every(s => s.cancelAtPeriodEnd))
})
test('new request revision cannot resume an old worker', async () => {
  const f = fixture(); f.state.request.revision = 2
  await assert.rejects(run(f), /revision_changed/); assert.deepEqual(f.state.events, [])
})
test('ownership race immediately before transaction preserves dog', async () => {
  const f = fixture(); const original = f.store.deleteRecordAtomically
  f.store.deleteRecordAtomically = async args => { f.state.records.get('dogs/owned').currentOwnerId = 'qa-deletion-other'; return original(args) }
  await assert.rejects(run(f), /ownership_changed/)
  assert.equal(f.state.records.size, 2); assert.equal(f.state.authExists, true)
})
for (const [label, mutate] of [
  ['replacement generation', f => { f.state.objects.get('private/photo').generation = 'g2' }],
  ['shared object', f => { f.state.objects.get('private/photo').shared = true }],
  ['different owner', f => { f.state.objects.get('private/photo').ownerUid = 'qa-deletion-other' }],
  ['different bucket', f => { f.state.plan.objects[0].bucket = 'other' }],
]) test(`object guard: ${label}`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(run(f))
  assert.equal(f.state.objects.size, 1); assert.equal(f.state.authExists, true)
})
test('lost object response resumes from durable record ledger', async () => {
  const f = fixture(); f.state.loseObjectResponse = true
  await assert.rejects(run(f), /response_lost/)
  assert.equal(f.state.authExists, true); await run(f)
  assert.equal(f.state.request.status, 'completed'); assert.equal(f.state.events.filter(e => e === 'record').length, 1)
})
test('Auth failure remains processing; retry does not repeat cleanup', async () => {
  const f = fixture(); f.state.failAuth = true
  await assert.rejects(run(f), /auth_failed/); assert.equal(f.state.request.status, 'processing')
  f.state.failAuth = false; await run(f)
  assert.equal(f.state.events.filter(e => e === 'record').length, 1)
  assert.equal(f.state.events.filter(e => e === 'object').length, 1)
})
test('Auth success but completion receipt lost is safely retried', async () => {
  const f = fixture(); f.state.loseCompletion = true
  await assert.rejects(run(f), /receipt_unavailable/); assert.equal(f.state.authExists, false)
  await run(f); assert.equal(f.state.request.status, 'completed')
})
test('billing outage holds cleanup and Auth', async () => {
  const f = fixture(); f.billing.listVerifiedSubscriptions = async () => { throw new Error('provider_down') }
  await assert.rejects(run(f), /provider_down/); assert.equal(f.state.records.size, 2); assert.equal(f.state.authExists, true)
})
test('billing cancellation must be read back', async () => {
  const f = fixture(); f.billing.cancelAtPeriodEnd = async () => {}
  await assert.rejects(run(f), /billing_not_confirmed/); assert.equal(f.state.records.size, 2)
})
test('foreign customer mapping fails closed', async () => {
  const f = fixture(); f.state.subscriptions[0].ownerUid = 'qa-deletion-other'
  await assert.rejects(run(f), /billing_identity/); assert.equal(f.state.events.length, 0)
})
test('invalid later subscription is rejected before cancelling an earlier valid subscription', async () => {
  for (const change of [s => { s.ownerUid = 'qa-deletion-other' }, s => { s.status = 'unknown' }, (s, first) => { s.id = first.id }]) {
    const f = fixture(); change(f.state.subscriptions[1], f.state.subscriptions[0])
    await assert.rejects(run(f), /billing_/)
    assert.deepEqual(f.state.events, [])
    assert.ok(f.state.subscriptions.every(s => !s.cancelAtPeriodEnd))
  }
})
test('lost billing response reconciles without duplicate cancellation', async () => {
  const f = fixture(); const original = f.billing.cancelAtPeriodEnd; let lost = false
  f.billing.cancelAtPeriodEnd = async (...args) => { await original(...args); if (!lost) { lost = true; throw new Error('billing_response_lost') } }
  await assert.rejects(run(f), /billing_response_lost/); await run(f)
  assert.equal(f.state.events.filter(e => e === 'billing').length, 2)
})
test('unknown billing status blocks; no subscriptions is verified provider result only', async () => {
  const f = fixture(); f.state.subscriptions[0].status = 'unknown'
  await assert.rejects(run(f), /billing_status/)
  f.state.subscriptions = []; assert.deepEqual(await stopRenewal({request: f.state.request, billing: f.billing}), {verified: true, subscriptions: 0})
})
test('real identities/adapters cannot run through rehearsal', async () => {
  const f = fixture(); await assert.rejects(run({...f, uid: 'tony'}), /synthetic_only/)
  await assert.rejects(run({...f, objects: {kind: 'production'}}), /synthetic_only/)
  assert.deepEqual(f.state.events, [])
})
test('stale auth rejected before any request writes by existing lifecycle', async () => {
  const { changeDeletionRequest } = await import('../api/_lib/account-deletion.js')
  await assert.rejects(changeDeletionRequest({ db: {runTransaction() {throw new Error('should_not_write')}},
    token: {uid: 'qa-deletion-owner', auth_time: 0}, body: {action: 'request', confirmation: 'DELETE MY ACCOUNT'}, now: 600000 }), /sign in again/)
})
