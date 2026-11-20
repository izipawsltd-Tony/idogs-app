import { describe, expect, it, vi } from 'vitest'
import { LANDING_CLICK_COUNTERS_ENABLED, trackLandingEvent } from './landingEvents'

describe('homepage click counters (held off pending privacy sign-off)', () => {
  it('is disabled by default and sends nothing', () => {
    const sendBeacon = vi.fn(() => true)
    const fetch = vi.fn()
    const w = { location: { pathname: '/' }, navigator: { sendBeacon }, fetch } as unknown as Window
    expect(LANDING_CLICK_COUNTERS_ENABLED).toBe(false)
    trackLandingEvent('app_store', w)
    expect(sendBeacon).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
