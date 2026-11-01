import { beforeEach, describe, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ current: null as any, reload: vi.fn(), updatePassword: vi.fn() }))
vi.mock('./firebase', () => ({ auth: { get currentUser() { return s.current } } }))
vi.mock('firebase/auth', () => ({ reload: s.reload, updatePassword: s.updatePassword }))
import {
  addPasswordToVerifiedEmail, emailPasswordLinkEnabled, emailPasswordLinkErrorMessage, emailPasswordStep,
  needsPasswordSignIn, validateNewPassword,
} from './emailPasswordLink'

const phoneUser = (extra: Record<string, unknown> = {}) => ({ uid: 'cust-uid-1', email: null as string | null, emailVerified: false, providerData: [{ providerId: 'phone' }], ...extra })
beforeEach(() => {
  s.current = phoneUser({ email: 'owner@example.com', emailVerified: true })
  s.reload.mockReset().mockResolvedValue(undefined)
  s.updatePassword.mockReset().mockImplementation(async (user: any) => {
    s.current = { ...user, providerData: [...user.providerData, { providerId: 'password' }] }
  })
})

describe('emailPasswordStep', () => {
  it('SMS-only account without email → verify email first (never links an unverified address)', () => {
    expect(emailPasswordStep(phoneUser() as any)).toBe('verify-email')
  })
  it('account with UNVERIFIED email → verify email first', () => {
    expect(emailPasswordStep(phoneUser({ email: 'x@example.com', emailVerified: false }) as any)).toBe('verify-email')
  })
  it('account with VERIFIED email and no password → set password', () => {
    expect(emailPasswordStep(phoneUser({ email: 'x@example.com', emailVerified: true }) as any)).toBe('set-password')
  })
  it('hidden when password sign-in already exists, or provider data unknown', () => {
    expect(emailPasswordStep(phoneUser({ providerData: [{ providerId: 'phone' }, { providerId: 'password' }] }) as any)).toBe('hidden')
    expect(emailPasswordStep({ uid: 'x', email: null, emailVerified: false, providerData: [] } as any)).toBe('hidden')
    expect(emailPasswordStep(null)).toBe('hidden')
  })
})

describe('addPasswordToVerifiedEmail', () => {
  it('sets a password on the SAME uid (dogs/docs/QR/Plus keyed on uid are preserved)', async () => {
    const u = s.current
    const r = await addPasswordToVerifiedEmail(u, 'longpassword', 'longpassword')
    expect(r).toEqual({ uid: 'cust-uid-1', email: 'owner@example.com' })
    expect(s.updatePassword).toHaveBeenCalledWith(u, 'longpassword')
  })
  it('refuses an unverified email without calling Firebase', async () => {
    s.current = phoneUser({ email: 'squat@example.com', emailVerified: false })
    await expect(addPasswordToVerifiedEmail(s.current, 'longpassword', 'longpassword')).rejects.toThrow('email-not-verified')
    expect(s.updatePassword).not.toHaveBeenCalled()
  })
  it('refuses an account with no email', async () => {
    s.current = phoneUser()
    await expect(addPasswordToVerifiedEmail(s.current, 'longpassword', 'longpassword')).rejects.toThrow('email-not-verified')
    expect(s.updatePassword).not.toHaveBeenCalled()
  })
  it('refuses when a password provider is already linked', async () => {
    s.current = phoneUser({ email: 'a@b.co', emailVerified: true, providerData: [{ providerId: 'phone' }, { providerId: 'password' }] })
    await expect(addPasswordToVerifiedEmail(s.current, 'longpassword', 'longpassword')).rejects.toThrow('provider-already-linked')
    expect(s.updatePassword).not.toHaveBeenCalled()
  })
  it('fails closed if the signed-in account changes during the flow', async () => {
    const u = s.current; s.reload.mockImplementation(async () => { s.current = phoneUser({ uid: 'someone-else' }) })
    await expect(addPasswordToVerifiedEmail(u, 'longpassword', 'longpassword')).rejects.toThrow('session-changed')
    expect(s.updatePassword).not.toHaveBeenCalled()
  })
  it('fails closed if the account changes after the password is set', async () => {
    s.updatePassword.mockImplementation(async () => { s.current = phoneUser({ uid: 'new-uid' }) })
    await expect(addPasswordToVerifiedEmail(s.current, 'longpassword', 'longpassword')).rejects.toThrow('session-changed')
  })
  it('surfaces requires-recent-login (revoked/old session) as a re-auth message', async () => {
    s.updatePassword.mockRejectedValue(new Error('Firebase: Error (auth/requires-recent-login).'))
    const err = await addPasswordToVerifiedEmail(s.current, 'longpassword', 'longpassword').catch(e => e)
    expect(emailPasswordLinkErrorMessage(err)).toContain('sign in again with your mobile number')
  })
  it('validates passwords before contacting Firebase', async () => {
    expect(() => validateNewPassword('short', 'short')).toThrow('8–128')
    expect(() => validateNewPassword('longpassword', 'longpasswordX')).toThrow('do not match')
    await expect(addPasswordToVerifiedEmail(s.current, 'short', 'short')).rejects.toThrow('8–128')
    expect(s.updatePassword).not.toHaveBeenCalled()
  })
})

describe('messages and switches', () => {
  it('maps errors to customer-safe text', () => {
    expect(emailPasswordLinkErrorMessage(new Error('email-not-verified'))).toContain('Verify your email')
    expect(emailPasswordLinkErrorMessage(new Error('Firebase: Error (auth/email-already-in-use).'))).toContain('No accounts, dogs or subscriptions have been merged')
    expect(emailPasswordLinkErrorMessage(new Error('Firebase: Error (auth/user-token-expired).'))).toContain('sign in again')
    expect(emailPasswordLinkErrorMessage(new Error('Firebase: Error (auth/user-disabled).'))).toContain('disabled')
    expect(emailPasswordLinkErrorMessage(new Error('Firebase: Error (auth/internal-error).'))).toBe('Could not add email sign-in. Please try again shortly.')
  })
  it('needsPasswordSignIn and kill switch', () => {
    expect(needsPasswordSignIn(phoneUser() as any)).toBe(true)
    expect(needsPasswordSignIn({ providerData: [{ providerId: 'password' }] } as any)).toBe(false)
    expect(emailPasswordLinkEnabled({})).toBe(true)
    expect(emailPasswordLinkEnabled({ VITE_IDOGS_EMAIL_PASSWORD_LINK: '0' })).toBe(false)
  })
})
