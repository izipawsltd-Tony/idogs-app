// First-party signup attribution (Owner 2 Nov 2026: "hoàn thiện Meta Ads
// conversion — biết vì sao quảng cáo chưa tạo ra khách hàng").
//
// Records WHICH campaign/ad a visitor first arrived from, so iDogs can count
// real accounts per campaign in its own data — independent of the Meta Pixel,
// which only runs after an explicit "Allow". Only standard ad metadata from
// the landing URL is kept (UTM + Meta ad ids). The fbclid VALUE is never
// stored, only whether one was present. Nothing is sent to Meta or any third
// party; it is written to the new account's own profile at signup.
export type Acquisition = {
  source?: string; medium?: string; campaign?: string; content?: string; term?: string
  utmId?: string; campaignId?: string; adsetId?: string; adId?: string; placement?: string
  fbclid: boolean; landingPath: string; firstSeenAt: string; version: 1
}
export const ACQUISITION_KEY = 'idogs-acquisition-v1'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAP: Record<string, keyof Acquisition> = {
  utm_source: 'source', utm_medium: 'medium', utm_campaign: 'campaign', utm_content: 'content', utm_term: 'term',
  utm_id: 'utmId', campaign_id: 'campaignId', adset_id: 'adsetId', ad_id: 'adId', placement: 'placement', utm_placement: 'placement',
}
const clean = (v: string) => v.replace(/[^\p{L}\p{N} ._:+|/()\-[\]{}]/gu, '').trim().slice(0, 100)

export function parseAcquisition(search: string, pathname: string, now = Date.now()): Acquisition | null {
  const q = new URLSearchParams(search)
  const out: Acquisition = { fbclid: q.has('fbclid'), landingPath: ['/', '/signup', '/survey'].includes(pathname) ? pathname : 'other', firstSeenAt: new Date(now).toISOString(), version: 1 }
  let any = out.fbclid
  for (const [param, field] of Object.entries(MAP)) {
    const v = q.get(param)
    if (v && clean(v)) { (out as Record<string, unknown>)[field] = clean(v); any = true }
  }
  return any ? out : null
}

function read(): Acquisition | null {
  try {
    const v = JSON.parse(localStorage.getItem(ACQUISITION_KEY) || 'null') as Acquisition | null
    return v && v.version === 1 && Date.now() - Date.parse(v.firstSeenAt) < MAX_AGE_MS ? v : null
  } catch { return null }
}

/** First touch wins for 30 days; later ad clicks do not overwrite it. */
export function captureAcquisition(search: string, pathname: string): void {
  try {
    if (read()) return
    const a = parseAcquisition(search, pathname)
    if (a) localStorage.setItem(ACQUISITION_KEY, JSON.stringify(a))
  } catch { /* attribution is optional */ }
}

/** Value to store on a NEW profile; 'direct' when no ad visit was seen on this device. */
export function signupAcquisition(): Acquisition | { source: 'direct'; version: 1 } {
  return read() || { source: 'direct', version: 1 }
}
