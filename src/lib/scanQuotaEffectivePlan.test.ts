import { createElement } from 'react'
import { create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ profile: {} as any }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { getIdToken: async () => 't' }, profile: fixture.profile }) }))
import AIScan from '../components/ui/AIScan'

const text = () => JSON.stringify(create(createElement(AIScan, { onResult: vi.fn(), toast: vi.fn() })).toJSON())

describe('remaining-scans line uses the same effective plan as /api/scan', () => {
  it('included access (internal entitlement) counts as Plus, not Free', () => {
    fixture.profile = { plan: 'free', internalEntitlement: { granted: true, expiresAt: null }, plusScansUsed: 3 }
    expect(text()).toContain('7 of 10 iDogs Scans left this month')
    expect(text()).not.toContain('free iDogs Scans left')
  })
  it('paid Plus shows the monthly allowance', () => {
    fixture.profile = { plan: 'plus', plusScansUsed: 10 }
    expect(text()).toContain("You've used all 10 iDogs Scans for this billing period")
  })
  it('plain Free still shows the one-time allowance', () => {
    fixture.profile = { plan: 'free', freeScansUsed: 1 }
    expect(text()).toContain('1 of 2 free iDogs Scans left (one-time)')
  })
})
