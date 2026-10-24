import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VerifyEmailPage from '../pages/VerifyEmailPage'

const auth = vi.hoisted(() => ({
  user: { email: 'synthetic@example.invalid', emailVerified: false } as { email: string, emailVerified: boolean } | null,
  loading: false, logout: vi.fn(), resendVerificationEmail: vi.fn(), checkEmailVerified: vi.fn(),
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }))
let renderer: ReturnType<typeof create> | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  auth.user = { email: 'synthetic@example.invalid', emailVerified: false }
})
afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers() })
async function render() {
  const toast = vi.fn()
  await act(async () => { renderer = create(createElement(MemoryRouter, { initialEntries: ['/verify-email'] }, createElement(VerifyEmailPage, { toast }))) })
  return { toast, resend: () => renderer!.root.findAllByType('button')[1], text: () => JSON.stringify(renderer!.toJSON()) }
}
describe('verification email recovery on iPhone', () => {
  it('does not claim delivery on page entry or automatically send email', async () => {
    const page = await render()
    expect(page.text()).not.toContain('We sent a verification link')
    expect(auth.resendVerificationEmail).not.toHaveBeenCalled()
  })
  it('reports an accepted request and enforces the resend cooldown', async () => {
    auth.resendVerificationEmail.mockResolvedValue(undefined)
    const page = await render()
    await act(async () => { await page.resend().props.onClick() })
    expect(page.text()).toContain('Verification email requested')
    expect(page.resend().props.disabled).toBe(true)
    await act(async () => { await page.resend().props.onClick() })
    expect(auth.resendVerificationEmail).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(60000) })
    expect(page.resend().props.disabled).toBe(false)
  })
  it.each([
    ['auth/network-request-failed', 'Check your internet connection', false],
    ['auth/too-many-requests', 'Wait a few minutes', true],
    ['auth/user-token-expired', 'Sign out and sign in again', false],
    ['auth/internal-error', 'Could not request a verification email', false],
  ])('reports %s without a success message', async (code, message, disabled) => {
    auth.resendVerificationEmail.mockRejectedValue({ code })
    const page = await render()
    await act(async () => { await page.resend().props.onClick() })
    expect(page.text()).toContain(message)
    expect(page.text()).not.toContain('Verification email requested')
    expect(page.toast).toHaveBeenLastCalledWith(expect.stringContaining(message), 'error')
    expect(page.resend().props.disabled).toBe(disabled)
  })
  it('blocks resend when signed out', async () => {
    auth.user = null
    const page = await render()
    expect(page.resend().props.disabled).toBe(true)
    await act(async () => { await page.resend().props.onClick() })
    expect(auth.resendVerificationEmail).not.toHaveBeenCalled()
  })
})
