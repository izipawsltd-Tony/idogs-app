import { randomUUID } from 'node:crypto'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
const state = vi.hoisted(() => ({ records: new Map(), io: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({
  collection: name => {
    const query = { where: () => query, get: async () => {
      state.io(name)
      return { docs: name === 'users' ? [{ id: 'owner', data: () => state.records.get('users/owner') }] : name === 'reminders' ? [{ id: 'r', data: () => state.records.get('reminders/r') }] : [] }
    }, doc: id => ({ path: `${name}/${id || randomUUID()}` }) }
    return query
  },
  runTransaction: async cb => {
    const writes = []
    const result = await cb({ get: async ref => ({ exists: state.records.has(ref.path), data: () => state.records.get(ref.path) }), set: (ref, data) => writes.push([ref.path, data]), update: (ref, data) => writes.push([ref.path, { ...state.records.get(ref.path), ...data }]) })
    writes.forEach(([key, value]) => state.records.set(key, value)); return result
  },
}) }))
import handler from '../api/send-reminders.js'

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret')
  vi.stubEnv('APP_URL', 'https://idogs-app-staging.vercel.app')
  vi.stubEnv('FIREBASE_PROJECT_ID', 'idogs-app-staging')
  vi.stubEnv('RESEND_API_KEY', 'synthetic-not-a-key')
  state.records.clear(); state.io.mockClear()
  state.records.set('users/owner', { email: 'synthetic@example.invalid', manualReminderEmails: true })
  state.records.set('dogs/dog', { currentOwnerId: 'owner', tenantId: 'breeder', name: 'QA' })
  state.records.set('reminders/r', { dogId: 'dog', tenantId: 'owner', source: 'manual', type: 'grooming', title: 'QA groom', status: 'pending', dueDate: new Date().toISOString().slice(0, 10), notifyDaysBefore: 0 })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'synthetic-provider-id' }) }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
async function call(headers = { 'x-cron-secret': 'synthetic-cron-secret' }, method = 'POST') {
  const result = {}; const res = { status: code => { result.status = code; return res }, json: body => { result.body = body; return result } }
  await handler({ headers, method }, res); return result
}
it('imports the full scheduler with its declared SNS dependency; rejects unauthenticated and wrong methods before I/O', async () => {
  expect((await call({})).status).toBe(401)
  expect((await call(undefined, 'GET')).status).toBe(405)
  expect(state.io).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})
it('runs the scheduler through a mocked provider, forwards an idempotency key, then skips the sent reminder', async () => {
  expect((await call()).body.emailSent).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, options] = fetch.mock.calls[0]
  expect(url).toBe('https://api.resend.com/emails')
  expect(options.headers['Idempotency-Key']).toMatch(/^manual-reminder\/[a-f0-9]{64}$/)
  expect(JSON.parse(options.body).html).toContain('https://idogs-app-staging.vercel.app/app/reminders')
  expect((await call()).body.emailSent).toBe(0)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('never calls a provider for legacy users without manual opt-in or an owner mismatch', async () => {
  state.records.get('users/owner').manualReminderEmails = false
  await call(); expect(fetch).not.toHaveBeenCalled()
  state.records.get('users/owner').manualReminderEmails = true
  state.records.get('dogs/dog').currentOwnerId = 'buyer'
  await call(); expect(fetch).not.toHaveBeenCalled()
})
it('does not count rejected provider requests as success', async () => {
  fetch.mockResolvedValue({ ok: false })
  expect((await call()).body.emailSent).toBe(0)
})

it('skips a frozen account before delivery or reminder regeneration', async () => {
  state.records.set('accountDeletionFences/owner', { state: 'frozen' })
  const before = new Map(state.records)
  expect((await call()).body.emailSent).toBe(0)
  expect(fetch).not.toHaveBeenCalled()
  expect(state.records).toEqual(before)
})
