import { createElement, StrictMode } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ signin: vi.fn(), finish: vi.fn(), track: vi.fn(), valid: true, isNew: true, path: '' }))
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
function LocationProbe() { const location = useLocation(); s.path = location.pathname + location.search; return null }
async function render(route = '/auth/finish') { let view: ReturnType<typeof create>; await act(async () => { view = create(createElement(StrictMode, null, createElement(MemoryRouter, { initialEntries: [route] }, createElement(EmailSigninFinishPage), createElement(LocationProbe)))) }); return view! }
async function submit(view: ReturnType<typeof create>) { await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) }) }
describe('email link completion', () => {
  function rememberRequest() {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ email: 'qa@example.invalid', name: 'Ruby Friend', marketingOptIn: true, createdAt: Date.now() }), removeItem: vi.fn() })
  }
  it('automatically signs in once with saved email/name and preserves the exact puppy follow destination', async () => {
    rememberRequest()
    const view = await render('/auth/finish?flow=1234567890123456&next=' + encodeURIComponent('/app/puppy-updates/QA-RUBY?follow=1'))
    expect(s.signin).toHaveBeenCalledTimes(1); expect(s.signin.mock.calls[0][1]).toBe('qa@example.invalid')
    expect(s.finish).toHaveBeenCalledWith(expect.objectContaining({ uid: 'synthetic' }), true, 'Ruby Friend', true)
    expect(view.root.findAllByType('input')).toHaveLength(0); expect(view.root.findAllByType('form')).toHaveLength(0)
    expect(s.path).toBe('/p/QA-RUBY?follow=1'); expect(s.track).toHaveBeenCalledTimes(1)
    expect(localStorage.removeItem).toHaveBeenCalledWith('idogs.signin.1234567890123456'); view.unmount()
  })
  it('does not submit a single-use link again while an automatic request is pending', async () => {
    rememberRequest(); let resolve!: (result: unknown) => void
    s.signin.mockImplementation(() => new Promise(r => { resolve = r }))
    const view = await render('/auth/finish?flow=1234567890123456')
    await act(async () => { view.update(createElement(StrictMode, null, createElement(MemoryRouter, { initialEntries: ['/auth/finish?flow=1234567890123456'] }, createElement(EmailSigninFinishPage), createElement(LocationProbe)))) })
    expect(s.signin).toHaveBeenCalledTimes(1); expect(s.finish).not.toHaveBeenCalled(); expect(view.root.findAllByType('input')).toHaveLength(0)
    await act(async () => { resolve({ user: { uid: 'synthetic', email: 'qa@example.invalid' } }) }); expect(s.finish).toHaveBeenCalledTimes(1); view.unmount()
  })
  it('offers a retry after automatic profile failure without asking for details or consuming the code again', async () => {
    rememberRequest(); s.finish.mockRejectedValueOnce(new Error('network'))
    const view = await render('/auth/finish?flow=1234567890123456')
    expect(view.root.findAllByType('input')).toHaveLength(0); expect(s.signin).toHaveBeenCalledTimes(1)
    await submit(view); expect(s.signin).toHaveBeenCalledTimes(1); expect(s.finish).toHaveBeenCalledTimes(2); view.unmount()
  })
  it('does not automatically sign in on another browser and never asks for the name again', async () => {
    const view = await render('/auth/finish?flow=1234567890123456')
    expect(s.signin).not.toHaveBeenCalled(); expect(view.root.findAllByType('input')).toHaveLength(1)
    expect(view.root.findByType('input').props.type).toBe('email'); view.unmount()
  })
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
