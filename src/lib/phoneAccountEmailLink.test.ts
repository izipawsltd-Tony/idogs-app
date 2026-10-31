import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'

const mocks = vi.hoisted(() => {
  const user = { uid: 'existing-phone-uid', email: null as string | null, providerData: [{ providerId: 'phone' }] }
  return { user, auth: { currentUser: user as unknown }, link: vi.fn(), reload: vi.fn(), send: vi.fn(), credential: vi.fn() }
})
vi.mock('./firebase', () => ({ auth: mocks.auth }))
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: mocks.credential },
  linkWithCredential: mocks.link,
  reload: mocks.reload,
  sendEmailVerification: mocks.send,
}))
import { linkEmailPasswordToExistingPhoneAccount, phoneEmailLinkStagingEnabled } from './phoneAccountEmailLink'

describe('staging-only same-UID phone account linking', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'idogs-app-staging')
    vi.stubEnv('VITE_IDOGS_PHONE_ACCOUNT_LINK_QA', '1')
    mocks.user.uid = 'existing-phone-uid'
    mocks.user.email = null
    mocks.user.providerData = [{ providerId: 'phone' }]
    mocks.auth.currentUser = mocks.user
    mocks.reload.mockReset().mockResolvedValue(undefined)
    mocks.credential.mockReset().mockReturnValue({ provider: 'password' })
    mocks.link.mockReset().mockResolvedValue({ user: { uid: mocks.user.uid, email: 'breeder@example.com' } })
    mocks.send.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('fails closed for Production and does not create or link anything', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'idogs-app')
    expect(phoneEmailLinkStagingEnabled()).toBe(false)
    await expect(linkEmailPasswordToExistingPhoneAccount(mocks.user as unknown as User, 'breeder@example.com', 'Password123!')).rejects.toThrow('not enabled')
    expect(mocks.link).not.toHaveBeenCalled()
  })
  it('retains the original UID and only links an email credential', async () => {
    const result = await linkEmailPasswordToExistingPhoneAccount(mocks.user as unknown as User, ' Breeder@Example.com ', 'Password123!')
    expect(mocks.credential).toHaveBeenCalledWith('breeder@example.com', 'Password123!')
    expect(mocks.link).toHaveBeenCalledWith(mocks.user, { provider: 'password' })
    expect(result).toEqual({ uid: 'existing-phone-uid', email: 'breeder@example.com', verificationSent: true })
  })
  it('does not treat a failed verification delivery as account linking failure', async () => {
    mocks.send.mockRejectedValueOnce(new Error('mail unavailable'))
    const result = await linkEmailPasswordToExistingPhoneAccount(mocks.user as unknown as User, 'breeder@example.com', 'Password123!')
    expect(result.verificationSent).toBe(false)
    expect(result.uid).toBe('existing-phone-uid')
  })
  it('blocks a different account after linking and before starting', async () => {
    mocks.link.mockResolvedValueOnce({ user: { uid: 'wrong-uid', email: 'breeder@example.com' } })
    await expect(linkEmailPasswordToExistingPhoneAccount(mocks.user as unknown as User, 'breeder@example.com', 'Password123!')).rejects.toThrow('Account changed')
    mocks.auth.currentUser = { uid: 'switched-user' }
    await expect(linkEmailPasswordToExistingPhoneAccount(mocks.user as unknown as User, 'breeder@example.com', 'Password123!')).rejects.toThrow('original phone account')
  })
  it('does not overwrite an existing email/password provider', async () => {
    mocks.user.providerData = [{ providerId: 'password' }]
    await expect(linkEmailPasswordToExistingPhoneAccount(mocks.user as unknown as User, 'breeder@example.com', 'Password123!')).rejects.toThrow('not an existing phone account')
    expect(mocks.link).not.toHaveBeenCalled()
  })
})
