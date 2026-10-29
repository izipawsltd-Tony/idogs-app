import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ signup: vi.fn(), track: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ signup: state.signup }) }))
vi.mock('../lib/metaPixel', () => ({ trackCompletedRegistration: state.track }))
import SignupPage from './SignupPage'

beforeEach(() => { state.signup.mockReset().mockResolvedValue(undefined); state.track.mockReset() })
describe('signup conversion outcome', () => {
  async function submit(succeed: boolean) {
    if (!succeed) state.signup.mockRejectedValue(new Error('email-already-in-use'))
    const view = create(createElement(MemoryRouter, null, createElement(SignupPage, { toast: vi.fn() })))
    await act(async () => {
      for (const input of view.root.findAllByType('input').filter(input => input.props.type === 'password')) input.props.onChange({ target: { value: 'synthetic-only-password' } })
      for (const input of view.root.findAllByType('input').filter(input => input.props.autoComplete === 'name' || input.props.type === 'email')) input.props.onChange({ target: { value: input.props.type === 'email' ? 'qa@example.invalid' : 'QA Customer' } })
      const checkboxes = view.root.findAllByType('input').filter(input => input.props.type === 'checkbox')
      checkboxes[checkboxes.length - 1].props.onChange({ target: { checked: true } })
    })
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    view.unmount()
  }
  it('records registration only after signup succeeds', async () => {
    await submit(true)
    expect(state.signup).toHaveBeenCalledTimes(1)
    expect(state.track).toHaveBeenCalledTimes(1)
    expect(state.track.mock.invocationCallOrder[0]).toBeGreaterThan(state.signup.mock.invocationCallOrder[0])
  })
  it('does not record a conversion when signup fails', async () => {
    await submit(false)
    expect(state.signup).toHaveBeenCalledTimes(1)
    expect(state.track).not.toHaveBeenCalled()
  })
})
