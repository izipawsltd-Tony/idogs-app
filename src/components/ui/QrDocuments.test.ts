import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }))
import { QrDocumentManager, QrDocumentShareCheckbox, QrDocumentSharingFooter, QrDocumentSharingSummary } from './QrDocuments'
const documents = [{ id: 'one', title: 'Certificate', filePath: 'dogs/test/one.pdf' }, { id: 'two', title: 'Photo', filePath: 'dogs/test/two.jpg' }, { id: 'unsupported', filePath: 'dogs/test/file.exe' }]
let tree: ReactTestRenderer
const request = vi.fn()
const response = (documentIds: string[]) => ({ ok: true, json: async () => ({ documentIds }) })
async function render(enabled = true) {
  await act(async () => {
    tree = create(React.createElement(QrDocumentManager, { dogId: 'test', documents, enabled, children: React.createElement(React.Fragment, null,
      React.createElement(QrDocumentSharingSummary),
      ...documents.map(document => React.createElement(QrDocumentShareCheckbox, { key: document.id, document })),
      React.createElement(QrDocumentSharingFooter)) }))
  })
}
beforeEach(() => { request.mockReset().mockResolvedValue(response(['one', 'deleted'])); vi.stubGlobal('fetch', request) })
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllGlobals() })
it('loads existing selections and saves only current eligible document IDs after explicit Save', async () => {
  await render()
  const inputs = tree.root.findAllByType('input')
  expect(inputs).toHaveLength(2)
  expect(inputs[0].props.checked).toBe(true)
  act(() => inputs[1].props.onChange({ target: { checked: true } }))
  expect(request).toHaveBeenCalledTimes(1)
  request.mockResolvedValueOnce(response(['one', 'two']))
  await act(async () => { await tree.root.findByType('button').props.onClick() })
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ dogId: 'test', action: 'save', documentIds: ['one', 'two'] })
  expect(JSON.stringify(tree.toJSON())).toContain('QR document sharing saved.')
})
it('preserves selections and reports failure without claiming sharing was saved', async () => {
  await render()
  act(() => tree.root.findAllByType('input')[1].props.onChange({ target: { checked: true } }))
  request.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Please retry' }) })
  await act(async () => { await tree.root.findByType('button').props.onClick() })
  expect(tree.root.findAllByType('input')[1].props.checked).toBe(true)
  expect(JSON.stringify(tree.toJSON())).toContain('Please retry')
  expect(JSON.stringify(tree.toJSON())).not.toContain('QR document sharing saved.')
})
it('does not load or expose sharing controls when management is disabled', async () => {
  await render(false)
  expect(request).not.toHaveBeenCalled()
  expect(tree.root.findAllByType('input')).toHaveLength(0)
  expect(tree.root.findAllByType('button')).toHaveLength(0)
})
