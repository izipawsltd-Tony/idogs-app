import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ user: { getIdToken: async () => 'synthetic-token' }, profile: { role: 'breeder', plan: 'free' } as any, refreshProfile: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, profile: fixture.profile, refreshProfile: fixture.refreshProfile }) }))
vi.mock('../lib/nativePlatform', () => ({ isNativeApp: () => false }))
import BillingPage from './BillingPage'
import { PLUS_PROMOTION_END, PLUS_PROMOTION_ID } from '../../shared/plus-promotion.js'

let page: ReactTestRenderer
const requests = vi.fn()
const location = { href: '' }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T01:00:00Z'))
  fixture.profile = { role: 'breeder', plan: 'free' }; location.href = ''
  requests.mockReset().mockImplementation(async (url: string) => ({ ok: true, json: async () => url === '/api/billing-summary'
    ? { entitlement: { plan: 'free' }, canManageBilling: false, invoices: [], sms: { status: 'inactive' } }
    : { url: 'https://checkout.stripe.com/synthetic-session' } }))
  vi.stubGlobal('fetch', requests)
  vi.stubGlobal('window', { location, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => { if (page) act(() => page.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })
async function render() {
  await act(async () => { page = create(createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, createElement(BillingPage, { toast: vi.fn() }))) })
}
const offerButton = () => page.root.findAllByType('button').find(node => node.children.includes('Get Plus for A$0'))!

it('shows original/offer price, requires consent, then submits the exact monthly offer and redirects to mocked Checkout', async () => {
  await render()
  expect(page.root.findByType('del').children).toEqual(['A$7'])
  expect(offerButton().props.disabled).toBe(true)
  expect(requests.mock.calls.filter(([url]) => url === '/api/create-checkout')).toHaveLength(0)
  await act(async () => page.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
  expect(offerButton().props.disabled).toBe(false)
  await act(async () => offerButton().props.onClick())
  const checkout = requests.mock.calls.find(([url]) => url === '/api/create-checkout')!
  expect(JSON.parse(checkout[1].body)).toEqual({ plan: 'plus_monthly', promotion: PLUS_PROMOTION_ID, acceptPromotionTerms: true })
  expect(location.href).toBe('https://checkout.stripe.com/synthetic-session')
})
it('keeps checkout disabled when secure Billing cannot load', async () => {
  requests.mockRejectedValue(new Error('synthetic offline'))
  await render()
  await act(async () => page.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
  expect(offerButton().props.disabled).toBe(true)
})
it('refreshes an open page after campaign expiry and removes the A$0 CTA', async () => {
  vi.setSystemTime(PLUS_PROMOTION_END - 10_000)
  await render(); expect(offerButton()).toBeDefined()
  await act(async () => { vi.advanceTimersByTime(30_000) })
  expect(offerButton()).toBeUndefined()
  expect(page.root.findAllByType('del')).toHaveLength(0)
})
