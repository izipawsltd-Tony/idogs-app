import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ platform: 'ios' as 'ios' | 'android', user: { getIdToken: async () => 't' }, profile: { role: 'breeder', plan: 'free' } as any, refreshProfile: async () => undefined }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, profile: fixture.profile, refreshProfile: fixture.refreshProfile }) }))
vi.mock('../lib/nativePlatform', () => ({ isNativeApp: () => true, isAndroidNativeApp: () => fixture.platform === 'android' }))
import BillingPage from './BillingPage'

let page: ReactTestRenderer
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T01:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ entitlement: { plan: 'free' }, canManageBilling: false, invoices: [], sms: { status: 'inactive' } }) })))
  vi.stubGlobal('window', { location: { href: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => { if (page) act(() => page.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })
async function render() {
  await act(async () => { page = create(createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, createElement(BillingPage, { toast: vi.fn() }))) })
}
const allText = () => page.root.findAll(() => true).flatMap(n => n.children.filter(c => typeof c === 'string')).join(' ')

// App Store Guideline 3.1.1/3.1.3 (RC9): no digital-subscription prices, offers,
// renewal terms or purchase calls to action in any native app.
for (const platform of ['ios', 'android'] as const) {
  it(`${platform}: shows current plan and plan features, no prices, offer, renewal terms or purchase controls`, async () => {
    fixture.platform = platform
    await render()
    const t = allText()
    expect(t).toContain('Current plan')
    expect(t).toContain('Up to 5 dogs')
    expect(t).toContain('10 iDogs Document Scans / month')
    for (const banned of ['A$0', 'A$7', '$7', 'A$39', '31 January 2027', 'Renews automatically', 'Payment details required', 'MOST POPULAR', 'Get Plus', 'Upgrade to Plus', 'Stripe']) expect(t).not.toContain(banned)
    expect(page.root.findAllByType('del')).toHaveLength(0)
    expect(page.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0)
    expect(page.root.findAllByType('button').map(b => JSON.stringify(b.children)).some(b => /Monthly|Annual|Manage subscription|Upgrade/.test(b))).toBe(false)
    expect(t).toContain('Purchases are unavailable in this app.')
  })
}
