import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PrivacyPage from '../pages/PrivacyPage'
import TermsPage from '../pages/TermsPage'

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }))
afterEach(() => { vi.unstubAllGlobals() })

function render(Page: () => JSX.Element, native: boolean) {
  vi.stubGlobal('document', { documentElement: { hasAttribute: (n: string) => native && n === 'data-idogs-native-platform' } })
  const r = create(createElement(MemoryRouter, { initialEntries: ['/app/settings', '/privacy'], initialIndex: 1 }, createElement(Page)))
  const out = JSON.stringify(r.toJSON())
  act(() => r.unmount())
  return out
}

describe('Privacy / Terms can be left inside the app', () => {
  for (const [name, Page] of [['Privacy', PrivacyPage], ['Terms', TermsPage]] as const) {
    it(`${name}: native shows a Back button under the status bar and no sign-up CTA`, () => {
      const out = render(Page, true)
      expect(out).toContain('"aria-label":"Back"')
      expect(out).toContain('safe-area-top')
      expect(out).not.toContain('Start free')
    })
    it(`${name}: website keeps the logo link; signed-in users get Open iDogs`, () => {
      const out = render(Page, false)
      expect(out).not.toContain('"aria-label":"Back"')
      expect(out).toContain('Open iDogs')
    })
  }
})
