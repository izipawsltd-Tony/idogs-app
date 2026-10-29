import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ login: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ login: s.login, socialLogin: vi.fn(), finishQuickSignIn: vi.fn() }) }))
vi.mock('../lib/firebase', () => ({ auth: {} }))
import LoginPage from './LoginPage'
function Destination() { return createElement('output', {}, useLocation().pathname + useLocation().search) }
beforeEach(() => { s.login.mockReset().mockResolvedValue(undefined); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ providers: [], phone: true }) })) })
afterEach(() => vi.unstubAllGlobals())
async function render(next: string) {
  let view!: ReactTestRenderer
  await act(async () => { view = create(createElement(MemoryRouter, { initialEntries: ['/login?next=' + encodeURIComponent(next)] }, createElement(Routes, {}, createElement(Route, { path: '/login', element: createElement(LoginPage, { toast: vi.fn() }) }), createElement(Route, { path: '*', element: createElement(Destination) })))) })
  await act(async () => { view.root.findByProps({ autoComplete: 'email' }).props.onChange({ target: { value: 'qa@example.invalid' } }); view.root.findByProps({ autoComplete: 'current-password' }).props.onChange({ target: { value: 'synthetic-only' } }) })
  return view
}
it.each(['/p/QR-RUBY?follow=1', '/app/shared-dogs/ruby', '/app/dashboard'])('signs in with a password by default and preserves intended destination: %s', async next => {
  const view = await render(next)
  await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(s.login).toHaveBeenCalledWith('qa@example.invalid', 'synthetic-only')
  expect(view.root.findByType('output').children.join('')).toBe(next)
  view.unmount()
})
it('keeps failed login on the form with password recovery available', async () => {
  s.login.mockRejectedValue(new Error('auth/invalid-credential')); const view = await render('/app/dashboard')
  await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(view.root.findAllByType('output')).toHaveLength(0)
  expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('reset your password')
  expect(view.root.findAllByType('a').some(a => a.props.href === '/forgot-password')).toBe(true)
  view.unmount()
})
