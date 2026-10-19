import { operationKey } from './processor.mjs'

// Deterministic transactional reference adapter, NO network/SDK imports.
export function fixture() {
  const uid = 'qa-deletion-owner', revision = 1
  const state = {
    request: { uid, revision, status: 'requested' }, frozen: true, receipts: new Set(),
    records: new Map([['dogs/owned', { version: 'v1', currentOwnerId: uid }],
      ['dogs/transferred', { version: 'v2', currentOwnerId: 'qa-deletion-other' }]]),
    objects: new Map([['private/photo', { generation: 'g1', ownerUid: uid, shared: false }]]),
    subscriptions: [{ id: 'sub-base', ownerUid: uid, status: 'active', cancelAtPeriodEnd: false },
      { id: 'sub-sms', ownerUid: uid, status: 'trialing', cancelAtPeriodEnd: false }],
    authExists: true, events: [], failAuth: false, loseObjectResponse: false, loseCompletion: false,
    plan: { fingerprint: 'synthetic-manifest-v1', complete: true, holds: [], policyApproved: true,
      providerRetentionVerified: true, backupsVerified: true, writeFreezeVerified: true,
      records: [{ path: 'dogs/owned', version: 'v1', disposition: 'delete_exclusive' },
        { path: 'dogs/transferred', version: 'v2', disposition: 'preserve_other_owner' }],
      objects: [{ bucket: 'synthetic-bucket', path: 'private/photo', generation: 'g1', ownerUid: uid, exclusive: true, shared: false }] },
  }
  const fence = (u, r, fingerprint) => {
    if (u !== uid || r !== state.request.revision || state.request.status !== 'processing'
      || !state.frozen || fingerprint !== state.plan.fingerprint) throw new Error('fence_changed')
  }
  const store = { kind: 'synthetic-memory',
    async readRequest() { return structuredClone(state.request) },
    async readApprovedPlan() { return structuredClone(state.plan) },
    async claim(u, r, fingerprint) {
      if (u !== uid || r !== state.request.revision || !['requested', 'review_required', 'processing'].includes(state.request.status)
        || !state.frozen || fingerprint !== state.plan.fingerprint) throw new Error('claim_conflict')
      // A production implementation must recheck ALL ownership before first mutation.
      for (const record of state.plan.records.filter(r => r.disposition === 'delete_exclusive')) {
        const key = operationKey(uid, revision, 'record', record.path)
        const current = state.records.get(record.path)
        if (!state.receipts.has(key) && (!current || current.currentOwnerId !== uid || current.version !== record.version || current.pendingTransfer)) throw new Error('ownership_changed')
      }
      state.request.status = 'processing'
    },
    async deleteRecordAtomically({ uid: u, revision: r, fingerprint, record, key }) {
      fence(u, r, fingerprint)
      if (state.receipts.has(key)) return
      const current = state.records.get(record.path)
      if (!current || current.currentOwnerId !== u || current.version !== record.version || current.pendingTransfer) throw new Error('ownership_changed')
      state.records.delete(record.path); state.receipts.add(key); state.events.push('record')
    },
    async hasReceipt(key) { return state.receipts.has(key) },
    async assertFence(u, r, fingerprint) { fence(u, r, fingerprint) },
    async saveReceipt(key) { state.receipts.add(key) },
    async assertCleanupComplete(u, r, plan) {
      fence(u, r, plan.fingerprint)
      if (plan.records.some(record => record.disposition === 'delete_exclusive'
        && !state.receipts.has(operationKey(u, r, 'record', record.path)))
        || plan.objects.some(object => !state.receipts.has(operationKey(u, r, 'object', [object.bucket, object.path, object.generation])))) throw new Error('cleanup_incomplete')
    },
    async complete(u, r) {
      if (state.loseCompletion) { state.loseCompletion = false; throw new Error('receipt_unavailable') }
      fence(u, r, state.plan.fingerprint); state.request.status = 'completed'; state.events.push('complete')
    },
  }
  const billing = { kind: 'synthetic-memory',
    async listVerifiedSubscriptions() { return structuredClone(state.subscriptions) },
    async cancelAtPeriodEnd(id, key) { state.events.push('billing'); state.subscriptions.find(s => s.id === id).cancelAtPeriodEnd = true; state.receipts.add(key) },
    async readSubscription(id) { return structuredClone(state.subscriptions.find(s => s.id === id)) },
  }
  const objects = { kind: 'synthetic-memory', async deleteExact(object) {
    if (object.bucket !== 'synthetic-bucket') throw new Error('bucket_changed')
    const current = state.objects.get(object.path)
    if (current && (current.generation !== object.generation || current.ownerUid !== uid || current.shared)) throw new Error('object_changed')
    state.objects.delete(object.path); state.events.push('object')
    if (state.loseObjectResponse) { state.loseObjectResponse = false; throw new Error('response_lost') }
  } }
  const auth = { kind: 'synthetic-memory', async deleteExact(u) {
    if (u !== uid || state.failAuth) throw new Error('auth_failed')
    state.authExists = false; state.events.push('auth')
  } }
  return { uid, revision, state, store, billing, objects, auth }
}
