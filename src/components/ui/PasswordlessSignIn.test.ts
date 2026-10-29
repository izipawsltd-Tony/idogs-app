import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ send: vi.fn(), confirm: vi.fn(), finish: vi.fn(), track: vi.fn() }))
vi.mock('../../lib/firebase', () => ({ auth: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ finishQuickSignIn: s.finish }) }))
vi.mock('../../lib/metaPixel', () => ({ trackCompletedRegistration: s.track }))
vi.mock('firebase/auth', () => ({ getAdditionalUserInfo: () => ({ isNewUser: true }), sendSignInLinkToEmail: vi.fn(), signInWithPhoneNumber: s.send, RecaptchaVerifier: class { clear() {} } }))
import PasswordlessSignIn from './PasswordlessSignIn'
beforeEach(() => {
  s.send.mockReset().mockResolvedValue({ confirm: s.confirm }); s.confirm.mockReset().mockResolvedValue({ user: { uid: 'qa-phone', phoneNumber: '+16505553434' } }); s.finish.mockReset().mockResolvedValue(undefined); s.track.mockReset()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ emailLink: true, phone: true, phoneTestOnly: true }) }))
})
afterEach(() => vi.unstubAllGlobals())
async function phoneForm() {
  let view: ReturnType<typeof create>
  await act(async () => { view = create(createElement(MemoryRouter, null, createElement(PasswordlessSignIn, { next: '/app/start', signup: true })), { createNodeMock: () => ({}) }) })
  await act(async () => { view!.root.findAllByType('button').find(b => b.children.includes('Mobile number'))!.props.onClick() })
  await act(async () => { view!.root.findAllByType('input').find(i => i.props.type === 'tel')!.props.onChange({ target: { value: '+16505553434' } }) })
  await act(async () => { await view!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  return view!
}
describe('phone sign-in completion', () => {
  it('requires explicit Terms and a name for new phone signup, and refuses live QA numbers before SMS', async () => {
    let view!: ReturnType<typeof create>
    await act(async () => { view = create(createElement(MemoryRouter, null, createElement(PasswordlessSignIn, { next: '/p/QR-RUBY', signup: true, phoneOnly: true })), { createNodeMock: () => ({}) }) })
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(s.send).not.toHaveBeenCalled()
    await act(async () => { view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }); view.root.findByProps({ autoComplete: 'nickname' }).props.onChange({ target: { value: 'Ruby Friend' } }); view.root.findByProps({ type: 'tel' }).props.onChange({ target: { value: '0412345678' } }) })
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(s.send).not.toHaveBeenCalled(); expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('limited to the supplied test number')
    await act(async () => { view.root.findByProps({ type: 'tel' }).props.onChange({ target: { value: '+16505553434' } }) })
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(s.finish).toHaveBeenCalledWith(expect.objectContaining({ uid: 'qa-phone' }), true, 'Ruby Friend', false, true)
    view.unmount()
  })
  it('creates no profile or conversion until Firebase accepts the code', async () => {
    const view = await phoneForm(); expect(s.finish).not.toHaveBeenCalled(); expect(s.track).not.toHaveBeenCalled()
    expect(s.send.mock.calls[0][1]).toBe('+16505553434')
    await act(async () => { view.root.findAllByType('input').find(i => i.props.autoComplete === 'one-time-code')!.props.onChange({ target: { value: '000000' } }) })
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(s.confirm).toHaveBeenCalledWith('000000'); expect(s.finish).toHaveBeenCalledTimes(1); expect(s.track).toHaveBeenCalledTimes(1); view.unmount()
  })
  it('rejects an invalid code without creating or following an account', async () => {
    s.confirm.mockRejectedValue(new Error('auth/invalid-verification-code')); const view = await phoneForm()
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(s.finish).not.toHaveBeenCalled(); expect(s.track).not.toHaveBeenCalled(); expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('not correct'); view.unmount()
  })
})
