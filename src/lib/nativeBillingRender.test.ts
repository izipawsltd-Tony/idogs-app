import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillingPage from '../pages/BillingPage'

vi.mock('../hooks/useAuth', () => { const auth = {
  user: { getIdToken: async () => 'synthetic-token' },
  profile: { plan: 'free', role: 'breeder' },
  refreshProfile: async () => {},
}; return { useAuth: () => auth } })

afterEach(() => vi.unstubAllGlobals())

describe('rendered native Billing with unpaid invoice', () => {
  it.each(['ios', 'android', 'web'])('gates payment links on %s while keeping history', async platform => {
    vi.stubGlobal('document', {
      documentElement: { dataset: { idogsNativePlatform: platform } },
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      subscription: { cancelAtPeriodEnd: false, currentPeriodEnd: null },
      canManageBilling: true,
      entitlement: { plan: 'free' },
      sms: { configured: true, status: 'inactive', creditsUsed: 0, creditsLimit: 0 },
      invoices: [{ id: 'qa-invoice', number: 'QA-UNPAID', status: 'open', amountPaid: 0,
        amountDue: 700, currency: 'AUD', createdAt: null,
        hostedInvoiceUrl: 'https://invoice.stripe.com/qa-unpaid',
        invoicePdf: 'https://pay.stripe.com/qa-invoice.pdf' }],
    })))
    vi.stubGlobal('fetch', fetchMock)
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(MemoryRouter, null,
        createElement(BillingPage, { toast: vi.fn() })))
    })
    const links = renderer.root.findAllByType('a').map(a => a.props.href)
    const buttons = renderer.root.findAllByType('button').map(b => b.children.join(' ')).join(' ')
    expect(JSON.stringify(renderer.toJSON())).toContain('QA-UNPAID')
    if (platform === 'web') {
      expect(links).toContain('https://invoice.stripe.com/qa-unpaid')
      expect(buttons).toContain('Manage subscription')
    } else {
      expect(links).toEqual([])
      expect(buttons).not.toMatch(/Manage subscription|Subscribe|Add SMS/)
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/billing-summary')
    act(() => renderer.unmount())
  })
})
