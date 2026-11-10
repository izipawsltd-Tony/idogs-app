import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, ReactTestRenderer } from 'react-test-renderer'
import SuperAdminAiCeoPage from './SuperAdminAiCeoPage'

const user = vi.hoisted(() => ({ getIdToken: vi.fn(async () => 'test-token') }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user }) }))

function fixture(status = 'PARTIAL') {
  return {
    generatedAt: new Date().toISOString(), osVersion: 'test',
    operatingMode: { name: 'READ_ONLY', description: '', stripeReadOnlyVerification: true },
    objective: { northStar: 'Operate iDogs' }, brief: { status: 'PARTIAL', summary: 'Unverified headline must be hidden', priorityDecisionId: '' },
    evidence: { freshness: 'FRESH', revenue: { status: status === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED', verifiedCustomerMrrAud: status === 'VERIFIED' ? 0 : null }, limitations: [] },
    customerRevenueTruth: { status, verifiedCustomerMrrAud: 0, failedSubscriptionProfiles: 1, failedRevenueAccounts: [] },
    revenueTruth: { status, canonicalPrices: { monthly: null, annual: null }, canonicalPriceStatus: {}, observedLivePrices: [] },
    accountClassification: { status: 'PARTIAL', realCustomer: 0, accounts: [] },
    facts: { puppyFunnel: {} }, decisions: [], actionPlan7d: [], measurementContract: { events: [] },
    watchItems: [], approvalPolicy: { auto: [], approvalRequired: [] }, sourceNotes: {},
  }
}

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  if (renderer) act(() => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount(payload = fixture()) {
  vi.stubGlobal('window', { setInterval, clearInterval })
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }))
  vi.stubGlobal('fetch', fetchMock)
  await act(async () => { renderer = create(createElement(SuperAdminAiCeoPage)) })
  return fetchMock
}
const rendered = () => JSON.stringify(renderer?.toJSON())

describe('Control Center evidence and health UI', () => {
  it('shows acquisition counts with exclusions and missing-measurement caveats', async () => {
    await mount({ ...fixture(), growthSnapshot: {
      windowDays: 30, eligibleSignups: 2, confirmedCustomers: 1, likelyReal: 1,
      excludedInternalQa: 3, unclassified: 4, invalidCreatedAt: 1,
      channels: { meta: 1, unknown: 1 }, basis: 'Observed signup profiles only',
      limitations: ['Visitor denominator is not connected.'],
    } } as any)
    expect(rendered()).toContain('Signup sources')
    expect(rendered()).toContain('Visitor denominator is not connected.')
    expect(rendered()).toContain('profile(s) have missing, invalid or future signup dates')
  })
  it('shows incomplete evidence and suppresses an unverified revenue brief', async () => {
    const request = await mount()
    expect(rendered()).toContain('Unverified')
    expect(rendered()).toContain('Missing or failed billing reads')
    expect(rendered()).not.toContain('Unverified headline must be hidden')
    expect(request.mock.calls[0]).toEqual(['/api/super-admin/ai-ceo', expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })])
  })
  it('ages fresh verified revenue out without a reload', async () => {
    vi.useFakeTimers()
    await mount(fixture('VERIFIED'))
    expect(rendered()).toContain('Current snapshot')
    await act(async () => { vi.advanceTimersByTime(330000) })
    expect(rendered()).toContain('Refresh required')
    expect(rendered()).toContain('Unverified')
  })
  it('checks health only on demand using the authenticated endpoint', async () => {
    const request = await mount()
    expect(request).toHaveBeenCalledTimes(1)
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ checkedAt: new Date().toISOString(), status: 'PASS', checks: [{ id: 'website', status: 'PASS', latencyMs: 40, reason: 'HTML_REACHABLE' }] }) } as any)
    const button = renderer!.root.findAllByType('button').find(item => item.children.includes('Check website now'))!
    await act(async () => { await button.props.onClick() })
    expect(request.mock.calls[1]).toEqual(['/api/super-admin/site-health', expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })])
    expect(rendered()).toContain('Public pages reachable')
  })
})
