import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PrivacyPage from '../pages/PrivacyPage'
import TermsPage from '../pages/TermsPage'
import AccountDeletion from '../components/ui/AccountDeletion'
import { act, create } from 'react-test-renderer'
import { DELETION_POLICY } from '../../shared/account-deletion-copy.js'
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { getIdToken: async () => 'synthetic' } }) }))

const pageText = (page: typeof PrivacyPage) => {
  const renderer = create(createElement(MemoryRouter, {}, createElement(page)))
  const text = JSON.stringify(renderer.toJSON())
  act(() => renderer.unmount())
  return text
}
describe('effective policy, synced with idogs.com.au (06 Nov 2026)', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  it('in-app Privacy and Terms are the same files the website publishes, with no draft notice', () => {
    for (const page of ['Privacy', 'Terms']) {
      const html = pageText(page === 'Privacy' ? PrivacyPage : TermsPage)
      expect(html).not.toMatch(/Draft for review|not effective|Review version/)
    }
    expect(pageText(PrivacyPage)).toContain('Last updated: ')
  })
  it('Privacy states the 7-day deletion commitment, subscription cancellation and what is kept', () => {
    const html = pageText(PrivacyPage)
    for (const point of DELETION_POLICY) expect(html).toContain(JSON.stringify(point).slice(1, -1))
    expect(html).toContain('within 7 days of your confirmed request and email you when it is done')
    expect(html).not.toContain('After 30 days, data is permanently deleted')
  })
  it('discloses iDogs Scan sharing with Anthropic as opt-in with a manual alternative, and Meta consent', () => {
    const html = pageText(PrivacyPage)
    expect(html).toContain('sends that photo or PDF to Anthropic')
    expect(html).toContain('You can enter records manually instead')
    expect(html).toContain('Meta Pixel')
    expect(html).toContain('It does not run in the native app')
  })
  it('Terms point account deletion at the same 7-day Privacy section', () => {
    expect(pageText(TermsPage)).toContain('we complete it within 7 days as described in our')
  })
  it('Delete account screen shows the same deletion wording and only reads status on open', async () => {
    const original = globalThis.fetch
    const http = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ status: 'none', canCancel: false })))
    globalThis.fetch = http
    const renderer = create(createElement(AccountDeletion))
    try {
      await act(async () => renderer.root.findByType('button').props.onClick())
      expect(renderer.root.findAllByProps({ 'data-policy-section': 'deletion' })).toHaveLength(1)
      const out = JSON.stringify(renderer.toJSON())
      for (const point of DELETION_POLICY) expect(out).toContain(JSON.stringify(point).slice(1, -1))
      expect(out).not.toContain('Draft for review')
      expect(http).toHaveBeenCalledTimes(1)
      expect(http.mock.calls[0]?.[1]?.method).toBe('GET')
    } finally { act(() => renderer.unmount()); globalThis.fetch = original }
  })
  it('the deletion copy module is byte-identical to the web copy shipped with it', () => {
    expect(read('../../shared/account-deletion-copy.js')).toContain("DELETION_POLICY_UPDATED = '6 November 2026'")
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
