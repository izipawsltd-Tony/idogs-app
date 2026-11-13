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

async function mount(payload = fixture(), enabled = false) {
  vi.stubGlobal('window', { setInterval, clearInterval })
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/super-admin/assistant' ? { enabled } : payload }))
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
  it('ages verified revenue and signup metrics out without a reload', async () => {
    vi.useFakeTimers()
    await mount({ ...fixture('VERIFIED'), growthSnapshot: {
      windowDays: 30, eligibleSignups: 1, confirmedCustomers: 1, likelyReal: 0,
      excludedInternalQa: 0, unclassified: 0, invalidCreatedAt: 0,
      channels: { direct: 1 }, basis: '', limitations: [],
      accountsWithDogBeforeActiveLitter: 1, accountsWithVerifiedActiveSubscription: 1,
    } } as any)
    expect(rendered()).toContain('Current snapshot')
    expect(rendered()).toContain('before their earliest currently active litter')
    expect(rendered()).toContain('Current active live subscriptions')
    await act(async () => { vi.advanceTimersByTime(330000) })
    expect(rendered()).toContain('Refresh required')
    expect(rendered()).toContain('Unverified')
    expect(rendered()).toContain('Refresh operating evidence to see current signup and activation counts.')
    expect(rendered()).not.toContain('Current active live subscriptions')
  })
  it('checks health only on demand using the authenticated endpoint', async () => {
    const request = await mount()
    expect(request).toHaveBeenCalledTimes(2)
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ checkedAt: new Date().toISOString(), status: 'PASS', checks: [{ id: 'website', status: 'PASS', latencyMs: 40, reason: 'HTML_REACHABLE' }] }) } as any)
    const button = renderer!.root.findAllByType('button').find(item => item.children.includes('Check website now'))!
    await act(async () => { await button.props.onClick() })
    expect(request.mock.calls[2]).toEqual(['/api/super-admin/site-health', expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })])
    expect(rendered()).toContain('Public pages reachable')
  })
  it('keeps analysis disabled when runtime configuration is unavailable', async () => {
    await mount()
    expect(rendered()).toContain('AI analysis is not enabled in this environment')
    const button = renderer!.root.findAllByType('button').find(item => item.children.includes('Analyse'))!
    expect(button.props.disabled).toBe(true)
  })
  it('does not label partial billing as a verified customer baseline even if allocation is complete', async () => {
    const payload = fixture('VERIFIED')
    payload.evidence.revenue.status = 'UNVERIFIED'
    payload.evidence.revenue.verifiedCustomerMrrAud = null
    await mount(payload)
    expect(rendered()).toContain('CUSTOMER REVENUE NEEDS VERIFICATION')
    expect(rendered()).toContain('Customer allocation alone cannot verify business revenue')
    expect(rendered()).not.toContain('Unverified headline must be hidden')
  })
  it('sends only the question and renders model output as plain text', async () => {
    const request = await mount(fixture(), true)
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ answer: '<script>example</script> Review revenue evidence.' }) } as any)
    await act(async () => { renderer!.root.findByType('textarea').props.onChange({ target: { value: 'What should I prioritise?' } }) })
    await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(request.mock.calls[2]).toEqual(['/api/super-admin/assistant', expect.objectContaining({ method: 'POST', body: JSON.stringify({ question: 'What should I prioritise?' }), headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' } })])
    expect(rendered()).toContain('<script>example</script> Review revenue evidence.')
    expect(renderer!.root.findAllByType('script')).toHaveLength(0)
  })
  it('keeps a limited answer visible and labels it incomplete instead of showing a generic failure', async () => {
    const request = await mount(fixture(), true)
    request.mockResolvedValueOnce({ ok: true, json: async () => ({
      answer: '1. Verify revenue evidence.', truncated: true,
      evidenceGeneratedAt: new Date(Date.now() - 360000).toISOString(),
    }) } as any)
    await act(async () => { renderer!.root.findByType('textarea').props.onChange({ target: { value: 'What should I prioritise?' } }) })
    await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(rendered()).toContain('1. Verify revenue evidence.')
    expect(rendered()).toContain('Evidence as of')
    expect(rendered()).toContain('Ask again for analysis using fresh evidence.')
    expect(rendered()).toContain('may be incomplete')
    expect(rendered()).not.toContain('Analysis unavailable')
    expect(request).toHaveBeenCalledTimes(3)
  })
  it.each([
    ['STAGING', 'Scope: staging evidence from this preview'],
    [undefined, 'Scope: evidence environment unknown'],
    ['production', 'Scope: evidence environment unknown'],
  ])('labels the answer scope deterministically for %s evidence', async (evidenceScope, label) => {
    const request = await mount(fixture(), true)
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ answer: '1. Check billing evidence.', evidenceScope, evidenceGeneratedAt: new Date().toISOString() }) } as any)
    await act(async () => { renderer!.root.findByType('textarea').props.onChange({ target: { value: 'Priorities?' } }) })
    await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(rendered()).toContain(label)
  })
  it('omits the scope caveat only for server-confirmed production evidence', async () => {
    const request = await mount(fixture(), true)
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ answer: '1. Check billing evidence.', evidenceScope: 'PRODUCTION', evidenceGeneratedAt: new Date().toISOString() }) } as any)
    await act(async () => { renderer!.root.findByType('textarea').props.onChange({ target: { value: 'Priorities?' } }) })
    await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    expect(rendered()).toContain('1. Check billing evidence.')
    expect(rendered()).not.toContain('Scope:')
  })
})
