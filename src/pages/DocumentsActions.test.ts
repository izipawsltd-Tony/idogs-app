// Behavioural test: Documents page View → Edit → Delete actually work
// (not only layout). Firestore/Storage are mocked; rules are proven separately
// by scripts/test-documents-rules-emulator.mjs.
import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  user: { uid: 'owner-1', email: 'o@example.invalid' } as any,
  docs: [] as any[],
  view: vi.fn(), update: vi.fn(), remove: vi.fn(), toast: vi.fn(),
}))
vi.mock('../lib/firebase', () => ({ auth: { get currentUser() { return s.user } }, db: {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: s.user }) }))
vi.mock('../lib/documentViewer', () => ({ viewDocument: s.view }))
vi.mock('../lib/manualDocumentUpload', () => ({ uploadManualDocument: vi.fn() }))
vi.mock('../lib/db', () => ({
  getAllDocumentsForUser: vi.fn(async () => s.docs.map(d => ({ ...d }))),
  getDogs: vi.fn(async () => [{ id: 'dog-1', name: 'Ruby' }]),
  updateDocument: s.update,
  deleteDocument: s.remove,
}))
import DocumentsPage from './DocumentsPage'

let tree: ReactTestRenderer
beforeEach(() => {
  s.user = { uid: 'owner-1', email: 'o@example.invalid' }
  s.docs = [{ id: 'doc-1', dogId: 'dog-1', documentType: 'vaccine_card', name: 'Old card', filePath: 'documents/owner-1/dog-1/a.pdf', fileType: 'pdf' }]
  s.view.mockReset(); s.update.mockReset().mockResolvedValue(undefined); s.remove.mockReset().mockResolvedValue(undefined); s.toast.mockReset()
  vi.stubGlobal('window', { confirm: vi.fn(() => true) })
})
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllGlobals() })

async function render() {
  await act(async () => { tree = create(createElement(MemoryRouter, null, createElement(DocumentsPage, { toast: s.toast }))) })
}
const textOf = (n: ReactTestInstance | string): string =>
  typeof n === 'string' ? n : n.children.map(c => textOf(c as any)).join('')
const text = () => textOf(tree.root)
const buttonNamed = (label: string): ReactTestInstance => {
  const found = tree.root.findAll(n => n.type === 'button' && textOf(n).includes(label))
  if (!found.length) throw new Error('No button: ' + label)
  return found[0]
}

it('renders actions in owner-approved order View → Edit → Delete', async () => {
  await render()
  const labels = tree.root.findAllByType('button').map(b => textOf(b)).filter(l => /View|Edit|Delete/.test(l))
  const idx = (k: string) => labels.findIndex(l => l.includes(k))
  expect(idx('View')).toBeGreaterThanOrEqual(0)
  expect(idx('View')).toBeLessThan(idx('Edit'))
  expect(idx('Edit')).toBeLessThan(idx('Delete'))
})

it('View opens the private document via the signed-URL viewer', async () => {
  await render()
  act(() => buttonNamed('View').props.onClick())
  expect(s.view).toHaveBeenCalledWith(s.user, s.toast, 'documents/owner-1/dog-1/a.pdf', undefined)
})

it('Edit renames the document, persists it and updates the list', async () => {
  await render()
  act(() => buttonNamed('Edit').props.onClick())
  const input = tree.root.findByProps({ id: 'document-edit-name' })
  expect(input.props.value).toBe('Old card')
  act(() => input.props.onChange({ target: { value: '  Rabies cert 2026  ' } }))
  await act(async () => { await tree.root.findByProps({ 'aria-label': 'Edit document' }).findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(s.update).toHaveBeenCalledWith('doc-1', 'Rabies cert 2026')
  expect(text()).toContain('Rabies cert 2026')
  expect(tree.root.findAllByProps({ id: 'document-edit-name' })).toHaveLength(0)
  expect(s.toast).toHaveBeenCalledWith('Document updated', 'success')
})

it('Edit failure keeps the original name and reports an error', async () => {
  s.update.mockRejectedValue(new Error('permission-denied'))
  await render()
  act(() => buttonNamed('Edit').props.onClick())
  act(() => tree.root.findByProps({ id: 'document-edit-name' }).props.onChange({ target: { value: 'New' } }))
  await act(async () => { await tree.root.findByProps({ 'aria-label': 'Edit document' }).findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(s.toast).toHaveBeenCalledWith('Failed to update document', 'error')
  expect(text()).toContain('Old card')
})

it('Edit does not apply a result after the signed-in account changes', async () => {
  let release!: () => void
  s.update.mockImplementation(() => new Promise<void>(r => { release = r }))
  await render()
  act(() => buttonNamed('Edit').props.onClick())
  act(() => tree.root.findByProps({ id: 'document-edit-name' }).props.onChange({ target: { value: 'Leaked' } }))
  let pending!: Promise<void>
  act(() => { pending = tree.root.findByProps({ 'aria-label': 'Edit document' }).findByType('form').props.onSubmit({ preventDefault() {} }) })
  s.user = { uid: 'other-account' }
  await act(async () => { release(); await pending })
  expect(text()).not.toContain('Leaked')
})

it('Delete asks for confirmation, deletes and removes the row', async () => {
  await render()
  await act(async () => { await buttonNamed('Delete').props.onClick() })
  expect((globalThis as any).window.confirm).toHaveBeenCalled()
  expect(s.remove).toHaveBeenCalledWith('doc-1')
  expect(text()).not.toContain('Old card')
})

it('Delete cancelled at the confirmation does nothing', async () => {
  vi.stubGlobal('window', { confirm: vi.fn(() => false) })
  await render()
  await act(async () => { await buttonNamed('Delete').props.onClick() })
  expect(s.remove).not.toHaveBeenCalled()
  expect(text()).toContain('Old card')
})
