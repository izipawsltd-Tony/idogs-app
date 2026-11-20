// Anonymous click counters for the homepage calls to action (see
// api/_lib/landing-beacon.js). Sends only an event name and the path "/":
// no cookies, no identifiers, nothing to third parties, so it works the same
// for every visitor. sendBeacon is used so the count survives leaving the page
// (for example to the App Store).
// OFF until the Owner confirms the privacy/consent position (see
// docs/growth-v1/PRIVACY_ASSESSMENT_CLICK_COUNTERS.md). While false nothing is sent.
export const LANDING_CLICK_COUNTERS_ENABLED = false

export type LandingEvent = 'app_store' | 'cta_get_started' | 'cta_owner' | 'cta_breeder' | 'cta_voucher'

export function trackLandingEvent(event: LandingEvent, w: Window = window): void {
  try {
    if (!LANDING_CLICK_COUNTERS_ENABLED) return
    if (w.location.pathname !== '/') return
    const body = new Blob([JSON.stringify({ path: '/', event })], { type: 'application/json' })
    if (!w.navigator.sendBeacon?.('/api/landing-beacon', body)) void w.fetch('/api/landing-beacon', { method: 'POST', body, keepalive: true })
  } catch { /* counting must never interrupt navigation */ }
}
