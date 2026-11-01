import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ calls: [] as any[], store: new Map<string, string>() }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }))
vi.mock('../../lib/puppyUpdates', () => ({
  puppyPath: (id: string) => `/p/${id}`,
  puppyUpdates: vi.fn(async (body: any) => {
    s.calls.push(body)
    const base = [{ id: 'a', date: '2026-10-27' }, { id: 'b', date: '2026-01-02' }]
    const list = body.order === 'oldest' ? [...base].reverse() : base
    return { dog: { name: 'Ruby', breed: 'Poodle', passportId: 'PIN-1' }, role: 'public', following: false, publicEnabled: true, order: body.order, nextCursor: body.cursor ? null : 'b',
      updates: list.map(u => ({ ...u, text: `update ${u.id}`, audience: 'public', inherited: false, media: [] })) }
  }),
}))
import PuppyStoryPanel from './PuppyStoryPanel'
import { formatUpdateDate } from './PuppyUpdateFeed'
import { TIMELINE_ORDER_KEY } from '../../lib/timelineOrder'

let tree: ReactTestRenderer
const text = (n: ReactTestInstance | string): string => typeof n === 'string' ? n : n.children.map(c => text(c as any)).join('')
const button = (label: string) => tree.root.findAll(n => n.type === 'button' && text(n) === label)[0]
beforeEach(() => {
  s.calls = []; s.store.clear()
  vi.stubGlobal('localStorage', { getItem: (k: string) => s.store.get(k) ?? null, setItem: (k: string, v: string) => void s.store.set(k, v) })
})
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllGlobals() })
async function render() { await act(async () => { tree = create(createElement(MemoryRouter, null, createElement(PuppyStoryPanel, { passportId: 'PIN-1' }))) }) }

describe('public timeline sort control', () => {
  it('defaults to Newest first and requests that order', async () => {
    await render()
    expect(s.calls[0]).toMatchObject({ action: 'view', order: 'newest' })
    expect(button('Newest first').props['aria-pressed']).toBe(true)
    expect(button('Oldest first').props['aria-pressed']).toBe(false)
  })
  it('switching to Oldest first re-fetches in that order and remembers it', async () => {
    await render()
    await act(async () => { button('Oldest first').props.onClick() })
    expect(s.calls[s.calls.length - 1]).toMatchObject({ action: 'view', order: 'oldest' })
    expect(s.store.get(TIMELINE_ORDER_KEY)).toBe('oldest')
    expect(text(tree.root).indexOf('update b')).toBeLessThan(text(tree.root).indexOf('update a'))
  })
  it('a saved preference is used after reload', async () => {
    s.store.set(TIMELINE_ORDER_KEY, 'oldest')
    await render()
    expect(s.calls[0].order).toBe('oldest')
    expect(button('Oldest first').props['aria-pressed']).toBe(true)
  })
  it('ignores an invalid saved preference', async () => {
    s.store.set(TIMELINE_ORDER_KEY, 'sideways')
    await render()
    expect(s.calls[0].order).toBe('newest')
  })
  it('loading more keeps the chosen order and passes the cursor', async () => {
    s.store.set(TIMELINE_ORDER_KEY, 'oldest')
    await render()
    await act(async () => { button('Load newer updates').props.onClick() })
    expect(s.calls[s.calls.length - 1]).toMatchObject({ order: 'oldest', cursor: 'b' })
  })
  it('works when storage is unavailable (private mode)', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    await render()
    expect(s.calls[0].order).toBe('newest')
    await act(async () => { button('Oldest first').props.onClick() })
    expect(s.calls[s.calls.length - 1].order).toBe('oldest')
  })
})

describe('formatUpdateDate', () => {
  it('renders calendar dates without time-zone shift and handles bad values', () => {
    expect(formatUpdateDate('2026-01-01')).toMatch(/1 Jan 2026/)
    expect(formatUpdateDate('nope')).toBe('Date not set')
    expect(formatUpdateDate(undefined)).toBe('Date not set')
  })
})
