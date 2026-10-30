import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PuppyMediaViewer, { type StoryMedia } from './PuppyMediaViewer'

const items: StoryMedia[] = [
  { key: 'first', id: 'one', kind: 'photo', url: '/one.jpg', caption: 'First adventure' },
  { key: 'second', id: 'two', kind: 'video', url: '/movie.mp4', caption: '' },
  { key: 'third', id: 'three', kind: 'photo', url: '/three.jpg', caption: 'A little memory' },
]
let screen: ReactTestRenderer
let listeners: Map<string, (event: unknown) => void>
const close = vi.fn(), previousFocus = vi.fn()
beforeEach(() => {
  close.mockReset(); previousFocus.mockReset(); listeners = new Map()
  vi.stubGlobal('document', { body: { style: { overflow: 'scroll' } }, activeElement: { focus: previousFocus }, querySelectorAll: () => [], addEventListener: (key: string, fn: (event: unknown) => void) => listeners.set(key, fn), removeEventListener: (key: string) => listeners.delete(key) })
})
afterEach(async () => { await act(async () => { screen?.unmount() }); vi.unstubAllGlobals() })
async function render() { await act(async () => { screen = create(createElement(PuppyMediaViewer, { items, initialKey: 'first', close })) }) }
const counter = () => screen.root.findByProps({ role: 'status' }).children.join('')
const stage = () => screen.root.findAllByType('div').find(node => node.props.onTouchStart)!
it('browses photos and videos in both directions without leaving the page', async () => {
  await render()
  await act(async () => { screen.root.findByProps({ 'aria-label': 'Next photo or video' }).props.onClick() })
  expect(counter()).toBe('2 / 3'); expect(screen.root.findByType('video').props.src).toBe('/movie.mp4')
  await act(async () => { screen.root.findByProps({ 'aria-label': 'Previous photo or video' }).props.onClick() })
  expect(counter()).toBe('1 / 3'); expect(screen.root.findByType('img').props.src).toBe('/one.jpg')
})
it('handles horizontal swipes and ignores vertical scrolling and native video controls', async () => {
  await render()
  await act(async () => {
    stage().props.onTouchStart({ touches: [{ clientX: 200, clientY: 100 }], target: { tagName: 'IMG' } })
    stage().props.onTouchEnd({ changedTouches: [{ clientX: 20, clientY: 110 }] })
  })
  expect(counter()).toBe('2 / 3')
  await act(async () => {
    stage().props.onTouchStart({ touches: [{ clientX: 200, clientY: 190 }], target: { tagName: 'VIDEO', getBoundingClientRect: () => ({ bottom: 200 }) } })
    stage().props.onTouchEnd({ changedTouches: [{ clientX: 20, clientY: 190 }] })
  })
  expect(counter()).toBe('2 / 3')
  await act(async () => {
    stage().props.onTouchStart({ touches: [{ clientX: 100, clientY: 100 }], target: { tagName: 'IMG' } })
    stage().props.onTouchEnd({ changedTouches: [{ clientX: 90, clientY: 350 }] })
  })
  expect(counter()).toBe('2 / 3')
})
it('supports arrow keys/Escape and restores the background scroll/focus on close', async () => {
  await render()
  expect(document.body.style.overflow).toBe('hidden')
  await act(async () => { listeners.get('keydown')!({ key: 'ArrowLeft', target: { tagName: 'BUTTON' }, preventDefault: () => {} }) })
  expect(counter()).toBe('3 / 3')
  await act(async () => { listeners.get('keydown')!({ key: 'Escape' }) })
  expect(close).toHaveBeenCalledTimes(1)
  await act(async () => { screen.unmount() })
  expect(document.body.style.overflow).toBe('scroll'); expect(previousFocus).toHaveBeenCalled()
})
