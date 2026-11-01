import { beforeEach, describe, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ current: null as any, link: vi.fn(), reload: vi.fn(), verify: vi.fn(), cred: vi.fn(), setPw: vi.fn() }))
vi.mock('./firebase', () => ({ auth: { get currentUser() { return s.current } } }))
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: s.cred }, linkWithCredential: s.link, reload: s.reload, sendEmailVerification: s.verify, updatePassword: s.setPw,
}))
import { emailPasswordLinkEnabled, emailPasswordLinkErrorMessage, linkEmailPasswordToCurrentAccount, needsPasswordSignIn, validateEmailPasswordLink } from './emailPasswordLink'

const phoneUser = () => ({ uid: 'cust-uid-1', email: null as string | null, emailVerified: false, providerData: [{ providerId: 'phone' }] })
beforeEach(() => {
  s.current = phoneUser()
  s.cred.mockReset().mockImplementation((email: string, password: string) => ({ email, password }))
  s.reload.mockReset().mockResolvedValue(undefined)
  s.verify.mockReset().mockResolvedValue(undefined)
  s.setPw.mockReset().mockResolvedValue(undefined)
  s.link.mockReset().mockImplementation(async (user: any, c: any) => ({ user: { ...user, email: c.email, emailVerified: false, providerData: [...user.providerData, { providerId: 'password' }] } }))
})

describe('emailPasswordLink', () => {
  it('links email+password to the SAME uid (dogs/docs/QR/Plus keyed on uid are preserved)', async () => {
    const r = await linkEmailPasswordToCurrentAccount(s.current, ' Owner@Example.com ', 'longpassword', 'longpassword')
    expect(r).toEqual({ uid: 'cust-uid-1', email: 'owner@example.com', emailVerified: false, verificationSent: true })
    expect(s.cred).toHaveBeenCalledWith('owner@example.com', 'longpassword')
    expect(s.link).toHaveBeenCalledOnce()
  })
  it('keeps an existing verified email and sets a password on the same account (no credential link)', async () => {
    s.current = { ...phoneUser(), email: 'kept@example.com', emailVerified: true }
    const r = await linkEmailPasswordToCurrentAccount(s.current, 'other@example.com', 'longpassword', 'longpassword')
    expect(s.setPw).toHaveBeenCalledWith(s.current, 'longpassword')
    expect(s.link).not.toHaveBeenCalled()
    expect(r).toEqual({ uid: 'cust-uid-1', email: 'kept@example.com', emailVerified: true, verificationSent: false })
    expect(s.verify).not.toHaveBeenCalled()
  })
  it('sends verification after setting a password for an existing but unverified email', async () => {
    s.current = { ...phoneUser(), email: 'unverified@example.com', emailVerified: false }
    const r = await linkEmailPasswordToCurrentAccount(s.current, '', 'longpassword', 'longpassword')
    expect(s.setPw).toHaveBeenCalledOnce(); expect(r.verificationSent).toBe(true)
  })
  it('refuses when a password provider is already linked', async () => {
    s.current = { ...phoneUser(), providerData: [{ providerId: 'phone' }, { providerId: 'password' }] }
    await expect(linkEmailPasswordToCurrentAccount(s.current, 'a@b.co', 'longpassword', 'longpassword')).rejects.toThrow('provider-already-linked')
    expect(s.link).not.toHaveBeenCalled()
  })
  it('fails closed if the signed-in account changes during the flow', async () => {
    const u = s.current; s.reload.mockImplementation(async () => { s.current = { ...phoneUser(), uid: 'someone-else' } })
    await expect(linkEmailPasswordToCurrentAccount(u, 'a@b.co', 'longpassword', 'longpassword')).rejects.toThrow('session-changed')
    expect(s.link).not.toHaveBeenCalled()
  })
  it('fails closed if Firebase returns a different uid', async () => {
    s.link.mockImplementation(async (user: any) => ({ user: { ...user, uid: 'new-uid' } }))
    await expect(linkEmailPasswordToCurrentAccount(s.current, 'a@b.co', 'longpassword', 'longpassword')).rejects.toThrow('session-changed')
  })
  it('does not report link failure when only the verification email fails', async () => {
    s.verify.mockRejectedValue(new Error('auth/too-many-requests'))
    const r = await linkEmailPasswordToCurrentAccount(s.current, 'a@b.co', 'longpassword', 'longpassword')
    expect(r.verificationSent).toBe(false); expect(r.uid).toBe('cust-uid-1')
  })
  it('validates input before contacting Firebase', () => {
    const u = phoneUser() as any
    expect(() => validateEmailPasswordLink(u, 'bad', 'longpassword', 'longpassword')).toThrow('valid email')
    expect(() => validateEmailPasswordLink(u, 'a@b.co', 'short', 'short')).toThrow('8–128')
    expect(() => validateEmailPasswordLink(u, 'a@b.co', 'longpassword', 'longpasswordX')).toThrow('do not match')
  })
  it('maps email-in-use to a no-merge message', () => {
    expect(emailPasswordLinkErrorMessage(new Error('Firebase: Error (auth/email-already-in-use).'))).toContain('No accounts, dogs or subscriptions have been merged')
    expect(emailPasswordLinkErrorMessage(new Error('Firebase: Error (auth/requires-recent-login).'))).toContain('sign in again with your mobile number')
  })
  it('needsPasswordSignIn and kill switch', () => {
    expect(needsPasswordSignIn(phoneUser() as any)).toBe(true)
    expect(needsPasswordSignIn({ ...phoneUser(), providerData: [{ providerId: 'password' }] } as any)).toBe(false)
    expect(emailPasswordLinkEnabled({})).toBe(true)
    expect(emailPasswordLinkEnabled({ VITE_IDOGS_EMAIL_PASSWORD_LINK: '0' })).toBe(false)
  })
})
it('does not offer linking when provider data is unknown', () => {
  expect(needsPasswordSignIn({ uid: 'x', email: null } as any)).toBe(false)
  expect(needsPasswordSignIn({ uid: 'x', email: null, providerData: [] } as any)).toBe(false)
})
