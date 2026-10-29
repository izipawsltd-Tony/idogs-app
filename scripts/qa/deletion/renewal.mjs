// Rehearsal only: durable renewal work at request acceptance, independent of
// cleanup readiness. No live provider implementation or scheduled route exists.
import { stopRenewal } from './processor.mjs'
import { DELETION_POLICY_VERSION, RENEWAL_TASK_COLLECTION } from '../../../api/_lib/account-deletion-policy.js'

export async function runRenewalRehearsal({ db, uid, revision, workerId, billing, now = Date.now }) {
  if (db?.projectId !== 'demo-idogs-account-deletion'
    || !/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
    || !/^qa-deletion-[a-z0-9-]+$/.test(uid) || !Number.isSafeInteger(revision) || revision < 1
    || !/^[a-zA-Z0-9-]{1,80}$/.test(workerId) || billing?.kind !== 'synthetic-memory') throw new Error('synthetic_only')
  const taskRef = db.collection(RENEWAL_TASK_COLLECTION).doc(`${uid}_${revision}`)
  const requestRef = db.collection('accountDeletionRequests').doc(uid)
  const task = await db.runTransaction(async tx => {
    const [taskSnap, requestSnap] = await tx.getAll(taskRef, requestRef)
    const t = taskSnap.data(), r = requestSnap.data()
    if (!t || t.uid !== uid || t.revision !== revision || t.policyVersion !== DELETION_POLICY_VERSION
      || t.acceptedAt !== r?.acceptedAt || r.revision !== revision || !Number.isFinite(Date.parse(t.acceptedAt))
      || t.executionEnabled !== false) throw new Error('task_identity_changed')
    if (['verified_stopped', 'verified_no_subscription'].includes(t.status)) return null
    if (!['pending_verification', 'review_required', 'processing'].includes(t.status)) throw new Error('task_not_processable')
    if (t.leaseUntil > now()) throw new Error('worker_busy')
    const epoch = Number(t.epoch || 0) + 1
    tx.update(taskRef, { status: 'processing', workerId, epoch, leaseUntil: now() + 30000 })
    return { ...t, epoch }
  })
  if (!task) return { status: 'already_verified' }
  async function ownedTask(tx) {
    const t = (await tx.get(taskRef)).data()
    if (t?.workerId !== workerId || t?.epoch !== task.epoch || t?.leaseUntil <= now()
      || t.acceptedAt !== task.acceptedAt || t.uid !== uid || t.revision !== revision) throw new Error('worker_fenced')
    return t
  }
  async function fence() {
    await db.runTransaction(async tx => { await ownedTask(tx); tx.update(taskRef, { leaseUntil: now() + 30000 }) })
  }
  try {
    let snapshot = task.subscriptions
    if (!snapshot) {
      const discovery = await billing.discoverSubscriptions(uid)
      if (discovery?.complete !== true || !Array.isArray(discovery.subscriptions)) throw new Error('billing_discovery_incomplete')
      const ids = new Set()
      // Validate the entire provider snapshot before any cancellation. Include
      // base/add-ons, but never a subscription created after this acceptance.
      snapshot = discovery.subscriptions.map(s => {
        if (!s?.id || ids.has(s.id) || s.ownerUid !== uid || !Number.isFinite(Date.parse(s.createdAt))) throw new Error('billing_identity')
        ids.add(s.id)
        return { id: s.id, createdAt: s.createdAt }
      }).filter(s => Date.parse(s.createdAt) <= Date.parse(task.acceptedAt))
      await db.runTransaction(async tx => { await ownedTask(tx); tx.update(taskRef, { subscriptions: snapshot }) })
    }
    const verified = await Promise.all(snapshot.map(async expected => {
      const s = await billing.readSubscription(expected.id)
      if (s?.id !== expected.id || s.ownerUid !== uid || s.createdAt !== expected.createdAt) throw new Error('billing_identity')
      return s
    }))
    const result = await stopRenewal({ request: { uid, revision }, billing: {
      async listVerifiedSubscriptions() { return verified },
      async cancelAtPeriodEnd(id, key) { await fence(); await billing.cancelAtPeriodEnd(id, key) },
      async readSubscription(id) { await fence(); return billing.readSubscription(id) },
    } })
    const status = snapshot.length ? 'verified_stopped' : 'verified_no_subscription'
    await db.runTransaction(async tx => {
      await ownedTask(tx)
      const r = (await tx.get(requestRef)).data()
      const updatedAt = new Date(now()).toISOString()
      tx.update(taskRef, { status, leaseUntil: 0, updatedAt })
      // A receipt for an older task cannot overwrite a newer request revision.
      if (r?.revision === revision) tx.update(requestRef, { renewalStatus: status, updatedAt })
    })
    return { status, subscriptions: result.subscriptions }
  } catch (error) {
    await db.runTransaction(async tx => {
      await ownedTask(tx)
      const r = (await tx.get(requestRef)).data()
      tx.update(taskRef, { status: 'review_required', leaseUntil: 0 })
      if (r?.revision === revision) tx.update(requestRef, { renewalStatus: 'review_required' })
    }).catch(() => {}) // A taken-over worker must not overwrite its successor.
    throw error
  }
}
