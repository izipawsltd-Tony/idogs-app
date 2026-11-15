import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ consent: null as null | 'granted' | 'denied', set: vi.fn(), track: vi.fn(), suspend: vi.fn(), marketing: true }))
vi.mock('../lib/metaPixel', () => ({
  isMarketingWebsitePage: () => s.marketing,
  readMetaConsent: () => s.consent,
  setMetaConsent: (v: 'granted' | 'denied') => { s.set(v); s.consent = v },
  trackMarketingPage: s.track,
  suspendMetaTracking: s.suspend,
}))
import MarketingMeasurement, { pillBottomOffset } from './MarketingMeasurement'

let tree: ReactTestRenderer
const listeners: Record<string, ((e: any) => void)[]> = {}
const text = (n: ReactTestInstance | string): string => typeof n === 'string' ? n : n.children.map(c => text(c as any)).join('')
const button = (label: string) => tree.root.findAll(n => n.type === 'button' && text(n).includes(label))[0]
beforeEach(() => {
  s.consent = null; s.marketing = true; s.set.mockReset(); s.track.mockReset(); s.suspend.mockReset()
  for (const k of Object.keys(listeners)) delete listeners[k]
  vi.stubGlobal('window', {
    innerHeight: 800, setTimeout: (fn: () => void) => { fn(); return 1 }, clearTimeout: () => {},
    addEventListener: (t: string, fn: any) => { (listeners[t] ||= []).push(fn) }, removeEventListener: () => {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  })
  vi.stubGlobal('document', { querySelectorAll: () => [] })
})
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllGlobals() })
async function render() { await act(async () => { tree = create(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(MarketingMeasurement)), { createNodeMock: () => ({ focus() {}, querySelector: () => ({ focus() {} }) }) }) }) }

describe('Ad privacy choices (mobile CTA-safe)', () => {
  it('first visit shows ONLY the compact pill, no consent box', async () => {
    await render()
    expect(button('Ad privacy choices')).toBeTruthy()
    expect(tree.root.findAll(n => n.props.role === 'dialog')).toHaveLength(0)
  })
  it('does not record consent or change tracking until the visitor chooses', async () => {
    await render()
    expect(s.set).not.toHaveBeenCalled()
    expect(s.consent).toBeNull()
  })
  it('pill opens an accessible dialog with Decline and Allow', async () => {
    await render()
    await act(async () => { button('Ad privacy choices').props.onClick() })
    const dialog = tree.root.findByProps({ role: 'dialog' })
    expect(dialog.props['aria-modal']).toBe('true')
    expect(dialog.props['aria-labelledby']).toBe('ad-privacy-title')
    expect(text(dialog)).toContain('Not set — off until you allow it')
    expect(button('Decline')).toBeTruthy(); expect(button('Allow ad measurement')).toBeTruthy()
  })
  it('Allow stores granted, closes the dialog and keeps the pill', async () => {
    await render()
    await act(async () => { button('Ad privacy choices').props.onClick() })
    await act(async () => { button('Allow ad measurement').props.onClick() })
    expect(s.set).toHaveBeenCalledWith('granted')
    expect(tree.root.findAll(n => n.props.role === 'dialog')).toHaveLength(0)
    expect(button('Ad privacy choices')).toBeTruthy()
  })
  it('Decline stores denied; withdrawal after Allow works', async () => {
    s.consent = 'granted'
    await render()
    await act(async () => { button('Ad privacy choices').props.onClick() })
    expect(text(tree.root.findByProps({ role: 'dialog' }))).toContain('Ad measurement allowed')
    await act(async () => { button('Decline').props.onClick() })
    expect(s.set).toHaveBeenCalledWith('denied')
  })
  it('Escape and the backdrop close without changing consent', async () => {
    await render()
    await act(async () => { button('Ad privacy choices').props.onClick() })
    await act(async () => { listeners.keydown[listeners.keydown.length - 1]({ key: 'Escape' }) })
    expect(tree.root.findAll(n => n.props.role === 'dialog')).toHaveLength(0)
    await act(async () => { button('Ad privacy choices').props.onClick() })
    await act(async () => { tree.root.findByProps({ 'data-testid': 'ad-privacy-backdrop' }).props.onClick() })
    expect(tree.root.findAll(n => n.props.role === 'dialog')).toHaveLength(0)
    expect(s.set).not.toHaveBeenCalled()
  })
  it('renders nothing outside marketing pages (app, native)', async () => {
    s.marketing = false
    await render()
    expect(tree.toJSON()).toBeNull()
  })
})

describe('pillBottomOffset', () => {
  const doc = (els: any[]) => ({ querySelectorAll: () => els }) as any
  const win = (h: number, display = 'block') => ({ innerHeight: h, getComputedStyle: () => ({ display, visibility: 'visible' }) }) as any
  it('sits above a visible sticky CTA bar', () => {
    expect(pillBottomOffset(doc([{ getBoundingClientRect: () => ({ top: 728, height: 72 }) }]), win(800))).toBe(72)
  })
  it('ignores hidden or off-screen bars (desktop)', () => {
    expect(pillBottomOffset(doc([{ getBoundingClientRect: () => ({ top: 728, height: 72 }) }]), win(800, 'none'))).toBe(0)
    expect(pillBottomOffset(doc([{ getBoundingClientRect: () => ({ top: 900, height: 72 }) }]), win(800))).toBe(0)
  })
})
