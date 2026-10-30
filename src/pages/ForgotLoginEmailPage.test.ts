import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ForgotLoginEmailPage from './ForgotLoginEmailPage'
let tree: ReactTestRenderer
const challenge = 'a'.repeat(64)
const fetchMock = vi.fn()
beforeEach(() => { vi.stubEnv('VITE_ACCOUNT_RECOVERY_QA', '1'); vi.stubEnv('DEV', true); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
async function render() { await act(async () => { tree = create(createElement(MemoryRouter, null, createElement(ForgotLoginEmailPage))) }) }
async function submit() { await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }) }) }
async function start() {
  act(() => tree.root.findByProps({ type: 'tel' }).props.onChange({ target: { value: '0400000201' } }))
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ challenge, message: 'If eligible', expiresIn: 300, retryAfter: 60 }) })
  await submit()
}
it('keeps the prototype unavailable outside local development, even with a flag', async () => {
  vi.stubEnv('DEV', false); await render()
  expect(tree.root.findAllByType('form')).toHaveLength(0); expect(fetchMock).not.toHaveBeenCalled()
  expect(JSON.stringify(tree.toJSON())).toContain('not available yet')
})
it('sends no password/Auth token and reveals no email before OTP', async () => {
  await render(); await start()
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(Object.keys(body).sort()).toEqual(['action', 'device', 'phone']); expect(body.action).toBe('start')
  expect(JSON.stringify(tree.toJSON())).not.toContain('qa-owner@example.invalid')
  expect(tree.root.findByProps({ autoComplete: 'one-time-code' })).toBeTruthy()
  expect(fetchMock.mock.calls[0][1].cache).toBe('no-store')
})
it('shows the recovered email after verification and returns to email sign-in without logging in', async () => {
  await render(); await start()
  act(() => tree.root.findByProps({ autoComplete: 'one-time-code' }).props.onChange({ target: { value: '123456' } }))
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'found', email: 'qa-owner@example.invalid' }) })
  await submit()
  const body = JSON.parse(fetchMock.mock.calls[1][1].body)
  expect(Object.keys(body).sort()).toEqual(['action', 'challenge', 'code', 'device'])
  expect(body).toMatchObject({ action: 'verify', challenge, code: '123456' })
  expect(JSON.stringify(tree.toJSON())).toContain('qa-owner@example.invalid')
  expect(tree.root.findAllByType('a').some(a => a.props.href === '/login' && a.children.includes('Continue to email sign-in'))).toBe(true)
  expect(tree.root.findAllByType('form')).toHaveLength(0)
})
it('does not display email or server details on an invalid OTP', async () => {
  await render(); await start()
  fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'sensitive provider diagnostic' }) })
  await submit()
  expect(tree.root.findByProps({ role: 'alert' }).children.join('')).toContain('Could not verify')
  expect(JSON.stringify(tree.toJSON())).not.toContain('sensitive provider diagnostic')
  expect(tree.root.findByType('form')).toBeTruthy()
})
it('guides an incomplete account back to its existing mobile path without displaying unverified email', async () => {
  await render(); await start()
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'incomplete' }) }); await submit()
  expect(JSON.stringify(tree.toJSON())).toContain('Finish setting up your account')
  expect(JSON.stringify(tree.toJSON())).toContain('don’t create another account')
})
it('sanitizes unexpected transport/JSON errors instead of displaying their payload', async () => {
  await render(); fetchMock.mockRejectedValueOnce(new Error('sensitive raw error'))
  await submit(); expect(tree.root.findByProps({ role: 'alert' }).children.join('')).toBe('Could not connect. Please try again.')
})
