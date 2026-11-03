import { describe, it, expect, vi } from 'vitest'
import { verificationEmailHandler, continueUrlFor, VERIFICATION_LIMITS, verificationSubject } from '../api/_lib/verification-email.js'

function setup({ apiKey = 'test-key', identity = { uid: 'new-user', email: 'owner@example.invalid', email_verified: false }, providerOk = true, linkFails = false } = {}) {
  const rows = new Map()
  let clock = 10_000_000
  const ref = key => ({ key })
  const db = {
    collection: () => ({ doc: ref }),
    runTransaction: async work => work({ get: async r => ({ exists: rows.has(r.key), data: () => rows.get(r.key) }), set: (r, data) => rows.set(r.key, data) }),
  }
  const fetchImpl = vi.fn(async () => ({ ok: providerOk }))
  const generateLink = vi.fn(async (email, settings) => { if (linkFails) throw new Error('auth/unauthorized-continue-uri'); return `https://idogs-app.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=X&continueUrl=${encodeURIComponent(settings?.url || "")}` })
  const verifyToken = vi.fn(async token => { if (token !== 'valid') throw new Error('invalid'); return identity })
  const handler = verificationEmailHandler({ verifyToken, generateLink, db, apiKey, fetchImpl, now: () => clock })
  async function request(overrides = {}) {
    const res = { setHeader: vi.fn(), status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid', origin: 'https://idogs.com.au' }, ...overrides }, res)
    return res
  }
  return { request, fetchImpl, generateLink, rows, tick: ms => { clock += ms } }
}

describe('branded verification email', () => {
  it('rejects unauthenticated requests and non-POST', async () => {
    const s = setup()
    expect((await s.request({ headers: {} })).code).toBe(401)
    expect((await s.request({ method: 'GET' })).code).toBe(405)
    expect(s.fetchImpl).not.toHaveBeenCalled(); expect(s.rows.size).toBe(0)
  })
  it('sends from iDogs <noreply@idogs.com.au> to the token email only, with iDogs subject and the Firebase link', async () => {
    const s = setup()
    const r = await s.request({ body: { to: 'attacker@example.invalid', link: 'https://evil.invalid' } })
    expect(r.code).toBe(200); expect(r.body.sent).toBe(true)
    const payload = JSON.parse(s.fetchImpl.mock.calls[0][1].body)
    expect(payload.from).toBe('iDogs <noreply@idogs.com.au>'); expect(payload.to).toEqual(['owner@example.invalid'])
    expect(payload.subject).toBe(verificationSubject); expect(payload.subject).not.toMatch(/idogs-app/)
    expect(payload.html).toContain('oobCode=X'); expect(payload.text).toContain('oobCode=X')
    expect(payload.html).not.toContain('evil.invalid'); expect(payload.html).not.toContain('idogs-app team')
    expect(s.generateLink).toHaveBeenCalledWith('owner@example.invalid', { url: 'https://idogs.com.au/verify-email' })
  })
  it('never emails verified or email-less accounts, and skips when Resend is not configured', async () => {
    expect((await setup({ identity: { uid: 'u', email: 'a@example.invalid', email_verified: true } }).request()).body.reason).toBe('already_verified')
    expect((await setup({ identity: { uid: 'u', phone_number: '+61400000000' } }).request()).body.reason).toBe('no_email')
    const s = setup({ apiKey: null }); expect((await s.request()).body.reason).toBe('email_unavailable'); expect(s.fetchImpl).not.toHaveBeenCalled()
  })
  it('continue URL is limited to iDogs origins', () => {
    expect(continueUrlFor('https://evil.invalid')).toBe('https://idogs.com.au/verify-email')
    expect(continueUrlFor('https://idogs-app-staging-git-x-izipawsltd-tonys-projects.vercel.app')).toMatch(/vercel\.app\/verify-email$/)
    expect(continueUrlFor(undefined)).toBe('https://idogs.com.au/verify-email')
    expect(continueUrlFor('capacitor://localhost')).toBe('https://idogs.com.au/verify-email')
  })
  it('durable per-account rate limit: min interval and max per hour', async () => {
    const s = setup()
    expect((await s.request()).code).toBe(200)
    expect((await s.request()).code).toBe(429)
    for (let i = 1; i < VERIFICATION_LIMITS.MAX_PER_WINDOW; i++) { s.tick(VERIFICATION_LIMITS.MIN_INTERVAL_MS); expect((await s.request()).code).toBe(200) }
    s.tick(VERIFICATION_LIMITS.MIN_INTERVAL_MS); expect((await s.request()).code).toBe(429)
    s.tick(VERIFICATION_LIMITS.WINDOW_MS); expect((await s.request()).code).toBe(200)
    expect([...s.rows.keys()][0]).not.toContain('new-user')
  })
  it('provider or link failure returns 503 so the client falls back', async () => {
    expect((await setup({ providerOk: false }).request()).code).toBe(503)
    const s = setup({ linkFails: true }); expect((await s.request()).code).toBe(503); expect(s.fetchImpl).not.toHaveBeenCalled()
  })
})

describe('continue URL not authorized in Firebase', () => {
  it('retries link generation without the continue URL instead of failing', async () => {
    const s = setup()
    s.generateLink.mockImplementationOnce(async () => { throw Object.assign(new Error('x'), { code: 'auth/unauthorized-continue-uri' }) })
    const r = await s.request({ headers: { authorization: 'Bearer valid', origin: 'https://idogs-app-staging-git-new-host.vercel.app' } })
    expect(r.code).toBe(200); expect(r.body.sent).toBe(true)
    expect(s.generateLink).toHaveBeenCalledTimes(2); expect(s.generateLink.mock.calls[1]).toEqual(['owner@example.invalid'])
  })
})

describe('failed deliveries do not consume the allowance', () => {
  it('refunds the reservation when link generation or the provider fails', async () => {
    const s = setup({ providerOk: false })
    for (let i = 0; i < VERIFICATION_LIMITS.MAX_PER_WINDOW + 2; i++) expect((await s.request()).code).toBe(503)
    expect([...s.rows.values()][0].count).toBe(0)
  })
})

describe('independent review fixes', () => {
  it('per-account daily cap: at most MAX_PER_DAY branded emails per UTC day', async () => {
    const s = setup()
    let ok = 0
    for (let i = 0; i < 30; i++) { const r = await s.request(); if (r.code === 200) ok++; s.tick(VERIFICATION_LIMITS.WINDOW_MS / 4) }
    expect(ok).toBeLessThanOrEqual(VERIFICATION_LIMITS.MAX_PER_DAY)
  })
  it('global daily ceiling: beyond it the client is told to use the Firebase email (no 429, no Resend call)', async () => {
    const { DAILY_CEILING } = await import('../api/_lib/verification-email.js')
    const s = setup()
    s.rows.set(`_daily_${new Date(10_000_000).toISOString().slice(0, 10)}`, { count: DAILY_CEILING })
    const r = await s.request()
    expect(r.code).toBe(200); expect(r.body.reason).toBe('daily_ceiling'); expect(s.fetchImpl).not.toHaveBeenCalled()
  })
  it('does not retry link generation on quota errors (no double Firebase usage)', async () => {
    const s = setup()
    s.generateLink.mockImplementation(async () => { throw Object.assign(new Error('An internal error has occurred.'), { code: 'auth/internal-error' }) })
    expect((await s.request()).code).toBe(503)
    expect(s.generateLink).toHaveBeenCalledTimes(1)
  })
  it('Resend timeout is reported as sent (uncertain) so the client does not send a second email', async () => {
    const s = setup()
    s.fetchImpl.mockImplementation(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) })
    const r = await s.request()
    expect(r.code).toBe(200); expect(r.body).toMatchObject({ sent: true, uncertain: true })
  })
  it('continue-URL allowlist is pinned to this Vercel team', async () => {
    const { continueUrlFor } = await import('../api/_lib/verification-email.js')
    expect(continueUrlFor('https://idogs-app-evil.vercel.app')).toBe('https://idogs.com.au/verify-email')
    expect(continueUrlFor('https://idogs-app-staging-git-claude-r-97c005-izipawsltd-tonys-projects.vercel.app')).toMatch(/izipawsltd-tonys-projects\.vercel\.app\/verify-email$/)
  })
})
