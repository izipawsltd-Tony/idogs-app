// Owner QA P0 (01 Nov 2026): upload named "Mum's pedigree" was shown as
// "Pedigree Certificate". Covers the upload payload (JPG + PDF), the type
// differing from the name, blank names, and both list views.
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/firebase', () => ({ auth: { currentUser: null }, db: {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../lib/db', () => ({ getAllDocumentsForUser: vi.fn(), getDogs: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn() }))
import { UploadModal } from './DocumentsPage'
import { documentDisplayName } from '../lib/documentName'

const label = (t: string) => (t === 'pedigree' ? 'Pedigree Certificate' : 'Document')
let tree: ReactTestRenderer
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ documentId: 'doc-new', filePath: 'documents/u/dog-1/x', fileType: 'jpg' }) }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('FileReader', class { result = 'data:x;base64,QUJD'; onload: null | (() => void) = null; onerror = null; readAsDataURL() { setTimeout(() => this.onload?.(), 0) } })
})
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllGlobals() })

async function upload({ fileName, type, title, docType = 'pedigree' }: { fileName: string; type: string; title?: string; docType?: string }) {
  const onSuccess = vi.fn()
  await act(async () => {
    tree = create(createElement(UploadModal, { dogs: [{ id: 'dog-1', name: 'Mum', breed: 'Labrador' } as any], fixedDogId: 'dog-1', user: { getIdToken: async () => 'tok' }, onClose: vi.fn(), onSuccess, toast: vi.fn() }))
  })
  const selects = tree.root.findAllByType('select')
  act(() => selects[1].props.onChange({ target: { value: docType } }))
  const file = { name: fileName, type, size: 1000 }
  act(() => tree.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [file] } }))
  if (title !== undefined) {
    const titleInput = tree.root.findAll(n => n.type === 'input' && typeof n.props.placeholder === 'string' && n.props.placeholder.startsWith('e.g. Pedigree') || (n.type === 'input' && typeof n.props.placeholder === 'string' && n.props.placeholder.includes(' — ')))[0]
    act(() => titleInput.props.onChange({ target: { value: title } }))
  }
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); await new Promise(r => setTimeout(r, 5)) })
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  return { body, saved: onSuccess.mock.calls[0]?.[0] }
}

describe('custom document name survives upload', () => {
  for (const [fileName, type] of [['scan.jpg', 'image/jpeg'], ['cert.pdf', 'application/pdf']]) {
    it(`${type}: "Mum's pedigree" is sent and displayed; type stays Pedigree Certificate`, async () => {
      const { body, saved } = await upload({ fileName, type, title: "Mum's pedigree" })
      expect(body.title).toBe("Mum's pedigree")
      expect(body.documentType).toBe('pedigree')
      expect(saved.title).toBe("Mum's pedigree")
      expect(documentDisplayName(saved, label)).toBe("Mum's pedigree")
    })
  }
  it('trims surrounding spaces only', async () => {
    const { body } = await upload({ fileName: 'a.jpg', type: 'image/jpeg', title: "  Mum's pedigree  " })
    expect(body.title).toBe("Mum's pedigree")
  })
  it('blank name: the type label is NOT persisted as a name; display still falls back to the type', async () => {
    const { body, saved } = await upload({ fileName: 'a.jpg', type: 'image/jpeg', title: '' })
    expect('title' in body).toBe(false)
    expect('title' in saved).toBe(false)
    expect(documentDisplayName(saved, label)).toBe('Pedigree Certificate')
  })
})

describe('both document lists use the shared display rule', () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
  it('Dog Detail Documents tab shows name → title → type (was name → type)', () => {
    const src = read('./DogDetailPage.tsx')
    expect(src).toContain('{documentDisplayName(doc, getDocLabel)}')
    expect(src).not.toContain('{doc.name || getDocLabel(doc.documentType)}')
    expect(src).toContain('setEditDocName(documentEditableName(doc))')
  })
  it('Documents page uses the same helper', () => {
    expect(read('./DocumentsPage.tsx')).toContain('{documentDisplayName(doc, getDocLabel)}')
  })
})
