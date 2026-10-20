import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { makeStagingSmsQaHandler, QA_MESSAGE, QA_EVENT } from '../api/_lib/staging-sms-qa.js'
import { countSmsSegments } from '../api/_lib/sms-addon.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const env = { VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o', FIREBASE_PROJECT_ID: 'idogs-app-staging' }
const now = new Date('2026-10-20T12:00:00Z')
const profile = { phone: '0400000000', smsAddonStatus: 'active', smsCreditsUsed: 0,
  smsCreditsLimit: 1, smsPeriodStart: '2026-10-20T00:00:00Z', smsPeriodEnd: '2026-10-21T00:00:00Z' }
const snap = value => ({ exists: value !== undefined, data: () => structuredClone(value) })
class Db {
  constructor() { this.data = { 'users/qa': structuredClone(profile) }; this.queue = Promise.resolve() }
  collection(col) { return { doc: id => {
    const path = `${col}/${id}`
    return { path, get: async () => snap(this.data[path]), set: async (data, opts) => {
      this.data[path] = opts?.merge ? { ...this.data[path], ...data } : data
    } }
  } } }
  runTransaction(fn) {
    const next = this.queue.then(async () => {
      const writes = []
      const result = await fn({ get: ref => ref.get(), set: (ref, data, opts) => writes.push([ref, data, opts]) })
      for (const [ref, data, opts] of writes) await ref.set(data, opts)
      return result
    })
    this.queue = next.catch(() => {})
    return next
  }
}
function fixture(options = {}) {
  const db = new Db()
  const provider = vi.fn().mockResolvedValue({ providerMessageId: 'synthetic-message-id' })
  const authenticate = vi.fn().mockResolvedValue({ uid: 'qa' })
  const handler = makeStagingSmsQaHandler({ db, sendProvider: provider, authenticate, env,
    projectId: 'idogs-app-staging', clock: () => now,
    policy: { uidHash: hash('qa'), phoneHash: hash('+61400000000') }, ...options })
  async function request(method = 'POST', body = { action: 'send_once' }, headers = { authorization: 'Bearer synthetic' }) {
    const res = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method, body, headers }, res)
    return res
  }
  return { db, provider, authenticate, request }
}

describe('bounded staging SMS QA (no live network)', () => {
  it.each([
    { ...env, VERCEL_ENV: 'production' },
    { ...env, VERCEL_PROJECT_ID: 'production-project' },
    { ...env, FIREBASE_PROJECT_ID: 'idogs-app' },
  ])('fails closed outside exact staging Preview', async badEnv => {
    const f = fixture({ env: badEnv }); expect((await f.request()).code).toBe(404)
    expect(f.authenticate).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled()
  })
  it('checks the initialized Firebase app project too', async () => {
    const f = fixture({ projectId: 'idogs-app' }); expect((await f.request()).code).toBe(404)
    expect(f.provider).not.toHaveBeenCalled()
  })
  it('expires automatically at the QA cutoff', async () => {
    const f = fixture({ clock: () => new Date('2026-10-21T00:00:00Z') })
    expect((await f.request()).code).toBe(404); expect(f.provider).not.toHaveBeenCalled()
  })
  it('requires authentication and the approved QA identity', async () => {
    const f = fixture(); expect((await f.request('POST', {}, {})).code).toBe(401)
    const other = fixture({ authenticate: async () => ({ uid: 'other' }) })
    expect((await other.request()).code).toBe(404); expect(other.provider).not.toHaveBeenCalled()
  })
  it('rejects a different phone and arbitrary recipient/message input', async () => {
    const f = fixture(); f.db.data['users/qa'].phone = '0400000001'
    expect((await f.request()).code).toBe(409); expect(f.provider).not.toHaveBeenCalled()
    const g = fixture(); expect((await g.request('POST', { action: 'send_once', phone: 'other' })).code).toBe(400)
    expect(g.provider).not.toHaveBeenCalled()
  })
  it('GET is read-only and never sends', async () => {
    const f = fixture(); expect((await f.request('GET')).body.status).toBe('ready')
    expect(Object.keys(f.db.data)).toHaveLength(1); expect(f.provider).not.toHaveBeenCalled()
  })
  it.each([{ smsAddonStatus: 'inactive' }, { smsCreditsUsed: 1 }, { smsCreditsLimit: 20 },
    { smsPeriodEnd: '2026-10-20T01:00:00Z' }])('requires bounded, current entitlement %j', async fields => {
    const f = fixture(); Object.assign(f.db.data['users/qa'], fields)
    expect((await f.request()).code).toBe(409); expect(f.provider).not.toHaveBeenCalled()
  })
  it('sends the fixed one-segment reminder once and records provider acceptance', async () => {
    const f = fixture(); const r = await f.request()
    expect(r.code).toBe(200); expect(r.body.status).toBe('accepted')
    expect(countSmsSegments(QA_MESSAGE)).toBe(1)
    expect(f.provider).toHaveBeenCalledWith('+61400000000', QA_MESSAGE, expect.objectContaining({ deliveryId: expect.any(String) }))
    expect(f.db.data['users/qa'].smsCreditsUsed).toBe(1)
    expect(f.db.data[`smsQaAttempts/${QA_EVENT}`].providerMessageId).toBe('synthetic-message-id')
    expect((await f.request()).code).toBe(409); expect(f.provider).toHaveBeenCalledTimes(1)
    expect((await f.request('GET')).body.status).toBe('accepted')
  })
  it('concurrent clicks cannot produce two sends', async () => {
    const f = fixture(); await Promise.all([f.request(), f.request()])
    expect(f.provider).toHaveBeenCalledTimes(1); expect(f.db.data['users/qa'].smsCreditsUsed).toBe(1)
  })
  it.each([true, false])('does not retry either rejected or ambiguous outcomes: definitive=%s', async definitive => {
    const f = fixture(); f.provider.mockRejectedValue(Object.assign(new Error('synthetic failure'), { definitive }))
    await f.request(); await f.request()
    expect(f.provider).toHaveBeenCalledTimes(1)
    expect(f.db.data['users/qa'].smsCreditsUsed).toBe(definitive ? 0 : 1)
    expect((await f.request('GET')).body.status).toBe(definitive ? 'blocked' : 'unknown')
  })
})
