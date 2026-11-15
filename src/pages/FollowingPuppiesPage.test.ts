import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'qa' } }) }))
vi.mock('../lib/puppyUpdates', () => ({ puppyUpdates: s.request, puppyPath: (id: string) => `/p/${id}` }))
import FollowingPuppiesPage from './FollowingPuppiesPage'
beforeEach(() => s.request.mockReset().mockResolvedValue({ puppies: [] }))
async function render() { let view!: ReturnType<typeof create>; await act(async () => { view = create(createElement(MemoryRouter, {}, createElement(FollowingPuppiesPage))) }); return view }
it('explains a genuine empty list and separates following from ownership', async () => {
  const view = await render(), text = JSON.stringify(view.toJSON())
  expect(text).toContain('Your puppy’s story starts here'); expect(text).toContain('Following saves a profile. It does not reserve a puppy or transfer ownership.')
  expect(view.root.findAllByType('h3').map(h => h.children.join(''))).toEqual(['Open their profile', 'Choose Follow', 'Watch their story grow'])
  view.unmount()
})
it('opens followed puppies on their full QR profiles, including selected files', async () => {
  s.request.mockResolvedValue({ puppies: [{ passportId: 'QR-RUBY', name: 'Ruby', breed: 'Poodle' }] })
  const view = await render()
  expect(view.root.findAllByType('a').some(a => a.props.href === '/p/QR-RUBY')).toBe(true)
  expect(JSON.stringify(view.toJSON())).not.toContain('Your puppy’s story starts here')
  view.unmount()
})
it('shows a retryable error instead of pretending that a failed request is an empty list', async () => {
  s.request.mockRejectedValueOnce(new Error('synthetic outage'))
  const view = await render()
  expect(view.root.findByProps({ role: 'alert' })).toBeTruthy()
  expect(JSON.stringify(view.toJSON())).not.toContain('Your puppy’s story starts here')
  await act(async () => { view.root.findByType('button').props.onClick() })
  expect(JSON.stringify(view.toJSON())).toContain('Your puppy’s story starts here')
  view.unmount()
})
