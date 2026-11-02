// Anonymous landing-load counter for ad clicks (see api/_lib/landing-beacon.js).
// Sent once per page load, only for an ad visit (fbclid or utm_source) to
// / or /signup, after the page has painted. Carries ad ids + an LCP number;
// no cookies, no identifiers, nothing to third parties.
let sent = false
export function scheduleLandingBeacon(search: string, pathname: string, w: Window = window): void {
  if (sent || !['/', '/signup'].includes(pathname)) return
  const q = new URLSearchParams(search)
  if (!q.has('fbclid') && !q.has('utm_source')) return
  sent = true
  let lcp = 0
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true }) } catch { /* unsupported (older Safari) */ }
  const payload = () => JSON.stringify({ path: pathname, lcp: Math.round(lcp), fbclid: q.has('fbclid'), source: q.get('utm_source') || '', campaignId: q.get('campaign_id') || '', utmId: q.get('utm_id') || '', campaign: q.get('utm_campaign') || '', adId: q.get('ad_id') || '' })
  let done = false
  const send = () => {
    if (done) return
    done = true
    try {
      const body = new Blob([payload()], { type: 'application/json' })
      if (!w.navigator.sendBeacon?.('/api/landing-beacon', body)) void fetch('/api/landing-beacon', { method: 'POST', body, keepalive: true })
    } catch { /* best-effort */ }
  }
  // After LCP has had time to settle, or when the visitor leaves early.
  w.setTimeout(send, 4000)
  w.addEventListener('pagehide', send, { once: true })
}
export function __resetLandingBeaconForTests() { sent = false }
