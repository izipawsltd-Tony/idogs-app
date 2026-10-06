import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./firebase', () => ({ db: {}, auth: { currentUser: { uid: 'qa-user' } } }))
vi.mock('./db', () => ({ getDogDocuments: vi.fn() }))
vi.mock('firebase/firestore', () => ({ doc: vi.fn((_db, collection, id) => `${collection}/${id}`), updateDoc: vi.fn().mockResolvedValue(undefined) }))
import { auth } from './firebase'
import { getDogDocuments } from './db'
import { updateDoc } from 'firebase/firestore'
import { MAX_DOCUMENT_BYTES, uploadManualDocument } from './manualDocumentUpload'
const user = { uid: 'qa-user', getIdToken: vi.fn().mockResolvedValue('qa-token') }
const file = { name: 'qa.png', size: 100, type: 'image/png' } as File
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(auth, { currentUser: { uid: 'qa-user' } })
  vi.stubGlobal('FileReader', class {
    result = 'data:image/png;base64,cWE='
    onload?: () => void
    readAsDataURL() { this.onload?.() }
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, filePath: 'documents/qa-user/qa/other.jpg' }) }))
  vi.mocked(getDogDocuments).mockResolvedValue([{ id: 'server-created', filePath: 'documents/qa-user/qa/other.jpg' }])
  vi.mocked(updateDoc).mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())
describe('manual private API upload', () => {
  it.each([['qa.png', 'image/png'], ['qa.pdf', 'application/pdf']])('uploads %s through authenticated API and updates the server record', async (name, mediaType) => {
    expect(await uploadManualDocument(user, { ...file, name } as File, 'qa', 'other', ' QA title ', ' QA notes ')).toEqual({ metadataSaved: true })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/api/upload-document', expect.objectContaining({ headers: { 'Content-Type': 'application/json', Authorization: 'Bearer qa-token' }, body: JSON.stringify({ base64: 'cWE=', mediaType, dogId: 'qa', documentType: 'other' }) }))
    expect(updateDoc).toHaveBeenCalledWith('documents/server-created', { name: 'QA title', title: 'QA title', notes: 'QA notes', source: 'manual' })
  })
  it('reports uploaded with missing metadata rather than inviting another upload', async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error('denied'))
    expect(await uploadManualDocument(user, file, 'qa', 'other', '', '')).toEqual({ metadataSaved: false })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('does not invent a document when server metadata cannot be found', async () => {
    vi.mocked(getDogDocuments).mockResolvedValueOnce([])
    expect(await uploadManualDocument(user, file, 'qa', 'other', '', '')).toEqual({ metadataSaved: false })
    expect(updateDoc).not.toHaveBeenCalled()
  })
  it('stops before upload when account changed', async () => {
    Object.assign(auth, { currentUser: { uid: 'different-user' } })
    await expect(uploadManualDocument(user, file, 'qa', 'other', '', '')).rejects.toThrow('Account changed')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not update metadata after an account switch during upload', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      Object.assign(auth, { currentUser: { uid: 'different-user' } })
      return { ok: true, json: async () => ({ success: true, filePath: 'documents/qa-user/qa/other.jpg' }) } as Response
    })
    expect(await uploadManualDocument(user, file, 'qa', 'other', '', '')).toEqual({ metadataSaved: false })
    expect(getDogDocuments).not.toHaveBeenCalled()
    expect(updateDoc).not.toHaveBeenCalled()
  })
  it.each([0, MAX_DOCUMENT_BYTES + 1])('rejects invalid size %s before reading or uploading', async size => {
    await expect(uploadManualDocument(user, { ...file, size } as File, 'qa', 'other', '', '')).rejects.toThrow('3 MB')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not read or update records on an upload rejection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response)
    await expect(uploadManualDocument(user, file, 'qa', 'other', '', '')).rejects.toThrow('Upload failed')
    expect(getDogDocuments).not.toHaveBeenCalled()
    expect(updateDoc).not.toHaveBeenCalled()
  })
})
