import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountDeletion, { deletionFailureMessage } from '../components/ui/AccountDeletion'

const qa = vi.hoisted(() => ({ reauth: vi.fn(), token: vi.fn(async () => 'synthetic-token') }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { email: 'synthetic@example.invalid', getIdToken: qa.token } }) }))
vi.mock('firebase/auth', () => ({ EmailAuthProvider: { credential: vi.fn(() => 'synthetic-credential') }, reauthenticateWithCredential: qa.reauth }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
const reply = (status: string, canCancel = false) => new Response(JSON.stringify({ status, canCancel }))

describe('Account deletion confirmation UI', () => {
  it.each(['waiting_for_writes', 'review_required', 'removing_data', 'verifying'])('keeps %s separate from completion and disables cancellation', async processingStage => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'processing',canCancel:false,processingStage}))))
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    const text = JSON.stringify(renderer.toJSON())
    expect(text).not.toContain('Account deletion has completed.')
    expect(text).not.toContain('Completed:')
    expect(renderer.root.findAllByType('form')).toHaveLength(0)
    act(() => renderer.unmount())
  })
  it('shows confirmed completion with the reviewed retention limitation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',canCancel:false,processingStage:'completed',completedAt:'2026-10-25T00:00:00Z',retainedCategories:['financial']}))))
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Account deletion has completed.')
    expect(text).toContain('Completed:')
    expect(text).toContain('Completion does not mean every historical record or backup was erased.')
    expect(renderer.root.findAllByType('form')).toHaveLength(0)
    act(() => renderer.unmount())
  })
  it('shows the 7-day due date and that a web subscription is cancelled at processing, in Australian date format', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'requested', canCancel: true, targetAt: '2026-10-28T00:00:00Z',
      nextUpdateDueAt: '2026-10-28T00:00:00Z', renewalStatus: 'pending_verification',
    }))))
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Deletion due by:')
    expect(text).toContain('28 Oct 2026')
    expect(text).not.toContain('Next update due:')
    expect(text).toContain('is cancelled when we process the deletion')
    expect(text).not.toMatch(/does not restart|service target|pending verification/)
    act(() => renderer.unmount())
  })
  it('cancelled receipts hide obsolete deletion targets but retain verified renewal outcome', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'cancelled', canCancel: false, targetAt: '2026-10-28T00:00:00Z',
      nextUpdateDueAt: '2026-10-28T00:00:00Z', renewalStatus: 'verified_stopped',
    }))))
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    const text = JSON.stringify(renderer.toJSON())
    expect(text).not.toContain('Deletion due by:')
    expect(text).toContain('Future renewal has been verified as stopped')
    act(() => renderer.unmount())
  })
  it('legacy or malformed status adds no invented target or billing success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'requested', canCancel: true, targetAt: 'invalid', renewalStatus: 'unknown',
    }))))
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    const text = JSON.stringify(renderer.toJSON())
    expect(text).not.toContain('Invalid Date')
    expect(text).not.toContain('Processing target:')
    expect(text).not.toContain('Future renewal has been verified')
    act(() => renderer.unmount())
  })
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

  it('a pending request can be cancelled: the button is not greyed out and the label says a password is needed (Owner QA 178)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('requested', true)).mockResolvedValueOnce(reply('cancelled'))
    vi.stubGlobal('fetch', fetchMock)
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    expect(JSON.stringify(renderer.toJSON())).toContain('Enter your password to cancel this request')
    const cancel = renderer.root.findAll(n => n.type === 'button' && n.props.type === 'submit')[0]
    expect(cancel.props.disabled).toBe(false)
    // Submitting without a password explains why instead of doing nothing.
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(JSON.stringify(renderer.toJSON())).toContain('Enter your password to confirm this action.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    act(() => renderer.root.findByProps({ type: 'password' }).props.onChange({ target: { value: 'QA-only-secret' } }))
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'cancel' })
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

  it('hides stale controls after a failed refresh and restores only the newly read state', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('none'))
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockResolvedValueOnce(reply('processing'))
    vi.stubGlobal('fetch', fetchMock)
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    expect(renderer.root.findAllByType('form')).toHaveLength(1)
    act(() => renderer.root.findByProps({ type: 'password' }).props.onChange({ target: { value: 'synthetic' } }))
    act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    const refresh = () => renderer.root.findAllByType('button').find(b => b.children.join('') === 'Refresh status')!
    await act(async () => refresh().props.onClick())
    expect(renderer.root.findAllByType('form')).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': 'Account deletion request status' }).findAllByType('strong')).toHaveLength(0)
    await act(async () => refresh().props.onClick())
    expect(renderer.root.findAllByType('form')).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': 'Account deletion request status' }).findByType('strong').children.join('')).toContain('processing')
    expect(fetchMock.mock.calls.every(call => call[1].method === 'GET')).toBe(true)
    act(() => renderer.unmount())
  })

  it('shows storage recovery as incomplete and does not allow cancellation after processing starts', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'processing',canCancel:false,processingStage:'waiting_for_storage',storageReviewAfter:'2026-11-01T00:00:00.000Z'}))))
    const renderer=create(createElement(AccountDeletion))
    await act(async()=>renderer.root.findByType('button').props.onClick())
    const text=JSON.stringify(renderer.toJSON())
    expect(text).toContain('Deleted files are still within the storage recovery period')
    expect(text).toContain('not confirmation that every copy has been erased')
    expect(renderer.root.findAllByType('form')).toHaveLength(0)
    expect(text).not.toContain('Account deletion has completed.')
    act(()=>renderer.unmount())
  })

  it.each(['request', 'cancel'])('requires status reconciliation after a lost %s response', async action => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(action === 'cancel' ? 'requested' : 'none', action === 'cancel'))
      .mockRejectedValueOnce(new TypeError('Lost response'))
      .mockResolvedValueOnce(reply(action === 'cancel' ? 'cancelled' : 'requested', action === 'request'))
    vi.stubGlobal('fetch', fetchMock)
    const renderer = create(createElement(AccountDeletion))
    await act(async () => renderer.root.findByType('button').props.onClick())
    act(() => renderer.root.findByProps({ type: 'password' }).props.onChange({ target: { value: 'synthetic' } }))
    if (action === 'request') act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(renderer.root.findAllByType('form')).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': 'Account deletion request status' }).findAllByType('strong')).toHaveLength(0)
    await act(async () => renderer.root.findAllByType('button').find(b => b.children.join('') === 'Refresh status')!.props.onClick())
    expect(fetchMock.mock.calls[2][1].method).toBe('GET')
    expect(renderer.root.findByProps({ type: 'password' }).props.value).toBe('')
    if (action === 'cancel') expect(renderer.root.findByProps({ type: 'checkbox' }).props.checked).toBe(false)
    act(() => renderer.unmount())
  })

})

describe('account deletion failure messages (device diagnosis)', () => {
  it('shows the HTTP code and server text instead of a bare "unavailable"', () => {
    expect(deletionFailureMessage(500, { error: 'Account deletion service is temporarily unavailable. No completion is confirmed.' }))
      .toBe('The deletion service is unavailable (HTTP 500: Account deletion service is temporarily unavailable. No completion is confirmed.). Request status is not confirmed; refresh to check before retrying.')
    expect(deletionFailureMessage(404, null)).toContain('(HTTP 404)')
    expect(deletionFailureMessage(200, { status: 1 })).toContain('(HTTP 200)')
  })
  it('passes through user-facing 4xx reasons and keeps 401 as sign-in again', () => {
    expect(deletionFailureMessage(429, { error: 'Please wait a minute before requesting again.' })).toBe('Please wait a minute before requesting again. (HTTP 429)')
    expect(deletionFailureMessage(409, { error: 'This request cannot be cancelled.' })).toBe('This request cannot be cancelled. (HTTP 409)')
    expect(deletionFailureMessage(401, { error: 'x' })).toBe('Please sign in again and retry.')
  })
  it('never reflects non-string or oversized server bodies', () => {
    expect(deletionFailureMessage(503, { error: { stack: 'secret' } })).not.toContain('secret')
    expect(deletionFailureMessage(400, { error: 'a'.repeat(500) }).length).toBeLessThan(260)
  })
})
