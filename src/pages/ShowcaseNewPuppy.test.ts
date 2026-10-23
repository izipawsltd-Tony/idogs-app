import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('../lib/db', () => ({ DEFAULT_SHOWCASE_PUPPY_ENTRY: {
  visible: false, availability: 'available', colour: null, personality: null,
  readyToGoHomeDate: null, priceCents: null, depositCents: null,
  showPrice: false, showDeposit: false, publishedPhotoIds: [], publishedVideoIds: [],
} }))
import { ShowcaseManager } from './LittersPage'

afterEach(() => vi.unstubAllGlobals())
it('adding a puppy to an open Showcase preserves unsaved edits and starts the new puppy private', () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const first = { id: 'first', name: 'Existing QA', sex: 'male', status: 'active', photos: [], videos: [] }
  const second = { ...first, id: 'second', name: 'New QA' }
  const props: any = {
    litterId: 'synthetic', showcase: { id: 'synthetic', enabled: false, puppies: {} },
    busy: false, saveError: '', shareBusy: false, shareError: '',
    onToggleEnabled: vi.fn(), onSaveDraft: vi.fn(), onRotateShare: vi.fn(),
    onToggleShareEnabled: vi.fn(), toast: vi.fn(), onPuppyReconciled: vi.fn(),
  }
  const render = (puppies: any[]) => React.createElement(MemoryRouter, null,
    React.createElement(ShowcaseManager, { ...props, puppyDogs: puppies }))
  let view!: ReturnType<typeof create>
  act(() => { view = create(render([first])) })
  act(() => view.root.findByProps({ 'aria-label': 'Show Existing QA publicly' }).props.onChange({ target: { checked: true } }))
  act(() => { view.update(render([first, second])) })
  expect(view.root.findByProps({ 'aria-label': 'Show Existing QA publicly' }).props.checked).toBe(true)
  expect(view.root.findByProps({ 'aria-label': 'Show New QA publicly' }).props.checked).toBe(false)
  expect(props.onSaveDraft).not.toHaveBeenCalled()
  act(() => view.unmount())
})
