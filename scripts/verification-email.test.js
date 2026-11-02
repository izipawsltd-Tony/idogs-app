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
    s.generateLink.mockImplementationOnce(async () => { throw new Error('auth/unauthorized-continue-uri') })
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
