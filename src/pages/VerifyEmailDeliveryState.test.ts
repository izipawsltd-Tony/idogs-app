import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Owner QA (#69, 3 Nov): never tell a customer to "click the link in your
// email" unless an email was actually sent; rate-limit-aware guidance.
const s = vi.hoisted(() => ({ user: null as any, resend: vi.fn(), check: vi.fn(), toast: vi.fn(), store: new Map<string, string>() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: s.user, loading: false, logout: vi.fn(), resendVerificationEmail: s.resend, checkEmailVerified: s.check }) }))
vi.mock('firebase/auth', () => ({ verifyBeforeUpdateEmail: vi.fn(), sendEmailVerification: vi.fn() }))
vi.mock('../lib/firebase', () => ({ auth: { currentUser: null }, db: {} }))
import VerifyEmailPage from './VerifyEmailPage'
import { rememberVerificationDelivery } from '../lib/signupVerification'

let tree: ReactTestRenderer
beforeEach(() => {
  s.store.clear()
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => s.store.get(k) ?? null, setItem: (k: string, v: string) => s.store.set(k, v) })
  s.user = { uid: 'u1', email: 'owner@example.invalid', emailVerified: false, providerData: [{ providerId: 'password' }] }
  s.resend.mockReset().mockResolvedValue(undefined); s.check.mockReset().mockResolvedValue(false); s.toast.mockReset()
})
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllGlobals() })
const render = async () => { await act(async () => { tree = create(createElement(MemoryRouter, null, createElement(VerifyEmailPage, { toast: s.toast }))) }) }
const text = () => JSON.stringify(tree.toJSON())
const button = (label: RegExp) => tree.root.findAllByType('button').find(b => label.test(JSON.stringify(b.props.children)))!

it('first email failed: no "click the link" instruction, offers Send', async () => {
  rememberVerificationDelivery('u1', 'failed')
  await render()
  expect(text()).not.toMatch(/click the link|Open the link in it/)
  await act(async () => { await button(/verified/).props.onClick() })
  expect(s.toast.mock.calls[0][0]).not.toMatch(/click the link/i)
  expect(s.toast.mock.calls[0][0]).toMatch(/haven’t been able to send/)
})
it('throttled: explains the temporary limit, shows a retry time and disables resend (no spam retries)', async () => {
  rememberVerificationDelivery('u1', 'throttled', Date.now() + 3600000)
  await render()
  expect(text()).toMatch(/temporarily limited/); expect(text()).toMatch(/no need to keep retrying/)
  const b = button(/Try again after/)
  expect(b.props.disabled).toBe(true)
  expect(text()).not.toMatch(/Spam/)
})
it('resend hitting the Firebase limit switches to the throttled state instead of a generic error', async () => {
  s.resend.mockRejectedValue(new Error('Firebase: Error (auth/too-many-requests).'))
  await render()
  await act(async () => { await button(/Send verification email/).props.onClick() })
  expect(s.toast.mock.calls[0][0]).toMatch(/temporarily limited/)
  expect(button(/Try again after/).props.disabled).toBe(true)
})
it('sent: tells the customer when it was sent and to check Spam', async () => {
  await render()
  await act(async () => { await button(/Send verification email/).props.onClick() })
  expect(s.toast.mock.calls[0][0]).toMatch(/Verification email sent/)
  expect(text()).toMatch(/We sent a verification email at/); expect(text()).toMatch(/Spam/)
})
