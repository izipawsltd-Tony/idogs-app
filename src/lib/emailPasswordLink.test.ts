import { beforeEach, describe, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ current: null as any, reload: vi.fn(), updatePassword: vi.fn(), sendLink: vi.fn(), isLink: vi.fn(), link: vi.fn(), credWithLink: vi.fn(), store: new Map<string, string>() }))
vi.mock('./firebase', () => ({ auth: { get currentUser() { return s.current } } }))
vi.mock('firebase/auth', () => ({
  reload: s.reload, updatePassword: s.updatePassword, sendSignInLinkToEmail: s.sendLink, isSignInWithEmailLink: s.isLink,
  linkWithCredential: s.link, EmailAuthProvider: { credentialWithLink: s.credWithLink },
}))
vi.stubGlobal('localStorage', { getItem: (k: string) => s.store.get(k) ?? null, setItem: (k: string, v: string) => s.store.set(k, v), removeItem: (k: string) => s.store.delete(k) })
import {
  addPasswordToVerifiedEmail, completeAddEmailLink, emailPasswordLinkEnabled, emailPasswordLinkErrorMessage, emailPasswordStep,
  isAddEmailLink, needsPasswordSignIn, PENDING_EMAIL_LINK_KEY, sendAddEmailLink, validateNewPassword,
} from './emailPasswordLink'
const LINK = 'https://idogs.com.au/app/settings?addEmail=1&mode=signIn&oobCode=X&apiKey=K'

const phoneUser = (extra: Record<string, unknown> = {}) => ({ uid: 'cust-uid-1', email: null as string | null, emailVerified: false, providerData: [{ providerId: 'phone' }], ...extra })
beforeEach(() => {
  s.current = phoneUser({ email: 'owner@example.com', emailVerified: true })
  s.reload.mockReset().mockResolvedValue(undefined)
  s.updatePassword.mockReset().mockImplementation(async (user: any) => {
    s.current = { ...user, providerData: [...user.providerData, { providerId: 'password' }] }
  })
  s.store.clear()
  s.sendLink.mockReset().mockResolvedValue(undefined)
  s.isLink.mockReset().mockImplementation((_a: unknown, href: string) => href.includes('oobCode='))
  s.credWithLink.mockReset().mockImplementation((email: string, href: string) => ({ email, href }))
  s.link.mockReset().mockImplementation(async (user: any, c: any) => {
    s.current = { ...user, email: c.email, emailVerified: true, providerData: [...user.providerData, { providerId: 'password' }] }
    return { user: s.current }
  })
})

describe('emailPasswordStep', () => {
  it('SMS-only account without email → add-email (ownership proved by emailed link)', () => {
    expect(emailPasswordStep(phoneUser() as any)).toBe('add-email')
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

describe('add email for SMS-only accounts (emailed link → verified, same uid)', () => {
  beforeEach(() => { s.current = phoneUser() })
  it('sends a one-time link for the normalised address and remembers it for this uid only', async () => {
    const r = await sendAddEmailLink(s.current, ' Owner@Example.com ', 'https://idogs.com.au')
    expect(r.email).toBe('owner@example.com')
    expect(s.sendLink).toHaveBeenCalledWith(expect.anything(), 'owner@example.com', { url: 'https://idogs.com.au/app/settings?addEmail=1', handleCodeInApp: true })
    expect(JSON.parse(s.store.get(PENDING_EMAIL_LINK_KEY)!)).toMatchObject({ uid: 'cust-uid-1', email: 'owner@example.com' })
    expect(s.link).not.toHaveBeenCalled()
  })
  it('does not attach anything when the link is only sent', async () => {
    await sendAddEmailLink(s.current, 'a@b.co', 'https://idogs.com.au')
    expect(s.current.email).toBe(null)
  })
  it('opening the link attaches the VERIFIED address to the SAME uid', async () => {
    await sendAddEmailLink(s.current, 'a@b.co', 'https://idogs.com.au')
    const r = await completeAddEmailLink(s.current, LINK)
    expect(r).toEqual({ uid: 'cust-uid-1', email: 'a@b.co' })
    expect(s.credWithLink).toHaveBeenCalledWith('a@b.co', LINK)
    expect(s.current.emailVerified).toBe(true)
    expect(s.store.has(PENDING_EMAIL_LINK_KEY)).toBe(false)
  })
  it('then a password can be set right away (email-link provider allowed only for that step)', async () => {
    await sendAddEmailLink(s.current, 'a@b.co', 'https://idogs.com.au')
    await completeAddEmailLink(s.current, LINK)
    await expect(addPasswordToVerifiedEmail(s.current, 'longpassword', 'longpassword')).rejects.toThrow('provider-already-linked')
    await expect(addPasswordToVerifiedEmail(s.current, 'longpassword', 'longpassword', { allowEmailLinkProvider: true })).resolves.toEqual({ uid: 'cust-uid-1', email: 'a@b.co' })
  })
  it('refuses a link opened by a DIFFERENT signed-in account (no cross-account attach)', async () => {
    await sendAddEmailLink(s.current, 'a@b.co', 'https://idogs.com.au')
    s.current = phoneUser({ uid: 'other-uid' })
    await expect(completeAddEmailLink(s.current, LINK)).rejects.toThrow('session-changed')
    expect(s.link).not.toHaveBeenCalled()
  })
  it('refuses a link opened on another device (no pending request)', async () => {
    await expect(completeAddEmailLink(s.current, LINK)).rejects.toThrow('email-link-other-device')
    expect(s.link).not.toHaveBeenCalled()
  })
  it('address already owned by another account → no-merge message, nothing attached', async () => {
    await sendAddEmailLink(s.current, 'taken@b.co', 'https://idogs.com.au')
    s.link.mockRejectedValue(new Error('Firebase: Error (auth/email-already-in-use).'))
    const err = await completeAddEmailLink(s.current, LINK).catch(e => e)
    expect(emailPasswordLinkErrorMessage(err)).toContain('No accounts, dogs or subscriptions have been merged')
    expect(s.current.email).toBe(null)
  })
  it('isAddEmailLink only matches our Settings link', () => {
    expect(isAddEmailLink(LINK)).toBe(true)
    expect(isAddEmailLink('https://idogs.com.au/app/settings')).toBe(false)
    expect(isAddEmailLink('https://idogs.com.au/auth/finish?mode=signIn&oobCode=X')).toBe(false)
  })
  it('email link disabled in Firebase → clear "not available yet" message', () => {
    expect(emailPasswordLinkErrorMessage(new Error('Firebase: Error (auth/operation-not-allowed).'))).toContain('isn’t available yet')
  })
})

it('keeps where the customer was going (from /verify-email) in the link, only for safe /app paths', async () => {
  s.current = phoneUser()
  await sendAddEmailLink(s.current, 'a@b.co', 'https://idogs.com.au', '/app/dogs/new')
  expect(s.sendLink.mock.calls[s.sendLink.mock.calls.length - 1][2].url).toBe('https://idogs.com.au/app/settings?addEmail=1&next=%2Fapp%2Fdogs%2Fnew')
  await sendAddEmailLink(s.current, 'a@b.co', 'https://idogs.com.au', 'https://evil.example/x')
  expect(s.sendLink.mock.calls[s.sendLink.mock.calls.length - 1][2].url).toBe('https://idogs.com.au/app/settings?addEmail=1')
})
