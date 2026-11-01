import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
const s = vi.hoisted(() => ({ user: null as any, add: vi.fn(), linked: vi.fn() }))
vi.mock('../../lib/firebase', () => ({ auth: { get currentUser() { return s.user } } }))
vi.mock('../../lib/emailPasswordLink', async (orig) => ({ ...(await orig() as object), addPasswordToVerifiedEmail: s.add }))
import EmailPasswordSettings from './EmailPasswordSettings'
let tree: ReactTestRenderer
beforeEach(() => {
  s.user = { uid: 'cust', email: 'kept@example.com', emailVerified: true, providerData: [{ providerId: 'phone' }] }
  s.add.mockReset().mockResolvedValue({ uid: 'cust', email: 'kept@example.com' })
  s.linked.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { if (tree) act(() => tree.unmount()) })
async function render(profileReady = true) {
  await act(async () => {
    tree = create(createElement(MemoryRouter, null, createElement(EmailPasswordSettings, { user: s.user as User, profileReady, onLinked: s.linked })))
  })
}
const text = () => JSON.stringify(tree.toJSON())

it('SMS-only account (no email) is sent to /verify-email first — no email input, no link call', async () => {
  s.user.email = null; s.user.emailVerified = false
  await render()
  expect(tree.root.findAllByType('input')).toHaveLength(0)
  expect(tree.root.findByProps({ 'data-testid': 'email-password-verify-step' })).toBeTruthy()
  expect(text()).toContain('/verify-email?next=%2Fapp%2Fsettings')
  expect(s.add).not.toHaveBeenCalled()
})
it('unverified email is sent to verification, not to the password form', async () => {
  s.user.emailVerified = false
  await render()
  expect(tree.root.findAllByType('form')).toHaveLength(0)
  expect(text()).toContain('Verify email')
})
it('verified email: sets a password on the same account and confirms data unchanged', async () => {
  await render()
  const inputs = tree.root.findAllByType('input')
  expect(inputs).toHaveLength(2)
  act(() => inputs[0].props.onChange({ target: { value: 'longpassword' } }))
  act(() => inputs[1].props.onChange({ target: { value: 'longpassword' } }))
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(s.add).toHaveBeenCalledWith(s.user, 'longpassword', 'longpassword')
  expect(s.linked).toHaveBeenCalledOnce()
  expect(text()).toContain('iDogs iPhone app'); expect(text()).toContain('unchanged')
})
it('is hidden when the account already has password sign-in', async () => {
  s.user.providerData = [{ providerId: 'password' }]; await render()
  expect(tree.toJSON()).toBeNull()
})
it('shows a re-auth message when Firebase requires a recent login', async () => {
  s.add.mockRejectedValue(new Error('Firebase: Error (auth/requires-recent-login).')); await render()
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(tree.root.findByProps({ role: 'alert' }).children.join('')).toContain('sign in again')
  expect(s.linked).not.toHaveBeenCalled()
})
it('does not allow setting a password before the profile has loaded', async () => {
  await render(false); expect(tree.root.findAllByType('form')).toHaveLength(0)
})
