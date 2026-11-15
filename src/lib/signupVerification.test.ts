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
