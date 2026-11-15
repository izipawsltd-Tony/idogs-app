import { describe, it, expect, vi } from 'vitest'
import { welcomeHandler } from '../api/_lib/welcome-user.js'

function setup({ apiKey = 'test-key', identity = { uid: 'new-user', email: 'owner@example.invalid' }, failure = false } = {}) {
  const rows = new Map()
  const ref = key => ({ key, set: async data => rows.set(key, { ...rows.get(key), ...data }) })
  const db = {
    collection: () => ({ doc: ref }),
    runTransaction: async work => work({ get: async r => ({ exists: rows.has(r.key), data: () => rows.get(r.key) }), set: (r, data) => rows.set(r.key, { ...rows.get(r.key), ...data }) }),
  }
  const fetchImpl = vi.fn(async () => { if (failure) throw new Error('timeout'); return { ok: true } })
  const verifyToken = vi.fn(async token => { if (token !== 'valid') throw new Error('invalid'); return identity })
  const handler = welcomeHandler({ verifyToken, db, apiKey, fetchImpl, now: () => 1000000 })
  async function request(overrides = {}) {
    const res = { setHeader: vi.fn(), status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid' }, ...overrides }, res)
    return res
  }
  return { request, fetchImpl, rows }
}

describe('account welcome delivery', () => {
  it('rejects unauthenticated requests without sending or reserving a delivery', async () => {
    const s = setup(); expect((await s.request({ headers: {} })).code).toBe(401)
    expect(s.fetchImpl).not.toHaveBeenCalled(); expect(s.rows.size).toBe(0)
  })
  it('uses only the authenticated address and fixed content, ignoring client messages and links', async () => {
    const s = setup(); expect((await s.request({ body: { to_email: 'attacker@example.invalid', message: 'spam', action_url: 'https://evil.invalid' } })).body.sent).toBe(true)
    const [url, options] = s.fetchImpl.mock.calls[0], payload = JSON.parse(options.body)
    expect(url).toBe('https://api.resend.com/emails'); expect(payload.to).toEqual(['owner@example.invalid'])
    expect(payload.text).toContain('Following puppies'); expect(payload.text).toContain('https://idogs.com.au/app/start')
    expect(payload.text).not.toContain('spam'); expect(payload.text).not.toContain('evil.invalid')
  })
  it('does not resend when the client retries', async () => {
    const s = setup(); await s.request(); expect((await s.request()).body.reason).toBe('already_requested')
    expect(s.fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('deduplicates on normalized email, not account ID', async () => {
    const identity = { uid: 'first', email: 'Owner@example.invalid' }, s = setup({ identity })
    await s.request(); identity.uid = 'recreated'; identity.email = 'owner@example.invalid'; await s.request()
    expect(s.fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('skips delivery when QA has no email credentials', async () => {
    const s = setup({ apiKey: null }); expect((await s.request()).body.reason).toBe('email_unavailable')
    expect(s.fetchImpl).not.toHaveBeenCalled(); expect(s.rows.size).toBe(0)
  })
  it('skips accounts without email instead of pretending SMS was sent', async () => {
    const s = setup({ identity: { uid: 'phone-user' } }); expect((await s.request()).body.reason).toBe('no_email')
    expect(s.fetchImpl).not.toHaveBeenCalled()
  })
  it('holds a lease on ambiguous delivery failures to prevent immediate duplicate messages', async () => {
    const s = setup({ failure: true }); expect((await s.request()).code).toBe(503)
    await s.request(); expect(s.fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('rejects GET requests without sending', async () => {
    const s = setup(); expect((await s.request({ method: 'GET' })).code).toBe(405); expect(s.fetchImpl).not.toHaveBeenCalled()
  })
})
