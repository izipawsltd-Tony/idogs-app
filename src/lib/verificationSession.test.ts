import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../hooks/useAuth'
const mocks = vi.hoisted(() => ({ auth: { currentUser: null as null | { uid: string } }, send: vi.fn() }))
vi.mock('../lib/firebase', () => ({ auth: mocks.auth }))
vi.mock('../lib/db', () => ({ createUserProfile: vi.fn(), getUserProfile: vi.fn(), updateUserProfile: vi.fn() }))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signOut: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}), sendPasswordResetEmail: vi.fn(),
  sendEmailVerification: mocks.send, reload: vi.fn(),
}))
describe('verification resend session', () => {
  it('rejects a lost session instead of reporting a successful no-op', async () => {
    let auth!: ReturnType<typeof useAuth>
    function Probe() { auth = useAuth(); return null }
    let renderer!: ReturnType<typeof create>
    act(() => { renderer = create(createElement(AuthProvider, null, createElement(Probe))) })
    await expect(auth.resendVerificationEmail()).rejects.toThrow('auth/requires-recent-login')
    expect(mocks.send).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })
})
