import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ signup: vi.fn(), social: vi.fn(), track: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ signup: state.signup, socialLogin: state.social, finishQuickSignIn: vi.fn() }) }))
vi.mock('../lib/firebase', () => ({ auth: {} }))
vi.mock('../lib/metaPixel', () => ({ trackCompletedRegistration: state.track }))
import SignupPage from './SignupPage'
function Destination() { return createElement('output', {}, useLocation().pathname + useLocation().search) }
beforeEach(() => {
  state.signup.mockReset().mockResolvedValue(undefined); state.social.mockReset().mockResolvedValue(true); state.track.mockReset()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ providers: ['google.com'], phone: true, phoneTestOnly: true }) }))
})
afterEach(() => vi.unstubAllGlobals())
async function render() {
  let view!: ReactTestRenderer
  await act(async () => { view = create(createElement(MemoryRouter, { initialEntries: ['/signup?next=%2Fp%2FQR-RUBY%3Ffollow%3D1'] }, createElement(Routes, {}, createElement(Route, { path: '/signup', element: createElement(SignupPage, { toast: vi.fn() }) }), createElement(Route, { path: '*', element: createElement(Destination) })))) })
  return view
}
async function fill(view: ReactTestRenderer) {
  for (const [key, value] of [['nickname', 'Ruby'], ['email', 'qa@example.invalid'], ['new-password', 'synthetic-only']]) {
    await act(async () => { view.root.findAllByType('input').find(i => i.props.autoComplete === key)!.props.onChange({ target: { value } }) })
  }
}
describe('simple email signup and QR return', () => {
  it('requires Terms agreement before account creation or a social popup', async () => {
    const view = await render(); await fill(view)
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    await act(async () => { await view.root.findAllByType('button').find(b => b.children.join('').includes('Continue with'))!.props.onClick() })
    expect(state.signup).not.toHaveBeenCalled(); expect(state.social).not.toHaveBeenCalled(); expect(state.track).not.toHaveBeenCalled()
    view.unmount()
  })
  it('shows Yes by default without treating an untouched default as marketing consent', async () => {
    const view = await render(); await fill(view)
    expect(view.root.findAllByProps({ type: 'radio' })[0].props.checked).toBe(true)
    await act(async () => { view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(state.signup).toHaveBeenCalledWith({ firstName: 'Ruby', lastName: '', kennelName: '', email: 'qa@example.invalid', password: 'synthetic-only', marketingOptIn: false, termsAccepted: true })
    expect(state.track).toHaveBeenCalledTimes(1)
    expect(view.root.findByType('output').children.join('')).toBe('/p/QR-RUBY?follow=1')
    view.unmount()
  })
  it.each([true, false])('records an actively confirmed promotion choice while allowing signup either way: %s', async choice => {
    const view = await render(); await fill(view)
    await act(async () => { view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }); const radios = view.root.findAllByProps({ type: 'radio' }); if (choice) radios[0].props.onClick(); else radios[1].props.onChange() })
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(state.signup).toHaveBeenCalledWith(expect.objectContaining({ marketingOptIn: choice, termsAccepted: true }))
    view.unmount()
  })
  it('keeps the form and does not record conversion when creation fails', async () => {
    state.signup.mockRejectedValue(new Error('auth/email-already-in-use'))
    const view = await render(); await fill(view)
    await act(async () => { view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('already has an account')
    expect(state.track).not.toHaveBeenCalled(); view.unmount()
  })
})
