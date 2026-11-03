import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it } from 'vitest'
import { useToast } from './useToast'
it('never stacks the same message twice', () => {
  let api: ReturnType<typeof useToast> | null = null
  function C() { api = useToast(); return null }
  act(() => { create(createElement(C)) })
  act(() => { api!.toast('Could not send', 'error'); api!.toast('Could not send', 'error'); api!.toast('Other', 'error') })
  expect(api!.toasts.map(t => t.message)).toEqual(['Could not send', 'Other'])
})
