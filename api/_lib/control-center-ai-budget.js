import { createHash, randomUUID } from 'node:crypto'

// Hard global ceiling across all function instances and both admins. Each
// attempt is charged before transport; unknown outcomes are never refunded.
export const AI_DAILY_REQUEST_LIMIT = 20
export function assertAssistantDatabase(deploymentEnvironment, projectId) {
  if (deploymentEnvironment === 'preview' && projectId === 'idogs-app-staging') return
  if (deploymentEnvironment === 'production' && projectId === 'idogs-app') return
  throw new Error('Assistant database environment mismatch')
}
export function createAiBudget(db, { now = () => new Date(), newId = randomUUID } = {}) {
  return {
    async reserve(actorUid) {
      if (typeof actorUid !== 'string' || !actorUid) throw new Error('Missing budget actor')
      const at = now()
      const day = at.toISOString().slice(0, 10)
      const budget = db.collection('controlCenterAiBudgets').doc(day)
      const audit = db.collection('controlCenterAiAudit').doc(newId())
      const actorHash = createHash('sha256').update(actorUid).digest('hex')
      const accepted = await db.runTransaction(async tx => {
        const snapshot = await tx.get(budget)
        const attempts = snapshot.exists ? snapshot.data().attempts : 0
        // Corrupt or missing counts on an existing document fail closed.
        if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts >= AI_DAILY_REQUEST_LIMIT) return false
        tx.set(budget, { day, attempts: attempts + 1, limit: AI_DAILY_REQUEST_LIMIT, updatedAt: at.toISOString() })
        tx.create(audit, { startedAt: at.toISOString(), actorHash, outcome: 'RESERVED' })
        return true
      })
      return accepted ? { auditId: audit.id } : null
    },
    async finish(ticket, outcome) {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(ticket?.auditId || '') || !['SUCCESS', 'UNAVAILABLE'].includes(outcome)) throw new Error('Invalid audit outcome')
      await db.collection('controlCenterAiAudit').doc(ticket.auditId).update({ outcome, finishedAt: now().toISOString() })
    },
  }
}
