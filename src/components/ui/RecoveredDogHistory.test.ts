import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, test, vi } from 'vitest'
vi.mock('../../lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }))
import RecoveredDogHistory from './RecoveredDogHistory'
const history = { id: 'snap', dogId: 'dog', dog: { name: 'Historical dog' }, transferredAt: '2026-10-07T00:00:00Z', vaccineRecords: [{ id: 'v1', name: 'Old vaccine', dateGiven: '2026-08-01' }], activityNotes: [{ id: 'n1', text: 'Old note', photoUrl: 'https://must-not-render/current-image' }] }
let tree: ReactTestRenderer | undefined
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; vi.unstubAllGlobals() })
const render = () => act(() => { tree = create(createElement(MemoryRouter, {}, createElement(RecoveredDogHistory, { history }))) })
const click = (label: string) => tree!.root.findAllByType('button').find(b => b.children.includes(label))!.props.onClick()
test('restores section navigation, shows known old data, marks missing history instead of zero and offers no edit actions', () => {
  render()
  expect(JSON.stringify(tree!.toJSON())).toContain('partially recovered')
  act(() => click('Vaccines')); expect(JSON.stringify(tree!.toJSON())).toContain('Old vaccine')
  act(() => click('Health tests')); expect(JSON.stringify(tree!.toJSON())).toContain('does not confirm that none existed')
  act(() => click('Timeline')); expect(JSON.stringify(tree!.toJSON())).toContain('Old note')
  expect(JSON.stringify(tree!.toJSON())).not.toContain('must-not-render')
  expect(tree!.root.findAllByType('input')).toHaveLength(0)
})
test('photos use snapshot-only signing and show signed historical media', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ photos: [{ id: '0', url: 'https://example.test/frozen-image' }], unavailable: 1 }) })
  vi.stubGlobal('fetch', fetcher); render()
  await act(async () => { click('Photos') })
  expect(fetcher).toHaveBeenCalledWith('/api/get-history-media', expect.objectContaining({ body: JSON.stringify({ dogId: 'dog', snapshotId: 'snap' }) }))
  expect(tree!.root.findByType('img').props.src).toBe('https://example.test/frozen-image')
  expect(JSON.stringify(tree!.toJSON())).toContain('historical photo(s) are currently unavailable')
})
test('failed photo requests expose a retry state rather than an empty success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false })); render()
  await act(async () => { click('Photos') })
  expect(JSON.stringify(tree!.toJSON())).toContain('Historical photos could not be loaded')
  expect(tree!.root.findAllByType('button').some(b => b.children.includes('Retry'))).toBe(true)
})
