import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ user: null as null | { uid: string }, request: vi.fn() }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: state.user, loading: false }) }))
vi.mock('../../lib/puppyUpdates', () => ({ puppyUpdates: state.request, puppyPath: (id: string) => `/p/${id}`, puppyAppPath: (id: string) => `/app/puppy-updates/${id}` }))
import PuppyStoryPanel from './PuppyStoryPanel'

const story = (role = 'public', text = 'First garden adventure') => ({ dog: { name: 'Ruby', passportId: 'QR-RUBY' }, dogId: role === 'owner' ? 'ruby' : undefined, role, following: false, publicEnabled: true, updates: [{ id: 'one', text, date: '2026-10-28', audience: 'public', media: [] }] })
let screen: ReactTestRenderer
const render = () => createElement(MemoryRouter, {}, createElement(PuppyStoryPanel, { passportId: 'QR-RUBY' }))
beforeEach(() => { state.user = null; state.request.mockReset(); state.request.mockResolvedValue(story()) })

it('shows public updates without forcing login and preserves the puppy through signup', async () => {
  await act(async () => { screen = create(render()) })
  const serialized = JSON.stringify(screen.toJSON())
  expect(serialized).toContain('First garden adventure')
  const signup = screen.root.findAllByType('a').find(link => link.props.href.startsWith('/signup'))!
  expect(decodeURIComponent(signup.props.href)).toContain('next=/p/QR-RUBY')
  expect(serialized.indexOf('First garden adventure')).toBeLessThan(serialized.indexOf('Want to keep this story close?'))
  expect(serialized).not.toContain('Ownership remains')
})
it('saves a signed-in customer’s puppy and refreshes the view', async () => {
  state.user = { uid: 'customer' }
  await act(async () => { screen = create(render()) })
  const follow = screen.root.findAllByType('button').find(button => button.children.join('') === 'Follow this puppy')!
  await act(async () => { await follow.props.onClick() })
  expect(state.request).toHaveBeenCalledWith({ passportId: 'QR-RUBY', action: 'follow' })
  expect(state.request).toHaveBeenLastCalledWith({ passportId: 'QR-RUBY', action: 'view' })
})
it('shows owner continuation on the existing dog profile after transfer', async () => {
  state.user = { uid: 'owner' }; state.request.mockResolvedValue(story('owner'))
  await act(async () => { screen = create(render()) })
  expect(screen.root.findAllByType('a').some(a => a.props.href === '/app/dogs/ruby')).toBe(true)
  expect(JSON.stringify(screen.toJSON())).not.toContain('Follow this puppy')
})
it('removes private content immediately when switching account and ignores the old request', async () => {
  state.user = { uid: 'buyer' }; state.request.mockResolvedValueOnce(story('buyer', 'Private buyer update'))
  await act(async () => { screen = create(render()) })
  expect(JSON.stringify(screen.toJSON())).toContain('Private buyer update')
  let resolve!: (value: unknown) => void
  state.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  state.user = { uid: 'other' }
  await act(async () => { screen.update(render()) })
  expect(JSON.stringify(screen.toJSON())).not.toContain('Private buyer update')
  await act(async () => { resolve(story('public', 'Public only')) })
  expect(JSON.stringify(screen.toJSON())).toContain('Public only')
  expect(JSON.stringify(screen.toJSON())).not.toContain('Private buyer update')
})
it('reports unavailable updates and offers a refresh without an empty-success state', async () => {
  state.request.mockRejectedValue(new Error('Temporary connection issue'))
  await act(async () => { screen = create(render()) })
  expect(screen.root.findByProps({ role: 'alert' }).children.join('')).toBe('Temporary connection issue')
  expect(JSON.stringify(screen.toJSON())).not.toContain('No updates shared here yet')
})
