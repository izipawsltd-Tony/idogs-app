import { describe, it, expect } from 'vitest'
import { CARE_TYPES, categoryEmailEnabled, manualReminderEligible, deliverManualReminder } from '../api/_lib/manual-reminder-delivery.js'

const now = new Date('2026-10-19T22:00:00Z')
function fixture() {
  const user = { email: 'synthetic@example.invalid', manualReminderEmails: true }
  const reminder = { dogId: 'dog', tenantId: 'owner', source: 'manual', type: 'custom', status: 'pending', title: '<b>Check</b>', dueDate: '2026-10-22', notifyDaysBefore: 3 }
  const dog = { currentOwnerId: 'owner', tenantId: 'breeder', name: '<QA>', status: 'active' }
  const records = new Map([['users/owner', user], ['reminders/r', reminder], ['dogs/dog', dog]])
  let tail = Promise.resolve()
  const db = {
    collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }),
    runTransaction: cb => {
      const run = tail.then(async () => {
        const writes = []
        const value = await cb({ get: async ref => ({ data: () => records.get(ref.path) }), set: (ref, data) => writes.push([ref.path, data]) })
        writes.forEach(([key, value]) => records.set(key, value))
        return value
      })
      tail = run.catch(() => {})
      return run
    },
  }
  const run = (sendEmail, at = now) => deliverManualReminder({ db, tenantId: 'owner', reminderId: 'r', now: at, sendEmail, projectId: 'idogs-app-staging', appUrl: 'https://qa.example.invalid' })
  const eligible = () => manualReminderEligible({ user, reminder, dog, tenantId: 'owner', now })
  return { records, user, reminder, dog, run, eligible }
}

describe('manual care email delivery with synthetic I/O', () => {
  it.each(CARE_TYPES)('delivers %s on the lead date; escapes content and never re-sends once', async type => {
    const f = fixture(); f.reminder.type = type
    const calls = []
    const send = async (payload, key) => { calls.push({ payload, key }); return true }
    expect(await f.run(send)).toMatchObject({ sent: true })
    expect(await f.run(send)).toMatchObject({ sent: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].payload.html).toContain('&lt;QA&gt;')
    expect(calls[0].payload.html).not.toContain('<b>Check</b>')
  })
  it.each(['opt-out', 'legacy-no-opt-in', 'master-off', 'category-off', 'completed', 'foreign-tenant', 'new-owner', 'pending-transfer', 'missing-owner', 'invalid-date', 'invalid-lead', 'too-early', 'too-old', 'wrong-source', 'unknown-type'])('blocks %s before delivery or ledger mutation', async condition => {
    const f = fixture()
    if (condition === 'opt-out') f.user.manualReminderEmails = false
    if (condition === 'legacy-no-opt-in') delete f.user.manualReminderEmails
    if (condition === 'master-off') f.user.emailReminders = false
    if (condition === 'category-off') f.user.careEmailTypes = { custom: false }
    if (condition === 'completed') f.reminder.status = 'completed'
    if (condition === 'foreign-tenant') f.reminder.tenantId = 'breeder'
    if (condition === 'new-owner') f.dog.currentOwnerId = 'buyer'
    if (condition === 'pending-transfer') f.dog.status = 'transferred'
    if (condition === 'missing-owner') f.dog.currentOwnerId = ''
    if (condition === 'invalid-date') f.reminder.dueDate = '2026-02-30'
    if (condition === 'invalid-lead') f.reminder.notifyDaysBefore = -1
    if (condition === 'too-early') f.reminder.notifyDaysBefore = 1
    if (condition === 'too-old') f.reminder.dueDate = '2026-09-01'
    if (condition === 'wrong-source') f.reminder.source = 'breeding_timeline'
    if (condition === 'unknown-type') f.reminder.type = 'unknown'
    expect(f.eligible()).toBe(false)
    const size = f.records.size
    await f.run(async () => { throw new Error('Must not call provider') })
    expect(f.records.size).toBe(size)
  })
  it('supports legacy owner only when currentOwnerId is absent', () => {
    const f = fixture(); delete f.dog.currentOwnerId; f.dog.tenantId = 'owner'
    expect(f.eligible()).toBe(true)
  })
  it('serializes concurrent claims and retries ambiguous failures using the same key and body', async () => {
    const f = fixture(); const calls = []
    const send = async (body, key) => { calls.push({ body, key }); throw new Error('timeout') }
    await Promise.all([f.run(send), f.run(send)])
    expect(calls).toHaveLength(1)
    await f.run(async (body, key) => { calls.push({ body, key }); return true })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(calls[1])
  })
  it('stops retries before the provider idempotency window expires', async () => {
    const f = fixture(); await f.run(async () => false)
    const result = await f.run(async () => { throw new Error('must not send') }, new Date(+now + 23 * 3600000))
    expect(result.sent).toBe(false)
    expect([...f.records.values()].some(v => v.status === 'review_required')).toBe(true)
  })
  it('re-checks ownership, completion and preferences on retry', async () => {
    for (const change of [f => { f.dog.currentOwnerId = 'buyer' }, f => { f.reminder.status = 'completed' }, f => { f.user.emailReminders = false }]) {
      const f = fixture(); await f.run(async () => false); change(f)
      expect((await f.run(async () => { throw new Error('must not send') })).sent).toBe(false)
    }
  })
  it('holds changed recipient/content for review after an ambiguous attempt', async () => {
    const f = fixture(); await f.run(async () => false); f.user.email = 'changed@example.invalid'
    await f.run(async () => { throw new Error('must not send') })
    expect([...f.records.values()].some(v => v.status === 'review_required')).toBe(true)
  })
  it('daily emails use distinct days and stop after due date', async () => {
    const f = fixture(); f.user.reminderFrequency = 'daily'
    let calls = 0; const send = async () => { calls++; return true }
    await f.run(send); await f.run(send)
    await f.run(send, new Date('2026-10-20T22:00:00Z'))
    await f.run(send, new Date('2026-10-23T22:00:00Z'))
    expect(calls).toBe(2)
  })
  it('maps legacy vaccine category and retains default preferences', () => {
    expect(categoryEmailEnabled({}, 'vaccine')).toBe(true)
    expect(categoryEmailEnabled({ careEmailTypes: { vaccination: false } }, 'vaccine')).toBe(false)
  })
})
