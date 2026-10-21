// Candidate orchestration, deliberately outside api/. No live runtime/provider adapter is installed.
// The store contract requires atomic request/revision + ownership/version + ledger checks
// for each document mutation; a lease or disabled Auth alone is NOT a write freeze.
import { createHash } from 'node:crypto'

export const operationKey = (uid, revision, kind, identity) => createHash('sha256')
  .update(JSON.stringify([uid, revision, kind, identity])).digest('hex')

export async function stopRenewal({ request, billing }) {
  // Enumerate all base/add-on subscriptions at the provider, not just profile fields.
  const subscriptions = await billing.listVerifiedSubscriptions(request.uid)
  if (!Array.isArray(subscriptions)) throw new Error('billing_unverified')
  const ids = new Set()
  // Validate every identity and status before the first external mutation.
  for (const subscription of subscriptions) {
    if (!subscription || subscription.ownerUid !== request.uid || !subscription.id || ids.has(subscription.id)) throw new Error('billing_identity')
    ids.add(subscription.id)
    if (!['canceled', 'incomplete_expired', 'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'].includes(subscription.status)) throw new Error('billing_status')
  }
  for (const subscription of subscriptions) {
    if (subscription.ownerUid !== request.uid || !subscription.id) throw new Error('billing_identity')
    if (['canceled', 'incomplete_expired'].includes(subscription.status)) continue
    if (!['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'].includes(subscription.status)) throw new Error('billing_status')
    const key = operationKey(request.uid, request.revision, 'stop-renewal', subscription.id)
    // Read-before-write, stable retry key, and readback. No customer/invoice deletion/refund.
    if (!subscription.cancelAtPeriodEnd) await billing.cancelAtPeriodEnd(subscription.id, key)
    const current = await billing.readSubscription(subscription.id)
    if (current?.id !== subscription.id || current.ownerUid !== request.uid || !(current.cancelAtPeriodEnd || current.status === 'canceled')) throw new Error('billing_not_confirmed')
  }
  return { verified: true, subscriptions: subscriptions.length }
}

export async function runDeletionRehearsal({ uid, revision, store, billing, objects, auth }) {
  // Cannot target a real identity, database, object store or provider through this harness.
  if (!/^qa-deletion-[a-z0-9-]+$/.test(uid) || !Number.isSafeInteger(revision) || revision < 1
    || !['synthetic-memory', 'synthetic-firestore'].includes(store?.kind)
    || !['synthetic-memory', 'synthetic-auth-emulator'].includes(auth?.kind)
    || [billing, objects].some(adapter => adapter?.kind !== 'synthetic-memory')) {
    throw new Error('synthetic_only')
  }
  const request = await store.readRequest(uid)
  if (request?.revision !== revision) throw new Error('request_revision_changed')
  if (request.status === 'completed') return { status: 'completed' }
  if (!['requested', 'review_required', 'processing'].includes(request.status)) throw new Error('request_not_processable')
  // Stop renewal at acceptance, before inventory/cleanup holds. Cancellation of the
  // deletion request never calls a resubscribe operation.
  await stopRenewal({ request: { ...request, uid }, billing })
  const plan = await store.readApprovedPlan(uid, revision)
  if (!plan?.complete || plan.holds?.length || !(plan.policyApproved || plan.approvals?.policy) || !(plan.providerRetentionVerified || plan.evidence?.retention)
    || !(plan.backupsVerified || plan.evidence?.backups) || !(plan.writeFreezeVerified || plan.evidence?.writeFreeze) || !Array.isArray(plan.records)
    || !Array.isArray(plan.objects)) throw new Error('plan_not_ready')
  // Store validates the exact revision, freeze, manifest digest and no pending transfer
  // atomically while claiming. Cancellation wins if it committed first.
  await store.claim(uid, revision, plan.fingerprint)
  for (const record of plan.records) {
    if (record.disposition === 'preserve_other_owner' || record.disposition === 'retain_lawful') continue
    if (record.disposition !== 'delete_exclusive' || !record.version || !record.path) throw new Error('record_not_authorized')
    await store.deleteRecordAtomically({ uid, revision, fingerprint: plan.fingerprint, record,
      key: operationKey(uid, revision, 'record', record.path) })
  }
  for (const object of plan.objects) {
    if (!object.bucket || !object.path || !object.generation || object.ownerUid !== uid
      || object.shared || !object.exclusive) throw new Error('object_not_authorized')
    const key = operationKey(uid, revision, 'object', [object.bucket, object.path, object.generation])
    if (await store.hasReceipt(key)) continue
    await store.assertFence(uid, revision, plan.fingerprint)
    // Adapter checks exact bucket/path/generation and exclusive ownership. If already
    // absent after a lost response, that exact identity is a successful retry.
    await objects.deleteExact(object)
    await store.saveReceipt(key)
  }
  await store.assertFence(uid, revision, plan.fingerprint)
  await store.assertCleanupComplete(uid, revision, plan)
  const authOutcome = await auth.deleteExact(uid) // user-not-found on retry is success; other failures propagate.
  if (store.recordAuthOutcome) await store.recordAuthOutcome(authOutcome)
  // A failure here retries Auth idempotently. Never mark completed before Auth succeeds.
  await store.complete(uid, revision)
  return { status: 'completed' }
}
