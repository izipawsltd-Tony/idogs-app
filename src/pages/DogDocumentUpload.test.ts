import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../lib/db', () => ({ getAllDocumentsForUser: vi.fn(), getDogs: vi.fn(), deleteDocument: vi.fn() }))
import { UploadModal } from './DocumentsPage'
import type { Dog } from '../types'
let tree: ReactTestRenderer
const request = vi.fn(), success = vi.fn(), toast = vi.fn()
beforeEach(() => {
  request.mockReset().mockResolvedValue({ ok: true, json: async () => ({ documentId: 'new-doc', filePath: 'documents/owner/puppy/test.pdf', fileType: 'pdf' }) })
  success.mockReset(); toast.mockReset(); vi.stubGlobal('fetch', request)
  vi.stubGlobal('FileReader', class { result = 'data:application/pdf;base64,cGRm'; onload?: () => void; readAsDataURL() { this.onload?.() } })
  act(() => { tree = create(React.createElement(UploadModal, { dogs: [{ id: 'puppy', name: 'Ruby' }, { id: 'other', name: 'Blue' }] as Dog[], fixedDogId: 'puppy', user: { getIdToken: async () => 'fixture-token' }, onClose: vi.fn(), onSuccess: success, toast })) })
})
afterEach(() => { act(() => tree.unmount()); vi.unstubAllGlobals() })
function chooseFile() { act(() => tree.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [{ name: 'certificate.pdf', size: 100, type: 'application/pdf' }] } })) }
it('uploads to the current puppy using authentication and does not automatically share it', async () => {
  const selector = tree.root.findByProps({ 'aria-label': 'Dog' })
  expect(selector.props.disabled).toBe(true)
  // Even a stale programmatic selection must not override the locked puppy.
  act(() => selector.props.onChange({ target: { value: 'other' } }))
  chooseFile()
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toBe('/api/upload-document')
  expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-token')
  expect(JSON.parse(request.mock.calls[0][1].body).dogId).toBe('puppy')
  expect(success).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-doc', dogId: 'puppy', filePath: 'documents/owner/puppy/test.pdf' }))
})
it('retains the selected file and allows retry after a failed upload', async () => {
  chooseFile(); request.mockResolvedValueOnce({ ok: false })
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(success).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith('Upload failed — please try again', 'error')
  expect(JSON.stringify(tree.toJSON())).toContain('certificate.pdf')
  expect(tree.root.findByProps({ type: 'submit' }).props.disabled).toBe(false)
})
