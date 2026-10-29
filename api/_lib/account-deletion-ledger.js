// Durable Firestore candidate. No route imports this module; emulator-only activation.
import { createHash } from 'node:crypto'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const operationKey = (uid, revision, kind, identity) => hash([uid, revision, kind, identity])
export const manifestFingerprint = plan => hash({ records: plan.records, objects: plan.objects,
  evidence: plan.evidence, approvals: plan.approvals })
export const snapshotVersion = snap => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null
const requireReady = p => {
  if (!p || !Array.isArray(p.records) || !Array.isArray(p.objects) || p.records.length > 100 || p.objects.length > 100
    || !p.complete || p.holds?.length || !p.evidence?.retention || !p.evidence?.backups || !p.evidence?.writeFreeze
    || !p.approvals?.policy || !p.approvals?.billing || p.fingerprint !== manifestFingerprint(p)) throw new Error('manifest_not_ready')
  for (let i = 0; i < p.records.length; i++) {
    const r = p.records[i]
    if (r.disposition === 'delete_exclusive' && r.path === r.ownerPath
      && p.records.slice(i + 1).some(child => child.ownerPath === r.path && child.disposition === 'delete_exclusive')) throw new Error('owner_must_be_last')
  }
}
const owned = (data, uid) => data?.currentOwnerId === uid && data.transferStatus !== 'pendingClaim'
  && data.status !== 'transferred' && !data.pendingTransfer

export function createDeletionLedger({ db, uid, revision, workerId, now = Date.now, leaseMs = 30000 }) {
  // Separate factory gate, checked BEFORE obtaining a ref or issuing any RPC.
  if (db?.projectId !== 'demo-idogs-account-deletion'
    || !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
    || !/^qa-deletion-[a-z0-9-]+$/.test(uid) || !Number.isSafeInteger(revision) || revision < 1
    || !/^[a-zA-Z0-9-]{1,80}$/.test(workerId) || !Number.isFinite(leaseMs) || leaseMs < 1000 || leaseMs > 300000) throw new Error('emulator_only')
  const requestRef = db.doc(`accountDeletionRequests/${uid}`)
  const planRef = db.doc(`accountDeletionManifests/${uid}/revisions/${revision}`)
  const fenceRef = db.doc(`accountDeletionFences/${uid}`)
  const progressRef = db.doc(`accountDeletionProgress/${uid}/revisions/${revision}`)
  const opRef = key => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('invalid_operation_key')
    return progressRef.collection('operations').doc(key)
  }
  let epoch = null
  async function context(tx, { claim = false, fingerprint } = {}) {
    const [reqSnap, planSnap, fenceSnap, progressSnap] = await tx.getAll(requestRef, planRef, fenceRef, progressRef)
    const request = reqSnap.data(), plan = planSnap.data(), fence = fenceSnap.data(), progress = progressSnap.data()
    requireReady(plan)
    if (request?.revision !== revision || !(claim ? ['requested', 'review_required', 'processing'] : ['processing']).includes(request.status)
      || fingerprint && plan.fingerprint !== fingerprint || fence?.revision !== revision || fence?.state !== 'frozen') throw new Error('fence_changed')
    if (!claim && (progress?.workerId !== workerId || progress?.epoch !== epoch || progress?.leaseUntil <= now()
      || progress?.fingerprint !== plan.fingerprint)) throw new Error('worker_fenced')
    return {request, plan, fence, progress}
  }
  function validateRecordPath(record) {
    if (!/^(dogs|documents)\/qa-deletion-[a-z0-9-]+$/.test(record.path)
      || !/^dogs\/qa-deletion-[a-z0-9-]+$/.test(record.ownerPath)) throw new Error('unreviewed_record_path')
  }
  async function verifyRecord(tx, record) {
    validateRecordPath(record)
    const target = db.doc(record.path), owner = db.doc(record.ownerPath)
    const [snap, ownerSnap] = await tx.getAll(target, owner)
    if (!snap.exists || snapshotVersion(snap) !== record.version || !owned(ownerSnap.data(), uid)
      || record.path !== record.ownerPath && snap.data().dogId !== owner.id) throw new Error('ownership_or_version_changed')
    return target
  }
  const receiptIds = plan => [...plan.records.filter(r => r.disposition === 'delete_exclusive').map(r => operationKey(uid, revision, 'record', r.path)),
    ...plan.objects.map(o => operationKey(uid, revision, 'object', [o.bucket, o.path, o.generation]))]
  async function assertReceipts(tx, plan) {
    const ids = receiptIds(plan)
    if (!ids.length) return
    const snaps = await tx.getAll(...ids.map(opRef))
    if (snaps.some(s => s.data()?.status !== 'done')) throw new Error('cleanup_incomplete')
  }
  return {
    kind: 'synthetic-firestore',
    async readRequest() { return (await requestRef.get()).data() },
    async readApprovedPlan() { return (await planRef.get()).data() },
    async claim(u, r, fingerprint) {
      if (u !== uid || r !== revision) throw new Error('identity_mismatch')
      const result = await db.runTransaction(async tx => {
        const c = await context(tx, {claim: true, fingerprint})
        if (c.progress?.leaseUntil > now() && c.progress.workerId !== workerId) throw new Error('worker_busy')
        // Re-validate all outstanding targets BEFORE the first mutation. Receipts and
        // deletes are in one transaction, so a missing doc without receipt is a hold.
        for (const record of c.plan.records) {
          if (['preserve_other_owner', 'retain_lawful'].includes(record.disposition)) continue
          if (record.disposition !== 'delete_exclusive') throw new Error('record_not_authorized')
          const key = operationKey(uid, revision, 'record', record.path)
          if (!(await tx.get(opRef(key))).exists) await verifyRecord(tx, record)
        }
        const nextEpoch = Number(c.progress?.epoch || 0) + 1
        tx.set(progressRef, {workerId, epoch: nextEpoch, leaseUntil: now() + leaseMs, fingerprint, status:'processing'})
        tx.update(requestRef, {status:'processing'})
        return nextEpoch
      })
      epoch = result
    },
    async assertFence(u, r, fingerprint) {
      if (u !== uid || r !== revision) throw new Error('identity_mismatch')
      await db.runTransaction(async tx => { await context(tx, {fingerprint}); tx.update(progressRef, {leaseUntil: now() + leaseMs}) })
    },
    async deleteRecordAtomically({uid: u, revision: r, fingerprint, record, key}) {
      if (u !== uid || r !== revision || key !== operationKey(uid, revision, 'record', record.path)) throw new Error('identity_mismatch')
      return db.runTransaction(async tx => {
        const c = await context(tx, {fingerprint})
        if (!c.plan.records.some(item => JSON.stringify(item) === JSON.stringify(record) && item.disposition === 'delete_exclusive')) throw new Error('manifest_mismatch')
        const receipt = await tx.get(opRef(key))
        if (receipt.data()?.status === 'done') return
        const ref = await verifyRecord(tx, record)
        tx.delete(ref); tx.create(opRef(key), {status:'done', kind:'record', epoch, completedAt: now()})
        tx.update(progressRef, {leaseUntil: now() + leaseMs})
      })
    },
    async hasReceipt(key) { return (await opRef(key).get()).data()?.status === 'done' },
    async saveReceipt(key) {
      return db.runTransaction(async tx => {
        const c = await context(tx)
        if (!c.plan.objects.some(o => key === operationKey(uid, revision, 'object', [o.bucket, o.path, o.generation]))) throw new Error('manifest_mismatch')
        const previous = await tx.get(opRef(key))
        if (!previous.exists) tx.create(opRef(key), {status:'done', kind:'object', epoch, completedAt: now()})
      })
    },
    async assertCleanupComplete(u, r, plan) {
      if (u !== uid || r !== revision) throw new Error('identity_mismatch')
      return db.runTransaction(async tx => { const c = await context(tx, {fingerprint:plan.fingerprint}); await assertReceipts(tx, c.plan) })
    },
    async recordAuthOutcome(outcome) {
      if (outcome !== 'deleted' && outcome !== 'already_absent') throw new Error('auth_not_confirmed')
      return db.runTransaction(async tx => {
        const c = await context(tx); await assertReceipts(tx, c.plan)
        tx.update(progressRef, {authOutcome:outcome, authConfirmedAt:now()})
      })
    },
    async complete(u, r) {
      if (u !== uid || r !== revision) throw new Error('identity_mismatch')
      return db.runTransaction(async tx => {
        const c = await context(tx); await assertReceipts(tx, c.plan)
        if (!['deleted','already_absent'].includes(c.progress?.authOutcome)) throw new Error('auth_not_confirmed')
        tx.update(requestRef, {status:'completed', updatedAt:new Date(now()).toISOString()})
        tx.update(progressRef, {status:'completed', leaseUntil:0, completedAt:now()})
        // Keep fence/tombstone after completion: restores cannot reopen writes.
      })
    },
    async guardedWrite(path, data) {
      if (!/^(dogs|documents)\/qa-deletion-[a-z0-9-]+$/.test(path)) throw new Error('unreviewed_record_path')
      return db.runTransaction(async tx => {
        const fence = (await tx.get(fenceRef)).data()
        if (fence?.state === 'frozen') throw new Error('writes_frozen')
        tx.set(db.doc(path), data, {merge:true})
      })
    },
  }
}
