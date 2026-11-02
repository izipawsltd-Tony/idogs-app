import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
const s = vi.hoisted(() => ({ user: null as any, add: vi.fn(), linked: vi.fn(), send: vi.fn(), complete: vi.fn(), isLink: vi.fn() }))
vi.mock('../../lib/firebase', () => ({ auth: { get currentUser() { return s.user } } }))
vi.mock('../../lib/emailPasswordLink', async (orig) => ({ ...(await orig() as object), addPasswordToVerifiedEmail: s.add, sendAddEmailLink: s.send, completeAddEmailLink: s.complete, isAddEmailLink: s.isLink }))
vi.stubGlobal('window', { location: { href: 'https://idogs.com.au/app/settings', origin: 'https://idogs.com.au' }, history: { replaceState: vi.fn() } })
import EmailPasswordSettings from './EmailPasswordSettings'
let tree: ReactTestRenderer
beforeEach(() => {
  s.user = { uid: 'cust', email: 'kept@example.com', emailVerified: true, providerData: [{ providerId: 'phone' }] }
  s.add.mockReset().mockResolvedValue({ uid: 'cust', email: 'kept@example.com' })
  s.linked.mockReset().mockResolvedValue(undefined)
  s.send.mockReset().mockResolvedValue({ email: 'new@example.com' })
  s.complete.mockReset().mockImplementation(async () => { s.user = { ...s.user, email: 'new@example.com', emailVerified: true, providerData: [{ providerId: 'phone' }, { providerId: 'password' }] }; return { uid: 'cust', email: 'new@example.com' } })
  s.isLink.mockReset().mockReturnValue(false)
})
afterEach(() => { if (tree) act(() => tree.unmount()) })
async function render(profileReady = true, href = 'https://idogs.com.au/app/settings') {
  await act(async () => {
    tree = create(createElement(MemoryRouter, null, createElement(EmailPasswordSettings, { user: s.user as User, profileReady, onLinked: s.linked, href })))
  })
}
const text = () => JSON.stringify(tree.toJSON())

it('SMS-only account: step 1 emails a confirmation link; nothing is attached until it is opened', async () => {
  s.user.email = null; s.user.emailVerified = false
  await render()
  const inputs = tree.root.findAllByType('input')
  expect(inputs).toHaveLength(1)
  act(() => inputs[0].props.onChange({ target: { value: 'new@example.com' } }))
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(s.send).toHaveBeenCalledWith(s.user, 'new@example.com', 'https://idogs.com.au')
  expect(tree.root.findByProps({ 'data-testid': 'email-link-sent' })).toBeTruthy()
  expect(s.add).not.toHaveBeenCalled(); expect(s.complete).not.toHaveBeenCalled()
})
it('returning from the emailed link attaches the verified email, clears the code from the URL, then asks for a password', async () => {
  s.user.email = null; s.user.emailVerified = false
  s.isLink.mockReturnValue(true)
  const link = 'https://idogs.com.au/app/settings?addEmail=1&mode=signIn&oobCode=X'
  await render(true, link)
  expect(s.complete).toHaveBeenCalledWith(expect.objectContaining({ uid: 'cust' }), link)
  expect((window as any).history.replaceState).toHaveBeenCalledWith(null, '', '/app/settings')
  expect(text()).toContain('Step 2 of 2'); expect(text()).toContain('new@example.com')
  const inputs = tree.root.findAllByType('input')
  act(() => inputs[0].props.onChange({ target: { value: 'longpassword' } }))
  act(() => inputs[1].props.onChange({ target: { value: 'longpassword' } }))
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(s.add).toHaveBeenCalledWith(expect.anything(), 'longpassword', 'longpassword', { allowEmailLinkProvider: true })
})
it('a failed link (other device / expired) shows the reason and never leaves the code in the URL', async () => {
  s.user.email = null; s.user.emailVerified = false
  s.isLink.mockReturnValue(true); s.complete.mockRejectedValue(new Error('email-link-other-device'))
  await render(true, 'https://idogs.com.au/app/settings?addEmail=1&mode=signIn&oobCode=X')
  expect(text()).toContain('same phone or computer')
  expect((window as any).history.replaceState).toHaveBeenCalled()
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
  expect(s.add).toHaveBeenCalledWith(s.user, 'longpassword', 'longpassword', { allowEmailLinkProvider: false })
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
