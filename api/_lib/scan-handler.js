// api/_lib/scan-handler.js — trusted control flow for iDogs Scan (Codex
// H3). Factored out of api/scan.js (same pattern as
// api/_lib/checkout-handler.js / webhook-handler.js) so the
// reserve-before-call / rollback-on-failure sequencing can be unit-tested
// with fake verifyIdToken/reserveQuota/rollbackQuota/callModel — no real
// Firebase Auth, Firestore, or Anthropic API needed.
//
// Quota is reserved (decremented) atomically BEFORE the paid model is
// ever called — see api/_lib/scan-quota.js for why. If the model call
// itself then fails (network error, non-2xx from Claude), the reservation
// is rolled back so the account isn't charged quota for a scan that never
// actually processed anything. A successful model response (including the
// raw-text-fallback path when its JSON doesn't parse cleanly — that's
// still a real, paid model response) keeps the reservation.

export function createScanHandler({ verifyIdToken, getUserRef, reserveQuota, rollbackQuota, callModel }) {
  return async function scanHandler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const authHeader = req.headers?.authorization || ''
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!idToken) {
      return res.status(401).json({ error: 'Missing Authorization header' })
    }
    let uid
    try {
      const decoded = await verifyIdToken(idToken)
      uid = decoded.uid
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    const { image, mediaType } = req.body || {}
    if (!image) {
      return res.status(400).json({ error: 'No file provided' })
    }

    const userRef = getUserRef(uid)

    // Codex H3 — reserved BEFORE the paid model is ever invoked.
    const reservation = await reserveQuota(userRef)
    if (!reservation.reserved) {
      return res.status(403).json({
        error: reservation.plan === 'plus'
          ? 'You have used all 10 AI scans for this billing period.'
          : 'You have used both of your free AI scans. Upgrade to Plus for 10 scans/month.',
        reason: 'SCAN_QUOTA_EXCEEDED',
        plan: reservation.plan,
      })
    }

    let modelResult
    try {
      modelResult = await callModel({ image, mediaType })
    } catch (err) {
      await rollbackQuota(userRef, reservation.plan, reservation.periodStart)
      return res.status(500).json({ error: 'Internal error', message: String(err) })
    }

    if (!modelResult.ok) {
      await rollbackQuota(userRef, reservation.plan, reservation.periodStart)
      return res.status(500).json({ error: 'Claude API error', status: modelResult.status, details: modelResult.details })
    }

    // The reservation already committed the decrement — a real (paid)
    // model response came back, so it stays consumed regardless of
    // whether the extracted JSON happened to parse cleanly.
    return res.status(200).json(modelResult.extracted)
  }
}
