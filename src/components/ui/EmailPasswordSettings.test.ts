import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
const s = vi.hoisted(() => ({ user: null as any, link: vi.fn(), linked: vi.fn() }))
vi.mock('../../lib/firebase', () => ({ auth: { get currentUser() { return s.user } } }))
vi.mock('../../lib/emailPasswordLink', async (orig) => ({ ...(await orig() as object), linkEmailPasswordToCurrentAccount: s.link }))
import EmailPasswordSettings from './EmailPasswordSettings'
let tree: ReactTestRenderer
beforeEach(() => {
  s.user = { uid: 'cust', email: null, emailVerified: false, providerData: [{ providerId: 'phone' }] }
  s.link.mockReset().mockResolvedValue({ uid: 'cust', email: 'a@b.co', emailVerified: false, verificationSent: true })
  s.linked.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { if (tree) act(() => tree.unmount()) })
async function render(profileReady = true) { await act(async () => { tree = create(createElement(EmailPasswordSettings, { user: s.user as User, profileReady, onLinked: s.linked })) }) }
const text = () => JSON.stringify(tree.toJSON())
it('offers email sign-in to an SMS-only account and links to the same account', async () => {
  await render()
  const inputs = tree.root.findAllByType('input')
  act(() => inputs[0].props.onChange({ target: { value: 'a@b.co' } }))
  act(() => inputs[1].props.onChange({ target: { value: 'longpassword' } }))
  act(() => inputs[2].props.onChange({ target: { value: 'longpassword' } }))
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(s.link).toHaveBeenCalledWith(s.user, 'a@b.co', 'longpassword', 'longpassword')
  expect(s.linked).toHaveBeenCalledOnce()
  expect(text()).toContain('iDogs iPhone app'); expect(text()).toContain('unchanged')
})
it('shows an existing email read-only (adds password only)', async () => {
  s.user.email = 'kept@example.com'; await render()
  expect(tree.root.findAllByType('input')).toHaveLength(2); expect(text()).toContain('kept@example.com')
})
it('is hidden when the account already has password sign-in', async () => {
  s.user.providerData = [{ providerId: 'password' }]; await render()
  expect(tree.toJSON()).toBeNull()
})
it('shows a no-merge message when the email belongs to another account', async () => {
  s.link.mockRejectedValue(new Error('Firebase: Error (auth/email-already-in-use).')); await render()
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(tree.root.findByProps({ role: 'alert' }).children.join('')).toContain('have been merged or moved')
  expect(s.linked).not.toHaveBeenCalled()
})
it('does not allow linking before the profile has loaded', async () => {
  await render(false); expect(tree.root.findAllByType('form')).toHaveLength(0)
})
