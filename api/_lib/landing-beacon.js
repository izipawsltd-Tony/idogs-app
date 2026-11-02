// Anonymous first-party landing-load counter (Owner 2 Nov 2026: separate
// real page-load failures from Meta measurement loss for ad clicks).
// Counts ONLY: day, landing path, campaign/ad ids from the ad URL, and an
// LCP bucket. No cookies, no IP, no user agent, no identifiers are stored.
// One aggregate document per UTC day; Admin SDK only (rules default-deny).
const KEY = /^[A-Za-z0-9 _.:+|\-]{1,60}$/
const BUCKETS = ['lt1s', '1-2.5s', '2.5-4s', 'gt4s', 'na']
export function lcpBucket(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 'na'
  return ms < 1000 ? 'lt1s' : ms < 2500 ? '1-2.5s' : ms < 4000 ? '2.5-4s' : 'gt4s'
}
const safe = v => (typeof v === 'string' && KEY.test(v.trim()) ? v.trim().replace(/[.]/g, '_') : 'none')

export function beaconFields(body) {
  if (!body || typeof body !== 'object') return null
  const path = body.path === '/' ? 'home' : body.path === '/signup' ? 'signup' : null
  if (!path) return null
  const campaign = safe(body.campaignId || body.utmId || body.campaign)
  const ad = safe(body.adId)
  const bucket = BUCKETS.includes(body.bucket) ? body.bucket : lcpBucket(body.lcp)
  const source = body.fbclid === true ? 'meta_click' : safe(body.source)
  return { path, campaign, ad, bucket, source }
}

export function landingBeaconHandler({ db, increment, now = () => new Date() }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'POST') return res.status(405).end()
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { return res.status(204).end() } }
    const f = beaconFields(body)
    if (!f) return res.status(204).end()
    const day = now().toISOString().slice(0, 10)
    const one = increment(1)
    try {
      // Nested maps + merge: Firestore set() does not treat dotted keys as paths.
      await db.collection('landingStats').doc(day).set({
        day,
        total: one,
        byPath: { [f.path]: one },
        bySource: { [f.source]: one },
        byLcp: { [f.bucket]: one },
        byCampaign: { [f.campaign]: { loads: one, [`lcp_${f.bucket}`]: one } },
        byAd: { [f.ad]: one },
      }, { merge: true })
    } catch { /* counting is best-effort */ }
    return res.status(204).end()
  }
}
