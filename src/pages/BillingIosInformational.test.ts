import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ platform: 'ios' as 'ios' | 'android', user: { getIdToken: async () => 't' }, profile: { role: 'breeder', plan: 'free' } as any, refreshProfile: async () => undefined }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, profile: fixture.profile, refreshProfile: fixture.refreshProfile }) }))
vi.mock('../lib/nativePlatform', () => ({ isNativeApp: () => true, isAndroidNativeApp: () => fixture.platform === 'android' }))
import BillingPage from './BillingPage'

let page: ReactTestRenderer
const requests = vi.fn()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T01:00:00Z'))
  fixture.profile = { role: 'breeder', plan: 'free' }
  requests.mockReset().mockImplementation(async () => ({ ok: true, json: async () => ({ entitlement: { plan: 'free' }, canManageBilling: false, invoices: [], sms: { status: 'inactive' } }) }))
  vi.stubGlobal('fetch', requests)
  vi.stubGlobal('window', { location: { href: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => { if (page) act(() => page.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })
async function render() {
  await act(async () => { page = create(createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, createElement(BillingPage, { toast: vi.fn() }))) })
}
const allText = () => page.root.findAll(() => true).flatMap(n => n.children.filter(c => typeof c === 'string')).join(' ')

it('iOS shows the website Free/Plus details and promotion for information, with no purchase controls', async () => {
  fixture.platform = 'ios'
  await render()
  const t = allText()
  for (const s of ['Up to 2 dogs', 'Permanent Dog ID & QR Passport', 'Ownership transfer', '2 free iDogs Scan — one-time',
    'Up to 5 dogs', '10 iDogs Document Scans / month', '2 litters per rolling 12 months', 'Extra litters A$39 each', 'PDF & CSV report export',
    '31 January 2027', '1 February 2027, including GST.', 'Payment details required', 'SMS and extra litters are not included']) expect(t).toContain(s)
  expect(page.root.findAllByType('del').map(d => d.children.join(''))).toEqual(['A$7'])
  expect(page.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0)
  const buttons = page.root.findAllByType('button').map(b => JSON.stringify(b.children))
  expect(buttons.some(b => /Get Plus|Upgrade to Plus|Manage subscription|Monthly|Annual/.test(b))).toBe(false)
  expect(t).toContain('Purchases are unavailable in this app.')
  expect(requests.mock.calls.filter(([u]) => u === '/api/create-checkout')).toHaveLength(0)
})

it('Android still shows no prices or promotion', async () => {
  fixture.platform = 'android'
  await render()
  const t = allText()
  expect(t).not.toContain('A$0')
  expect(page.root.findAllByType('del')).toHaveLength(0)
  expect(t).not.toContain('A$39')
})
