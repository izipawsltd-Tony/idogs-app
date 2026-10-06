import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { viewDocument } from './documentViewer'
const open = vi.fn()
const toast = vi.fn()
const user = { getIdToken: vi.fn().mockResolvedValue('qa-token') }
function platform(value?: string) {
  vi.stubGlobal('document', { documentElement: { dataset: { idogsNativePlatform: value } } })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { open })
  platform('android')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://storage.example/qa?signature=test' }) }))
})
afterEach(() => vi.unstubAllGlobals())
describe('secure document viewing', () => {
  it('opens only the final URL on native, after authentication completes', async () => {
    let resolve!: (value: string) => void
    const pendingUser = { getIdToken: () => new Promise<string>(r => { resolve = r }) }
    const task = viewDocument(pendingUser, toast, 'documents/qa/file.pdf')
    expect(open).not.toHaveBeenCalled()
    resolve('qa-token')
    await task
    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith('https://storage.example/qa?signature=test', '_blank', 'noopener,noreferrer')
    expect(fetch).toHaveBeenCalledWith('/api/get-signed-url', expect.objectContaining({ body: JSON.stringify({ filePath: 'documents/qa/file.pdf' }) }))
  })
  it('keeps a synchronous placeholder for regular web popup blockers', async () => {
    platform()
    const popup = { location: { href: '' }, close: vi.fn(), opener: {} }
    open.mockReturnValueOnce(popup)
    const task = viewDocument(user, toast, 'documents/qa/file.pdf')
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    await task
    expect(popup.location.href).toBe('https://storage.example/qa?signature=test')
    expect(popup.opener).toBeNull()
  })
  it.each([403, 404, 500])('does not open a native browser when API returns %s', async status => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status } as Response)
    await viewDocument(user, toast, 'private/qa')
    expect(open).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'error')
  })
  it('does not fetch private documents without authentication', async () => {
    await viewDocument(null, toast, 'private/qa')
    expect(fetch).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })
  it.each(['javascript:alert(1)', 'http://example.com/file', undefined])('rejects unsafe signed URL %s', async url => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ url }) } as Response)
    await viewDocument(user, toast, 'private/qa')
    expect(open).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'error')
  })
  it('closes a web placeholder after a network failure', async () => {
    platform()
    const popup = { close: vi.fn(), opener: {}, location: { href: '' } }
    open.mockReturnValueOnce(popup)
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    await viewDocument(user, toast, 'private/qa')
    expect(popup.close).toHaveBeenCalledOnce()
  })
})
