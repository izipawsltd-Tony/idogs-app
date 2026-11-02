import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ send: vi.fn(), storage: new Map<string, string>() }))
vi.mock('firebase/auth', () => ({ sendEmailVerification: s.send }))
import { sendInitialVerification, verificationDelivery } from './signupVerification'
import type { User } from 'firebase/auth'
const user = { uid: 'qa-new-user', email: 'qa@example.invalid', emailVerified: false } as User
beforeEach(() => { s.send.mockReset().mockResolvedValue(undefined); s.storage.clear(); vi.stubGlobal('window', { location: { origin: 'https://qa.example.invalid' } }); vi.stubGlobal('sessionStorage', { getItem: (key: string) => s.storage.get(key), setItem: (key: string, value: string) => s.storage.set(key, value) }) })
afterEach(() => vi.unstubAllGlobals())
it('dispatches initial verification to this site and records a resend-aware status for only that UID', async () => {
  await sendInitialVerification(user)
  expect(s.send).toHaveBeenCalledWith(user, { url: 'https://qa.example.invalid/verify-email' })
  expect(verificationDelivery(user.uid)?.status).toBe('sent')
  expect(verificationDelivery('another-user')).toBeNull()
})
it('does not pretend that a failed email request was sent or prevent account creation', async () => {
  s.send.mockRejectedValue(new Error('network'))
  await expect(sendInitialVerification(user)).resolves.toBeUndefined()
  expect(verificationDelivery(user.uid)?.status).toBe('failed')
})
it('does not send verification to an already verified provider account or a phone-only account', async () => {
  await sendInitialVerification({ ...user, emailVerified: true } as User)
  await sendInitialVerification({ ...user, email: null } as User)
  expect(s.send).not.toHaveBeenCalled()
})

// Branded delivery (Resend) with Firebase default as fallback.
import { sendBrandedVerification, deliverVerificationEmail, brandedVerificationEnabled } from './signupVerification'
const tokenUser = { ...user, getIdToken: async () => 'id-token' } as unknown as User
const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch
it('branded email: posts only the ID token (no address/link from the client) and reports sent', async () => {
  const f = reply(200, { sent: true })
  expect(await sendBrandedVerification(tokenUser, f)).toBe('sent')
  const [url, init] = (f as any).mock.calls[0]
  expect(url).toBe('/api/send-verification-email'); expect(init.headers.Authorization).toBe('Bearer id-token'); expect(init.body).toBeUndefined()
})
it('branded email unavailable or erroring falls back to the Firebase default email', async () => {
  expect(await sendBrandedVerification(tokenUser, reply(200, { sent: false, reason: 'email_unavailable' }))).toBe('fallback')
  expect(await sendBrandedVerification(tokenUser, reply(503, {}))).toBe('fallback')
  expect(await sendBrandedVerification(tokenUser, vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBe('fallback')
  vi.stubGlobal('fetch', reply(503, {}))
  await deliverVerificationEmail(tokenUser, 'https://idogs.com.au/verify-email')
  expect(s.send).toHaveBeenCalledWith(tokenUser, { url: 'https://idogs.com.au/verify-email' })
})
it('rate-limited branded email is reported, never bypassed through the fallback', async () => {
  vi.stubGlobal('fetch', reply(429, {}))
  await expect(deliverVerificationEmail(tokenUser)).rejects.toThrow(/too-many-requests/)
  expect(s.send).not.toHaveBeenCalled()
})
it('successful branded email does not also send the Firebase default email', async () => {
  vi.stubGlobal('fetch', reply(200, { sent: true }))
  await sendInitialVerification(tokenUser)
  expect(s.send).not.toHaveBeenCalled(); expect(verificationDelivery(user.uid)?.status).toBe('sent')
})
it('kill switch', () => {
  expect(brandedVerificationEnabled({ VITE_IDOGS_BRANDED_VERIFICATION: '0' })).toBe(false)
  expect(brandedVerificationEnabled({})).toBe(true)
})
