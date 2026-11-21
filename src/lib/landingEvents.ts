import { isMarketingWebsitePage, readMetaConsent } from './metaPixel'

// Consent-gated first-party click counters for the homepage calls to action
// (Owner decision, 20 Nov 2026: Option C). A click is counted ONLY when the
// visitor has chosen "Allow ad measurement" in "Ad privacy choices" on the
// website. No consent (undecided or declined), the native app, or any other
// page: nothing is sent. When counted, only an event name and the path "/" go
// to our own /api/landing-beacon (aggregate per-day number; no cookies, no
// identifiers, nothing to Meta). sendBeacon keeps the count when the visitor
// leaves the page (for example to the App Store).
// See docs/growth-v1/PRIVACY_ASSESSMENT_CLICK_COUNTERS.md.
export type LandingEvent = 'app_store' | 'cta_get_started' | 'cta_owner' | 'cta_breeder' | 'cta_voucher'

export function trackLandingEvent(event: LandingEvent, w: Window = window): void {
  try {
    if (w.location.pathname !== '/') return
    if (!isMarketingWebsitePage() || readMetaConsent() !== 'granted') return
    const body = new Blob([JSON.stringify({ path: '/', event })], { type: 'application/json' })
    if (!w.navigator.sendBeacon?.('/api/landing-beacon', body)) void w.fetch('/api/landing-beacon', { method: 'POST', body, keepalive: true })
  } catch { /* counting must never interrupt navigation */ }
}
