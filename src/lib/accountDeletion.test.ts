import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountDeletion from '../components/ui/AccountDeletion'

const qa = vi.hoisted(() => ({ reauth: vi.fn(), token: vi.fn(async () => 'synthetic-token') }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { email: 'synthetic@example.invalid', getIdToken: qa.token } }) }))
vi.mock('firebase/auth', () => ({ EmailAuthProvider: { credential: vi.fn(() => 'synthetic-credential') }, reauthenticateWithCredential: qa.reauth }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
const reply = (status: string, canCancel = false) => new Response(JSON.stringify({ status, canCancel }))

describe('Account deletion confirmation UI', () => {
  it('does not request deletion on mount/open and fails closed if backend is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html/>', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const renderer = create(createElement(AccountDeletion))
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => renderer.root.findByType('button').props.onClick())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
    expect(renderer.root.findAllByType('form')).toHaveLength(0)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('unavailable')
    act(() => renderer.unmount())
  })

  it('requires password and explicit checkbox, clears password, and never sends it to API', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('none')).mockResolvedValueOnce(reply('requested', true))
    vi.stubGlobal('fetch', fetchMock)
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    act(() => renderer.root.findByProps({ type: 'password' }).props.onChange({ target: { value: 'QA-only-secret' } }))
    act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(qa.reauth).toHaveBeenCalledTimes(1)
    expect(qa.token).toHaveBeenLastCalledWith(true)
    const request = fetchMock.mock.calls[1][1]
    expect(JSON.parse(request.body)).toEqual({ action: 'request', confirmation: 'DELETE MY ACCOUNT' })
    expect(JSON.stringify(request)).not.toContain('QA-only-secret')
    expect(renderer.root.findByProps({ type: 'password' }).props.value).toBe('')
    act(() => renderer.unmount())
  })

  it('does not submit a request after failed reauthentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('none'))
    vi.stubGlobal('fetch', fetchMock)
    qa.reauth.mockRejectedValueOnce({ code: 'auth/wrong-password' })
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    act(() => renderer.root.findByProps({ type: 'password' }).props.onChange({ target: { value: 'synthetic' } }))
    act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(renderer.root.findByProps({ type: 'password' }).props.value).toBe('')
    act(() => renderer.unmount())
  })

  it('does not offer cancellation once processing starts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('processing')))
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    expect(renderer.root.findAllByType('form')).toHaveLength(0)
    act(() => renderer.unmount())
  })
})
