import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../components/ui/PuppyStoryPanel', () => ({ default: () => null }))
vi.mock('../components/ui/QrDocuments', () => ({ default: () => null }))
import PassportPublicPage from './PassportPublicPage'
afterEach(() => vi.unstubAllGlobals())
async function render() { let view!: ReturnType<typeof create>; await act(async () => { view = create(createElement(MemoryRouter, { initialEntries: ['/p/QR-RUBY'] }, createElement(Routes, {}, createElement(Route, { path: '/p/:passportId', element: createElement(PassportPublicPage) })))) }); return view }
it('keeps a genuine 404 distinct from a temporary server failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }))
  const view = await render(); expect(JSON.stringify(view.toJSON())).toContain('Passport not found'); expect(view.root.findAllByType('button')).toHaveLength(0); view.unmount()
})
it('offers retry after a temporary outage without leaking raw details or pretending that the profile was removed', async () => {
  const request = vi.fn().mockResolvedValueOnce({ status: 500, ok: false }).mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ dog: { name: 'Ruby', breed: 'Poodle', sex: 'female', dateOfBirth: '2026-10-01', lifeStage: 'puppy', passportId: 'QR-RUBY' }, vaccines: [], healthTests: [] }) })
  vi.stubGlobal('fetch', request)
  const view = await render()
  expect(view.root.findByProps({ role: 'alert' })).toBeTruthy(); expect(JSON.stringify(view.toJSON())).not.toContain('Passport not found')
  await act(async () => { view.root.findByType('button').props.onClick() })
  expect(JSON.stringify(view.toJSON())).toContain('Ruby'); expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0); view.unmount()
})
