import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ user: { getIdToken: async () => 'synthetic-token' }, profile: { role: 'breeder', plan: 'free' } as any, refreshProfile: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, profile: fixture.profile, refreshProfile: fixture.refreshProfile }) }))
vi.mock('../lib/nativePlatform', () => ({ isNativeApp: () => false, isAndroidNativeApp: () => false }))
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

it('shows offer price and renewal terms, requires consent, then submits the exact monthly offer and redirects to mocked Checkout', async () => {
  await render()
  const promotion = page.root.findByProps({ 'aria-label': 'Plus A$0 offer' })
  const displayedOffer = promotion.findAll(() => true).flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ')
  expect(displayedOffer).toContain('A$0')
  expect(displayedOffer).toContain('31 January 2027')
  expect(displayedOffer).toContain('A$7/month')
  expect(displayedOffer).toContain('1 February 2027')
  expect(displayedOffer).toContain('Payment details required')
  expect(displayedOffer).toContain('Renews automatically unless cancelled')
  expect(displayedOffer).toContain('SMS and extra litters are not included')
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
