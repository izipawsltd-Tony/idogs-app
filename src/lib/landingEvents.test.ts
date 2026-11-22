import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackLandingEvent } from './landingEvents'
import { META_CONSENT_KEY } from './metaPixel'

function setup(consent: string | null, pathname = '/') {
  const store: Record<string, string> = {}
  if (consent) store[META_CONSENT_KEY] = consent
  const ls = { getItem: (k: string) => (k in store ? store[k] : null), setItem: () => {}, removeItem: () => {} }
  const sendBeacon = vi.fn(() => true)
  const fetch = vi.fn()
  const w = { location: { pathname }, navigator: { sendBeacon }, fetch, localStorage: ls } as unknown as Window
  vi.stubGlobal('window', w)
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('location', { pathname })
  return { w, sendBeacon, fetch }
}

describe('homepage click counters are consent-gated (Option C)', () => {
  beforeEach(() => { vi.stubGlobal('Blob', class { constructor(public parts: unknown[]) {} }) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends nothing before the visitor chooses', () => {
    const { w, sendBeacon, fetch } = setup(null)
    trackLandingEvent('app_store', w)
    expect(sendBeacon).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
  it('sends nothing after Decline', () => {
    const { w, sendBeacon, fetch } = setup('denied')
    trackLandingEvent('cta_get_started', w)
    expect(sendBeacon).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
  it('counts the click only after Allow, on the homepage only', () => {
    const a = setup('granted'); trackLandingEvent('app_store', a.w)
    expect(a.sendBeacon).toHaveBeenCalledTimes(1)
    const b = setup('granted', '/signup'); trackLandingEvent('app_store', b.w)
    expect(b.sendBeacon).not.toHaveBeenCalled()
  })
})
