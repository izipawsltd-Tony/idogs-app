import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const signup = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ signup }) }))
import SignupPage from '../pages/SignupPage'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

async function submitFrom(url: string, pick?: 'Pet owner' | 'Breeder') {
  signup.mockClear()
  let r!: ReturnType<typeof create>
  await act(async () => { r = create(createElement(MemoryRouter, { initialEntries: [url] }, createElement(SignupPage, { toast: vi.fn() }))) })
  const byText = (t: string) => r.root.findAll(n => n.type === 'button' && n.children.join('') === t)[0]
  if (pick) await act(async () => byText(pick).props.onClick())
  const inputs = r.root.findAllByType('input')
  await act(async () => {
    inputs.find(i => i.props.autoComplete === 'nickname')!.props.onChange({ target: { value: 'Sam' } })
    inputs.find(i => i.props.type === 'email')!.props.onChange({ target: { value: 'sam@example.com' } })
    inputs.find(i => i.props.autoComplete === 'new-password')!.props.onChange({ target: { value: 'longenough1' } })
    inputs.find(i => i.props.type === 'checkbox')!.props.onChange({ target: { checked: true } })
  })
  await act(async () => { await r.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  const pressed = r.root.findAll(n => n.type === 'button' && n.props['aria-pressed'] === true).map(n => n.children.join(''))
  act(() => r.unmount())
  return { role: signup.mock.calls[0]?.[0]?.role, pressed }
}

describe('B2 — Owner/Breeder intent survives into sign-up', () => {
  it('landing CTAs carry their role', () => {
    const landing = read('../pages/LandingPage.tsx')
    expect(landing).toContain('to="/signup?role=owner">Start Free as a Dog Owner')
    expect(landing).toContain('to="/signup?role=breeder">Start Free as a Breeder')
  })
  it('breeder CTA preselects Breeder and saves role breeder', async () => {
    const out = await submitFrom('/signup?role=breeder')
    expect(out.pressed).toContain('Breeder'); expect(out.role).toBe('breeder')
  })
  it('generic /signup defaults to Pet owner; the choice stays editable', async () => {
    expect((await submitFrom('/signup')).role).toBe('owner')
    expect((await submitFrom('/signup?role=owner', 'Breeder')).role).toBe('breeder')
    expect((await submitFrom('/signup?role=bogus')).role).toBe('owner')
  })
})

describe('B1 — Documents is one tap away on mobile', () => {
  const layout = read('../components/layout/AppLayout.tsx')
  it('bottom nav lists Documents and keeps at most five destinations', () => {
    const block = layout.slice(layout.indexOf('const BOTTOM_NAV_ITEMS'), layout.indexOf(']', layout.indexOf('const BOTTOM_NAV_ITEMS')))
    expect(block).toContain("path: '/app/documents'")
    expect(layout).toContain("if ((item as any).documentsItem && hideDocuments) return false")
    expect(layout).toContain("if ((item as any).activityItem && !hideDocuments) return false")
  })
  it('Activity stays reachable from Home', () => {
    expect(read('../pages/DashboardPage.tsx')).toContain('viewAllTo="/app/audit"')
  })
})

describe('B3 — Scan tab is never blank for a non-current owner', () => {
  const page = read('../pages/DogDetailPage.tsx')
  it('explains current-owner access with a way back, without granting scan', () => {
    expect(page).toContain("{tab === 'scan' && !historicalSnapshot && !isCurrentOwner(dog, user?.uid || '') && (")
    expect(page).toContain('iDogs Scan is for the current owner')
    expect(page).toContain("onClick={() => setTab('overview')}>Back to overview")
    expect(page).toContain("{tab === 'scan' && !historicalSnapshot && isCurrentOwner(dog, user?.uid || '') && (")
  })
})
