import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Dog } from '../../types'

const state = vi.hoisted(() => ({ request: vi.fn(), dogs: vi.fn() }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'breeder' } }) }))
vi.mock('../../lib/db', () => ({ isCurrentOwner: () => true, getDogs: state.dogs, uploadShowcaseMediaDirect: vi.fn(), managePrivateDogAccess: vi.fn() }))
vi.mock('../../lib/puppyUpdates', () => ({ puppyUpdates: state.request, puppyPath: () => '/p/QR', puppyShareUrl: () => 'https://example.test/p/QR' }))
import PuppyUpdatesManager from './PuppyUpdatesManager'
const update = { id: 'one', text: 'Garden', date: '2026-10-28', audience: 'internal', inherited: false, media: [{ id: 'photo', kind: 'photo', url: 'https://example.test/photo' }] }
const story = { publicEnabled: false, updates: [update] }
const dog = { id: 'ruby', name: 'Ruby', litterId: 'litter', passportId: 'QR' } as Dog
let screen: ReactTestRenderer
const button = (text: string) => screen.root.findAllByType('button').find(b => b.children.join('') === text)!
beforeEach(() => {
  state.request.mockReset().mockImplementation(async body => body.action === 'gallery' ? { media: update.media } : story)
  state.dogs.mockReset().mockResolvedValue([{ id: 'blue', name: 'Blue', litterId: 'litter' }])
  vi.stubGlobal('document', { getElementById: () => null })
})
async function render() { await act(async () => { screen = create(createElement(MemoryRouter, {}, createElement(PuppyUpdatesManager, { dog }))) }) }
it('enables publishing selected media without forcing a caption', async () => {
  await render()
  await act(async () => { button('Choose from uploaded media').props.onClick() })
  await act(async () => { screen.root.findByProps({ 'aria-label': 'Select photo photo' }).props.onClick(); screen.root.findByProps({ id: 'puppy-update-audience' }).props.onChange({ target: { value: 'public' } }) })
  expect(screen.root.findByProps({ id: 'puppy-update-text' }).props.value).toBe('')
  expect(button('Publish update').props.disabled).toBe(false)
  await act(async () => { button('Publish update').props.onClick() })
  expect(state.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', text: '', audience: 'public', mediaIds: ['photo'] }))
})
it('makes the composer usable without loading the optional media library or littermates', async () => {
  await render()
  expect(state.request.mock.calls.map(([body]) => body.action)).toEqual(['view'])
  expect(state.dogs).not.toHaveBeenCalled()
  expect(screen.root.findByProps({ id: 'puppy-update-text' }).parent?.props.disabled).not.toBe(true)
  await act(async () => { button('Choose from uploaded media').props.onClick() })
  expect(state.request).toHaveBeenCalledWith({ action: 'gallery', dogId: 'ruby' })
  await act(async () => { screen.root.findAllByType('input').find(input => input.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }) })
  expect(state.dogs).toHaveBeenCalledTimes(1)
})
it('accepts typing while history loads and keeps sharing locked until its setting is known', async () => {
  let resolve!: (value: unknown) => void
  state.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await render()
  const textarea = screen.root.findByProps({ id: 'puppy-update-text' })
  expect(textarea.parent?.props.disabled).toBe(false)
  expect(screen.root.findByProps({ role: 'switch' }).props.disabled).toBe(true)
  await act(async () => { textarea.props.onChange({ target: { value: 'A draft written immediately' } }); screen.root.findByProps({ id: 'puppy-update-audience' }).props.onChange({ target: { value: 'public' } }) })
  expect(button('Publish update').props.disabled).toBe(true)
  await act(async () => { resolve(story) })
  expect(screen.root.findByProps({ id: 'puppy-update-text' }).props.value).toBe('A draft written immediately')
  expect(screen.root.findByProps({ role: 'switch' }).props.disabled).toBe(false)
})
it('updates the sharing switch immediately, locks rapid clicks, and rolls back on failure', async () => {
  await render()
  let reject!: (error: Error) => void
  state.request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  const toggle = screen.root.findByProps({ role: 'switch' })
  await act(async () => { toggle.props.onClick(); toggle.props.onClick() })
  expect(screen.root.findByProps({ role: 'switch' }).props['aria-checked']).toBe(true)
  expect(screen.root.findByProps({ role: 'switch' }).props.disabled).toBe(true)
  expect(state.request.mock.calls.filter(([body]) => body.action === 'settings')).toHaveLength(1)
  await act(async () => { reject(new Error('Connection lost')) })
  expect(screen.root.findByProps({ role: 'switch' }).props['aria-checked']).toBe(false)
  expect(screen.root.findByProps({ role: 'alert' }).children).toContain('Connection lost')
})
it('edits a saved update, removes its photo, and saves the existing update ID', async () => {
  await render()
  await act(async () => { button('Edit').props.onClick() })
  expect(screen.root.findByProps({ id: 'puppy-update-text' }).props.value).toBe('Garden')
  await act(async () => { button('× Remove').props.onClick() })
  await act(async () => { screen.root.findByProps({ id: 'puppy-update-text' }).props.onChange({ target: { value: 'Garden again' } }) })
  await act(async () => { await button('Save changes').props.onClick() })
  expect(state.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'edit', dogId: 'ruby', updateId: 'one', text: 'Garden again', mediaIds: [] }))
})
it('cancels editing without making a write and keeps litter choices collapsed until requested', async () => {
  await render()
  expect(button('Select all (up to 12)')).toBeUndefined()
  await act(async () => { button('Edit').props.onClick() })
  await act(async () => { button('× Remove').props.onClick(); button('Cancel').props.onClick() })
  expect(state.request.mock.calls.some(([body]) => body.action === 'edit')).toBe(false)
  expect(screen.root.findByProps({ id: 'puppy-update-text' }).props.value).toBe('')
  expect(JSON.stringify(screen.toJSON())).toContain('Garden')
})
