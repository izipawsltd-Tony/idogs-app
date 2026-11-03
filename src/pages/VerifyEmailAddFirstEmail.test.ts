import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// P0 finding (Owner directive 6564223316): SMS-only accounts have no email, so
// user.emailVerified is false and ProtectedRoute sends them to /verify-email
// for any non-discovery route (e.g. Add dog). There the old code called
// verifyBeforeUpdateEmail, which Firebase refuses without an existing email
// (auth/missing-email, reproduced in the Auth emulator) — a dead end.
const s = vi.hoisted(() => ({
  user: null as any, send: vi.fn(), verifyBefore: vi.fn(), toast: vi.fn(), enabled: true,
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: s.user, loading: false, logout: vi.fn(), resendVerificationEmail: vi.fn(), checkEmailVerified: vi.fn() }) }))
vi.mock('firebase/auth', () => ({ verifyBeforeUpdateEmail: s.verifyBefore }))
vi.mock('../lib/firebase', () => ({ auth: { currentUser: null }, db: {} }))
vi.mock('../lib/signupVerification', () => ({ verificationDelivery: () => null, rememberVerificationDelivery: (_u: string, status: string) => ({ status, attemptedAt: Date.now() }), isThrottleError: (e: unknown) => /TOO_MANY_ATTEMPTS|too-many-requests/.test(String((e as Error)?.message)), THROTTLE_RETRY_MS: 3600000 }))
vi.mock('../lib/emailPasswordLink', async (orig) => ({
  ...(await orig() as object), sendAddEmailLink: s.send, emailPasswordLinkEnabled: () => s.enabled,
}))
vi.stubGlobal('location', { origin: 'https://idogs.com.au' })
import VerifyEmailPage from './VerifyEmailPage'
import { discoveryRoute } from '../lib/quickSignup'

let tree: ReactTestRenderer
beforeEach(() => {
  s.user = { uid: 'sms-uid', email: null, emailVerified: false, providerData: [{ providerId: 'phone' }] }
  s.send.mockReset().mockResolvedValue({ email: 'owner@example.com' })
  s.verifyBefore.mockReset().mockRejectedValue(new Error('Firebase: Error (auth/missing-email).'))
  s.toast.mockReset(); s.enabled = true
})
afterEach(() => { if (tree) act(() => tree.unmount()) })
async function render() {
  await act(async () => {
    tree = create(createElement(MemoryRouter, { initialEntries: ['/verify-email?next=%2Fapp%2Fdogs%2Fnew'] }, createElement(VerifyEmailPage, { toast: s.toast })))
  })
}
async function sendFor(email: string) {
  act(() => tree.root.findByType('input').props.onChange({ target: { value: email } }))
  const send = tree.root.findAllByType('button').find(b => JSON.stringify(b.props.children).includes('verification email'))!
  await act(async () => { await send.props.onClick() })
}

it('root cause: Add dog is not a discovery route, so an SMS-only account is gated on email verification', () => {
  expect(discoveryRoute('/app/dogs/new')).toBe(false)
  expect(discoveryRoute('/app/settings')).toBe(true)
})
it('SMS-only account: sends a one-time link (keeps the destination) instead of the refused verifyBeforeUpdateEmail', async () => {
  await render(); await sendFor('owner@example.com')
  expect(s.send).toHaveBeenCalledWith(s.user, 'owner@example.com', 'https://idogs.com.au', '/app/dogs/new')
  expect(s.verifyBefore).not.toHaveBeenCalled()
  expect(s.toast).toHaveBeenCalledWith(expect.stringContaining('Check your inbox'))
})
it('shows the customer-safe reason when the link cannot be sent', async () => {
  s.send.mockRejectedValue(new Error('Firebase: Error (auth/operation-not-allowed).'))
  await render(); await sendFor('owner@example.com')
  expect(s.toast).toHaveBeenCalledWith(expect.stringContaining('isn’t available yet'), 'error')
})
it('kill switch restores the previous behaviour exactly', async () => {
  s.enabled = false
  await render(); await sendFor('owner@example.com')
  expect(s.send).not.toHaveBeenCalled()
  expect(s.verifyBefore).toHaveBeenCalledOnce()
})
