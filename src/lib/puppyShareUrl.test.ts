import { describe, expect, it, vi } from 'vitest'
vi.mock('./firebase', () => ({ auth: { currentUser: null } }))
import { puppyShareUrl, CANONICAL_PUBLIC_ORIGIN } from './puppyUpdates'

describe('QR share URL', () => {
  it('Production web build encodes the canonical domain even when opened on another host', () => {
    for (const origin of ['https://idogs-app.vercel.app', 'https://idogs-abc123-izipawsltd-tonys-projects.vercel.app', 'https://www.idogs.com.au', 'https://idogs.com.au']) {
      expect(puppyShareUrl('PIN-2026-NS3V', { projectId: 'idogs-app', origin })).toBe('https://idogs.com.au/p/PIN-2026-NS3V')
    }
  })
  it('Production native (iOS/Android) build encodes the canonical domain', () => {
    expect(puppyShareUrl('PIN-1', { projectId: 'idogs-app', native: 'ios', origin: 'capacitor://localhost' })).toBe(`${CANONICAL_PUBLIC_ORIGIN}/p/PIN-1`)
  })
  it('is HTTPS, carries no tokens or query parameters, and encodes the passport id safely', () => {
    const url = new URL(puppyShareUrl('PIN 1/../x?y', { projectId: 'idogs-app' }))
    expect(url.protocol).toBe('https:')
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    expect(url.pathname).toBe('/p/PIN%201%2F..%2Fx%3Fy')
  })
  it('staging builds keep their own origin for QA (never Production data)', () => {
    expect(puppyShareUrl('PIN-1', { projectId: 'idogs-app-staging', origin: 'https://idogs-app-staging-x.vercel.app' })).toBe('https://idogs-app-staging-x.vercel.app/p/PIN-1')
  })
})
