import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { UserProfile } from '../types'
import SettingsPage from '../pages/SettingsPage'
import BillingPage from '../pages/BillingPage'

const qa = vi.hoisted(() => ({
  user: { uid: 'qa-only', getIdToken: async () => 'synthetic' },
  profile: null as UserProfile | null,
  refreshProfile: async () => {},
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => qa }))
vi.mock('./db', () => ({ updateUserProfile: vi.fn() }))
vi.mock('./firebase', () => ({ db: {} }))

afterEach(() => vi.unstubAllGlobals())

function environment(platform = 'ios') {
  vi.stubGlobal('document', {
    documentElement: { dataset: { idogsNativePlatform: platform, idogsNativeApi: 'production' } },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
}

async function renderSettings(profile: Partial<UserProfile> | null) {
  qa.profile = profile as UserProfile | null
  let renderer!: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(MemoryRouter, { initialEntries: ['/app/settings'] },
      createElement(Routes, null,
        createElement(Route, { path: '/app/settings', element: createElement(SettingsPage, { toast: vi.fn() }) }),
        createElement(Route, { path: '/app/billing', element: createElement(BillingPage, { toast: vi.fn() }) }),
      )))
  })
  return renderer
}

describe('Settings current plan on native iOS', () => {
  it.each([
    { profile: { plan: 'free' }, label: 'Free', limit: 'Up to 2 dogs' },
    { profile: { plan: 'plus' }, label: 'Plus', limit: 'Up to 5 dogs' },
    { profile: { plan: 'kennel', internalEntitlement: { granted: true } }, label: 'Plus', limit: 'Unlimited dogs' },
    { profile: { plan: 'kennel', internalEntitlement: { granted: true, expiresAt: '2000-01-01' } }, label: 'Free', limit: 'Up to 2 dogs' },
  ])('shows effective $label rights without purchase UI', async ({ profile, label, limit }) => {
    environment()
    const renderer = await renderSettings(profile as Partial<UserProfile>)
    const card = renderer.root.findByProps({ 'aria-labelledby': 'current-plan-heading' })
    const json = JSON.stringify(card.children.map(child => typeof child === 'string' ? child : child.props.children))
    expect(json).toContain(label)
    expect(json).toContain(limit)
    expect(json).toContain('Purchases are unavailable in this app.')
    expect(json).not.toMatch(/kennel|Subscribe|Upgrade|Stripe/)
    const link = card.findByType('a')
    expect(link.props.href).toBe('/app/billing')
    act(() => renderer.unmount())
  })

  it('does not turn an unavailable profile into a confirmed Free plan', async () => {
    environment()
    const renderer = await renderSettings(null)
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('temporarily unavailable')
    act(() => renderer.unmount())
  })

  it('opens real plan details from Settings, retaining the native payment gate for included access', async () => {
    environment()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      subscription: null, invoices: [], canManageBilling: false,
      sms: { configured: false, status: 'inactive', creditsUsed: 0, creditsLimit: 0 },
    })))
    vi.stubGlobal('fetch', fetchMock)
    const renderer = await renderSettings({ plan: 'kennel', internalEntitlement: { granted: true } } as Partial<UserProfile>)
    const link = renderer.root.findByProps({ 'aria-labelledby': 'current-plan-heading' }).findByType('a')
    await act(async () => link.props.onClick({ button: 0, preventDefault() {}, defaultPrevented: false }))
    expect(renderer.root.findByType('h1').children.join('')).toBe('Billing & Plans')
    expect(JSON.stringify(renderer.toJSON())).toContain('Plus · Included access')
    expect(renderer.root.findAllByType('a')).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/billing-summary')
    act(() => renderer.unmount())
  })

  it('scopes native Billing link hiding to the compact top bar', () => {
    const css = readFileSync(new URL('../mobile-native-qa-polish.css', import.meta.url), 'utf8')
    expect(css).not.toMatch(/\]\s+a\[href=['"]\/app\/billing/)
    expect(css).toContain(".mobile-topbar a[href='/app/billing']")
  })
})
