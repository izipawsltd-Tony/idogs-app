import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAiBudget, AI_DAILY_REQUEST_LIMIT } from '../api/_lib/control-center-ai-budget.js'

// Serial transaction harness checks policy and adapter interactions, not
// actual cloud IO; emulator/provider verification is a separate release gate.
function database() {
  const docs = new Map()
  let queue = Promise.resolve()
  return {
    docs,
    collection: name => ({ doc: id => ({ id, path: `${name}/${id}`, update: async value => { const key = `${name}/${id}`; if (!docs.has(key)) throw new Error('not found'); docs.set(key, { ...docs.get(key), ...value }) } }) }),
    runTransaction(callback) {
      const run = queue.then(async () => {
        const writes = []
        const result = await callback({
          get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
          set: (ref, data) => writes.push([ref.path, data]),
          create: (ref, data) => { if (docs.has(ref.path)) throw new Error('exists'); writes.push([ref.path, data]) },
        })
        for (const [key, value] of writes) docs.set(key, value)
        return result
      })
      queue = run.catch(() => {})
      return run
    },
  }
}
test('shared daily ceiling applies to concurrent reservations and audit contains no prompts', async () => {
  const db = database()
  let id = 0
  const budget = createAiBudget(db, { now: () => new Date('2026-11-10T00:00:00Z'), newId: () => `request-${++id}` })
  const tickets = await Promise.all(Array.from({ length: 50 }, () => budget.reserve('admin-uid')))
  assert.equal(tickets.filter(Boolean).length, AI_DAILY_REQUEST_LIMIT)
  assert.equal(db.docs.get('controlCenterAiBudgets/2026-11-10').attempts, 20)
  assert.equal([...db.docs.keys()].filter(key => key.startsWith('controlCenterAiAudit/')).length, 20)
  assert.doesNotMatch(JSON.stringify([...db.docs.values()]), /admin-uid|question|prompt/)
  await budget.finish(tickets[0], 'UNAVAILABLE')
  assert.equal(db.docs.get('controlCenterAiBudgets/2026-11-10').attempts, 20)
  assert.equal(db.docs.get(`controlCenterAiAudit/${tickets[0].auditId}`).outcome, 'UNAVAILABLE')
})
test('corrupt existing counters fail closed and UTC date rollover starts a separate budget', async () => {
  const db = database()
  let day = '2026-11-10'
  const budget = createAiBudget(db, { now: () => new Date(`${day}T00:00:00Z`), newId: () => `request-${day}` })
  for (const attempts of [undefined, NaN, -1, 1.5, '0']) {
    db.docs.set('controlCenterAiBudgets/2026-11-10', { attempts })
    assert.equal(await budget.reserve('admin'), null)
  }
  day = '2026-11-11'
  assert.ok(await budget.reserve('admin'))
})
