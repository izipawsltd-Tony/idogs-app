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
    const v = clean(q.get(param) || '')
    if (v) { (out as Record<string, unknown>)[field] = v; any = true }
  }
  return any ? out : null
}

const FIELDS = ['source', 'medium', 'campaign', 'content', 'term', 'utmId', 'campaignId', 'adsetId', 'adId', 'placement'] as const
const PATHS = ['/', '/signup', '/survey', 'other']
export const ACQUISITION_PARAM = 'acq'

const fresh = (a: Acquisition | null) => a && a.version === 1 && Date.now() - Date.parse(a.firstSeenAt) < MAX_AGE_MS && Date.parse(a.firstSeenAt) <= Date.now() + 60_000 ? a : null

/** Rebuilds an attribution from untrusted input, keeping only known, cleaned fields. */
function sanitize(raw: unknown): Acquisition | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.version !== 1 || typeof r.firstSeenAt !== 'string' || Number.isNaN(Date.parse(r.firstSeenAt))) return null
  const out: Acquisition = { fbclid: r.fbclid === true, landingPath: PATHS.includes(String(r.landingPath)) ? String(r.landingPath) : 'other', firstSeenAt: new Date(Date.parse(r.firstSeenAt)).toISOString(), version: 1 }
  let any = out.fbclid
  for (const f of FIELDS) { const v = typeof r[f] === 'string' ? clean(r[f] as string) : ''; if (v) { (out as Record<string, unknown>)[f] = v; any = true } }
  return any ? fresh(out) : null
}

/**
 * Email-link signup is often finished in a different browser (the mail app's),
 * where this device's first touch is not stored. The campaign labels (never
 * contact details, never the fbclid value) therefore travel in the sign-in
 * link's return URL so they still apply to the new account.
 */
export function acquisitionReturnParam(): string | null {
  const a = read()
  if (!a) return null
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(a))
    let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b) })
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch { return null }
}

export function acquisitionFromReturnParam(value: string | null | undefined): Acquisition | null {
  if (!value || value.length > 1500 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    return sanitize(JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))))
  } catch { return null }
}

function fromLocation(): Acquisition | null {
  try { return acquisitionFromReturnParam(new URLSearchParams(window.location.search).get(ACQUISITION_PARAM)) } catch { return null }
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
    const a = acquisitionFromReturnParam(new URLSearchParams(search).get(ACQUISITION_PARAM)) || parseAcquisition(search, pathname)
    if (a) localStorage.setItem(ACQUISITION_KEY, JSON.stringify(a))
  } catch { /* attribution is optional */ }
}

/** Value to store on a NEW profile; 'direct' when no ad visit was seen on this device. */
export function signupAcquisition(): Acquisition | { source: 'direct'; version: 1 } {
  return read() || fromLocation() || { source: 'direct', version: 1 }
}

/** Called once the attribution has been written to a new profile. */
export function clearAcquisition(): void {
  try { localStorage.removeItem(ACQUISITION_KEY) } catch { /* optional */ }
}
