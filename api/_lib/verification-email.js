import { createHash } from 'node:crypto'

// Branded email-verification delivery (Owner approval 2 Nov 2026: "đổi thành
// iDogs"). Firebase's default template shows sender "noreply", subject
// "Verify your email for idogs-app" and the project console blocks template
// edits, so the link is generated with the Admin SDK and delivered through
// Resend from the verified noreply@idogs.com.au sender.
//
// Safety:
// - recipient is ONLY the authenticated account's own email (ID token);
//   the caller cannot choose an address, message or link;
// - already-verified accounts are never emailed;
// - durable per-account limit (Firestore transaction) so a client loop cannot
//   spam a mailbox or burn the Resend quota;
// - continue URL is restricted to known iDogs origins;
// - any failure returns a non-"sent" answer so the client falls back to the
//   unchanged Firebase sendEmailVerification (delivery never gets worse).

export const VERIFICATION_LIMITS = Object.freeze({ WINDOW_MS: 60 * 60 * 1000, MAX_PER_WINDOW: 5, MIN_INTERVAL_MS: 30 * 1000 })
const COLLECTION = 'verificationEmailDeliveries'
const DEFAULT_ORIGIN = 'https://idogs.com.au'
const ALLOWED_ORIGIN = /^https:\/\/(?:idogs\.com\.au|www\.idogs\.com\.au|idogs-app[a-z0-9-]*\.vercel\.app)$|^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{2,5})?$/

export const verificationSubject = 'Verify your email for iDogs'

export function continueUrlFor(origin) {
  const base = typeof origin === 'string' && ALLOWED_ORIGIN.test(origin) ? origin : DEFAULT_ORIGIN
  return `${base}/verify-email`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function verificationHtml(link) {
  const safe = escapeHtml(link)
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1A1917">
      <img src="https://idogs.com.au/01_idogs_primary_horizontal_transparent.png" width="180" alt="iDogs" style="display:block;width:180px;max-width:100%;height:auto;margin:0 0 28px" />
      <h1 style="font-size:22px;margin:0 0 14px;color:#085041">Confirm your email address</h1>
      <p style="font-size:15px;line-height:1.7;color:#5C5A54">Thanks for joining iDogs. Tap the button below to confirm this is your email address, then you can add your dog and keep their story in one place.</p>
      <p style="margin:24px 0"><a href="${safe}" style="display:inline-block;background:#085041;color:#fff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:10px;text-decoration:none">Verify email address</a></p>
      <p style="font-size:13px;line-height:1.6;color:#5C5A54">If the button doesn&#39;t work, copy this link into your browser:<br /><span style="word-break:break-all;color:#085041">${safe}</span></p>
      <p style="font-size:13px;line-height:1.6;color:#5C5A54">If you didn&#39;t create an iDogs account, you can ignore this email.</p>
      <hr style="border:0;border-top:1px solid #E2DFD8;margin:24px 0" />
      <p style="font-size:12px;color:#9A9891">iDogs &middot; <a href="https://idogs.com.au" style="color:#085041">idogs.com.au</a></p>
    </div>`
}

export function verificationText(link) {
  return `Confirm your email address\n\nThanks for joining iDogs. Open this link to confirm this is your email address:\n\n${link}\n\nIf you didn't create an iDogs account, you can ignore this email.\n\nThe iDogs team\nhttps://idogs.com.au`
}

export function verificationEmailHandler({ verifyToken, generateLink, db, apiKey, fetchImpl = fetch, now = Date.now }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    let identity
    try {
      const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1]
      if (!token) throw new Error('missing token')
      identity = await verifyToken(token)
    } catch { return res.status(401).json({ error: 'Unauthorized' }) }
    const email = typeof identity.email === 'string' ? identity.email : ''
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(200).json({ sent: false, reason: 'no_email' })
    if (identity.email_verified === true) return res.status(200).json({ sent: false, reason: 'already_verified' })
    if (!apiKey) return res.status(200).json({ sent: false, reason: 'email_unavailable' })

    const ref = db.collection(COLLECTION).doc(createHash('sha256').update(String(identity.uid)).digest('hex'))
    const t = now()
    let allowed
    try {
      allowed = await db.runTransaction(async tx => {
        const snap = await tx.get(ref)
        const prev = snap.exists ? snap.data() : null
        const inWindow = prev && typeof prev.windowStart === 'number' && t - prev.windowStart < VERIFICATION_LIMITS.WINDOW_MS
        const count = inWindow ? Number(prev.count) || 0 : 0
        if (inWindow && count >= VERIFICATION_LIMITS.MAX_PER_WINDOW) return false
        if (prev && typeof prev.lastAt === 'number' && t - prev.lastAt < VERIFICATION_LIMITS.MIN_INTERVAL_MS) return false
        tx.set(ref, { windowStart: inWindow ? prev.windowStart : t, count: count + 1, lastAt: t, expiresAt: new Date(t + VERIFICATION_LIMITS.WINDOW_MS * 2) })
        return true
      })
    } catch { return res.status(503).json({ sent: false, error: 'Verification email unavailable' }) }
    if (!allowed) return res.status(429).json({ sent: false, error: 'Too many verification emails. Please wait a few minutes and try again.' })

    try {
      const link = await generateLink(email, { url: continueUrlFor(req.headers.origin) })
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'iDogs <noreply@idogs.com.au>', to: [email], subject: verificationSubject, html: verificationHtml(link), text: verificationText(link) }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error('provider rejected')
      return res.status(200).json({ sent: true })
    } catch { return res.status(503).json({ sent: false, error: 'Verification email unavailable' }) }
  }
}
