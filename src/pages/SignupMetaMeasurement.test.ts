import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ send: vi.fn(), track: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ finishQuickSignIn: vi.fn(), socialLogin: vi.fn() }) }))
vi.mock('../lib/firebase', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({ sendSignInLinkToEmail: state.send, getAdditionalUserInfo: vi.fn(), RecaptchaVerifier: vi.fn(), signInWithPhoneNumber: vi.fn() }))
vi.mock('../lib/metaPixel', () => ({ trackCompletedRegistration: state.track }))
import SignupPage from './SignupPage'
beforeEach(() => {
  state.send.mockReset().mockResolvedValue(undefined); state.track.mockReset()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ providers: [], emailLink: true }) }))
  vi.stubGlobal('location', { origin: 'https://qa.example.invalid' })
  vi.stubGlobal('localStorage', { setItem: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())
describe('passwordless signup conversion outcome', () => {
  async function submit(succeed: boolean) {
    if (!succeed) state.send.mockRejectedValue(new Error('synthetic outage'))
    let view: ReturnType<typeof create>
    await act(async () => { view = create(createElement(MemoryRouter, null, createElement(SignupPage, { toast: vi.fn() }))) })
    expect(view!.root.findAllByType('input').filter(i => i.props.type === 'password')).toHaveLength(0)
    await act(async () => { view!.root.findAllByType('input').find(i => i.props.type === 'email')!.props.onChange({ target: { value: 'qa@example.invalid' } }) })
    await act(async () => { await view!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    await act(async () => { view!.unmount() })
  }
  it('does not count sending a sign-in link as a completed registration', async () => {
    await submit(true); expect(state.send).toHaveBeenCalledTimes(1); expect(state.track).not.toHaveBeenCalled()
    const settings = state.send.mock.calls[0][2]
    expect(settings.handleCodeInApp).toBe(true); expect(settings.url).not.toContain('qa@example.invalid')
  })
  it('does not record conversion if the sign-in email cannot be sent', async () => {
    await submit(false); expect(state.send).toHaveBeenCalledTimes(1); expect(state.track).not.toHaveBeenCalled()
  })
})
