import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ signin: vi.fn(), finish: vi.fn(), track: vi.fn(), valid: true, isNew: true }))
vi.mock('../lib/firebase', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({ isSignInWithEmailLink: () => s.valid, signInWithEmailLink: s.signin, getAdditionalUserInfo: () => ({ isNewUser: s.isNew }) }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ finishQuickSignIn: s.finish }) }))
vi.mock('../lib/metaPixel', () => ({ trackCompletedRegistration: s.track }))
import EmailSigninFinishPage from './EmailSigninFinishPage'
beforeEach(() => {
  s.valid = true; s.isNew = true; s.signin.mockReset().mockResolvedValue({ user: { uid: 'synthetic', email: 'qa@example.invalid' } }); s.finish.mockReset().mockResolvedValue(undefined); s.track.mockReset()
  vi.stubGlobal('location', { href: 'https://qa.example.invalid/auth/finish?oobCode=synthetic' })
  vi.stubGlobal('localStorage', { getItem: () => null, removeItem: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())
async function render() { let view: ReturnType<typeof create>; await act(async () => { view = create(createElement(MemoryRouter, null, createElement(EmailSigninFinishPage))) }); return view! }
async function submit(view: ReturnType<typeof create>) { await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) }) }
describe('email link completion', () => {
  it('asks for email on another device and passes that email to Firebase, not one from URL', async () => {
    const view = await render()
    await act(async () => { view.root.findAllByType('input')[0].props.onChange({ target: { value: 'qa@example.invalid' } }) })
    await submit(view)
    expect(s.signin.mock.calls[0][1]).toBe('qa@example.invalid'); expect(s.finish).toHaveBeenCalledWith(expect.objectContaining({ uid: 'synthetic' }), true, '', false)
    expect(s.track).toHaveBeenCalledTimes(1); view.unmount()
  })
  it('never completes a profile or counts conversion when Firebase rejects a link', async () => {
    s.signin.mockRejectedValue(new Error('expired')); const view = await render(); await submit(view)
    expect(s.finish).not.toHaveBeenCalled(); expect(s.track).not.toHaveBeenCalled(); expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('expired'); view.unmount()
  })
  it('does not consume the single-use code again when retrying a profile failure', async () => {
    s.finish.mockRejectedValueOnce(new Error('network')); const view = await render(); await submit(view); await submit(view)
    expect(s.signin).toHaveBeenCalledTimes(1); expect(s.finish).toHaveBeenCalledTimes(2); expect(s.track).toHaveBeenCalledTimes(1); view.unmount()
  })
  it('does not record registration for an existing account', async () => {
    s.isNew = false; const view = await render(); await submit(view); expect(s.track).not.toHaveBeenCalled(); view.unmount()
  })
  it('offers a fresh link when the callback is invalid', async () => {
    s.valid = false; const view = await render(); expect(view.root.findAllByType('form')).toHaveLength(0); expect(s.signin).not.toHaveBeenCalled(); view.unmount()
  })
})
