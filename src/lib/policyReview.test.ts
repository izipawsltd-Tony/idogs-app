import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PrivacyPage from '../pages/PrivacyPage'
import TermsPage from '../pages/TermsPage'
import AccountDeletion from '../components/ui/AccountDeletion'
import { act, create } from 'react-test-renderer'
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { getIdToken: async () => 'synthetic' } }) }))

const pageText = (page: typeof PrivacyPage) => {
  const renderer = create(createElement(MemoryRouter, {}, createElement(page)))
  const text = JSON.stringify(renderer.toJSON())
  act(() => renderer.unmount())
  return text
}
describe('unpublished legal policy review', () => {
  it.each([['Privacy', PrivacyPage], ['Terms', TermsPage]] as const)('%s clearly distinguishes proposed commitments from current capability', (_name, Page) => {
    const html = pageText(Page)
    expect(html).toContain('Draft for review — not effective')
    expect(html).toContain('not yet enabled')
    expect(html).toContain('not a statutory deadline or a mandatory waiting period')
    expect(html).toContain('requested, not deleted')
    expect(html).toContain('Australian Consumer Law')
    expect(html).toContain('does not apply to every dog profile')
    expect(html).not.toContain('After 30 days, data')
    expect(html).not.toContain('All data is stored securely in Asia-Pacific')
    expect(html).not.toContain('No refunds are provided for partial months')
    expect(html).not.toContain('iDogs is compliant with')
  })
  it('does not make viewing the Terms acceptance or set a retrospective effective date', () => {
    const html = pageText(TermsPage)
    expect(html).toContain('viewing this review does not accept new terms')
    expect(html).toContain('14 days advance notice')
    expect(html).not.toContain('Last updated:')
  })
  it('keeps AI processing opt-in and the manual alternative in the privacy disclosure', () => {
    const html = pageText(PrivacyPage)
    expect(html).toContain('Anthropic')
    expect(html).toContain('permission for that document')
    expect(html).toContain('manual entry instead')
    expect(html).toContain('Providers may process information outside Australia')
  })
  it('uses the same proposed deletion, billing and retention sections in the app without sending a deletion request', async () => {
    const original = globalThis.fetch
    const http = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ status: 'none', canCancel: false })))
    globalThis.fetch = http
    const renderer = create(createElement(AccountDeletion))
    try {
      await act(async () => renderer.root.findByType('button').props.onClick())
      for (const section of ['deletion', 'billing', 'retention']) {
        expect(renderer.root.findAllByProps({ 'data-policy-section': section })).toHaveLength(1)
        expect(pageText(PrivacyPage)).toContain(`"data-policy-section":"${section}"`)
        expect(pageText(TermsPage)).toContain(`"data-policy-section":"${section}"`)
      }
      expect(renderer.root.findAllByProps({ 'aria-label': 'Draft policy status' })).toHaveLength(1)
      expect(http).toHaveBeenCalledTimes(1)
      expect(http.mock.calls[0]?.[1]?.method).toBe('GET')
    } finally { act(() => renderer.unmount()); globalThis.fetch = original }
  })
})

// Audit the remaining product surfaces without importing Firebase/provider side effects.
it('removes unverified residency/compliance promises from Settings, signup and passports', () => {
  for (const page of ['SettingsPage','SignupPage','DogDetailPage','PassportPublicPage']) {
    const source=readFileSync(new URL(`../pages/${page}.tsx`,import.meta.url),'utf8')
    expect(source).toContain('DATA_PROCESSING_SUMMARY')
    expect(source).not.toMatch(/stored securely in (?:the )?Asia-Pacific|Data stored in Australia|fully compliant with|Privacy Act 1988 compliant|handled securely, in line with/)
  }
})
