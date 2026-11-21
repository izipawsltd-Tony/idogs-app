// api/_lib/send-email-handler.js — logic behind /api/send-email.
//
// SECURITY (open-relay fix): previously ANY signed-in Firebase user (and
// anyone can sign up free) could POST any to_email / subject / HTML message /
// action_url and the server would send it from noreply@idogs.com.au. That is
// a phishing relay under our domain. Now:
//
//   1. Cron caller (x-cron-secret === CRON_SECRET): trusted server code
//      (api/send-reminders.js) that already composes its own HTML. Its
//      message is passed through as HTML, but action_url must still be an
//      https idogs.com.au link and the subject is stripped of newlines.
//
//   2. Signed-in user: may only request one of two server-built emails —
//      - kind 'transfer': recipient is the dog's pending buyerEmail, and only
//        if the caller is the previousOwnerId of a dog in 'pendingClaim'
//        (i.e. they just transferred it through /api/transfer-dog).
//      - kind 'reminder_digest': recipient is the caller's OWN verified email
//        from the ID token — never a caller-supplied address.
//      Caller-supplied text (names, reminder lines) is length-limited and
//      HTML-escaped. Subject, link and recipient are server-defined.

export const TRANSFER_EMAIL_ACTION_URL = 'https://idogs.com.au/login'
export const TRANSFER_EMAIL_ACTION_LABEL = 'Access your dog →'
export const REMINDERS_ACTION_URL = 'https://idogs.com.au/app/reminders'

// Mirrors src/lib/transferEmailCopy.ts (api/ is plain JS).
export function buildTransferEmailMessage(p) {
  return `${p.breederName} has transferred ownership of ${p.dogName} (${p.breed}) to you.

Sign in to iDogs using this email address to access your dog's profile, health records, documents and digital passport.

New to iDogs? Create your free account using this same email address and your dog will appear automatically.`
}

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

export function safeActionUrl(u) {
  try {
    const x = new URL(u)
    const okHost = x.hostname === 'idogs.com.au' || x.hostname.endsWith('.idogs.com.au')
    return x.protocol === 'https:' && okHost ? x.toString() : null
  } catch {
    return null
  }
}

const oneLine = (s, max) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max)
const clip = (s, max) => String(s ?? '').slice(0, max)

export function renderEmailHtml({ to_name, messageHtml, action_url, action_label }) {
  return `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1A1917;">
            <div style="margin-bottom: 24px;">
              <span style="display: inline-block; background: #085041; color: white; font-size: 14px; font-weight: 600; padding: 6px 14px; border-radius: 20px;">🐾 iDogs</span>
            </div>
            <p style="font-size: 16px; color: #5C5A54; margin-bottom: 20px;">Hi ${escapeHtml(to_name) || 'there'},</p>
            <div style="font-size: 15px; line-height: 1.7; color: #1A1917; white-space: pre-line; margin-bottom: 24px;">${messageHtml}</div>
            ${action_url ? `<div style="margin-bottom: 32px;"><a href="${escapeHtml(action_url)}" style="display: inline-block; background: #085041; color: white; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 10px; text-decoration: none;">${escapeHtml(action_label || 'Open iDogs →')}</a></div>` : ''}
            <hr style="border: none; border-top: 1px solid #E2DFD8; margin: 24px 0;" />
            <p style="font-size: 12px; color: #9A9891;">iDogs · Every dog's story, forever · <a href="https://idogs.com.au" style="color: #085041;">idogs.com.au</a></p>
          </div>
        `
}

// Returns { ok: true, email } or { ok: false, status, error }.
// email = { to_email, to_name, subject, messageHtml, action_url, action_label }
export async function resolveEmailRequest(req, { verifyIdToken, getDog, cronSecret }) {
  const headerSecret = req.headers?.['x-cron-secret']
  if (headerSecret && cronSecret && headerSecret === cronSecret) {
    const b = req.body || {}
    return { ok: true, email: {
      to_email: b.to_email,
      to_name: b.to_name,
      subject: oneLine(b.subject, 200),
      messageHtml: b.message, // trusted server-composed HTML (send-reminders.js)
      action_url: b.action_url ? safeActionUrl(b.action_url) : null,
      action_label: b.action_label,
    } }
  }

  const authHeader = req.headers?.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) return { ok: false, status: 401, error: 'Unauthorized' }
  let decoded
  try {
    decoded = await verifyIdToken(idToken)
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
  if (!decoded?.uid) return { ok: false, status: 401, error: 'Unauthorized' }

  const b = req.body || {}

  if (b.kind === 'transfer') {
    if (typeof b.dogId !== 'string' || !b.dogId) {
      return { ok: false, status: 400, error: 'dogId is required' }
    }
    const dog = await getDog(b.dogId)
    if (!dog || dog.previousOwnerId !== decoded.uid || dog.transferStatus !== 'pendingClaim' || !dog.buyerEmail) {
      return { ok: false, status: 403, error: 'No pending transfer from this account for that dog' }
    }
    const breederName = oneLine(b.breederName || 'Your breeder', 120)
    const dogName = oneLine(dog.name || 'your dog', 120)
    return { ok: true, email: {
      to_email: dog.buyerEmail,
      to_name: oneLine(b.to_name || dog.buyerName || '', 120),
      subject: oneLine(`${breederName} has transferred ${dogName} to you on iDogs`, 200),
      messageHtml: escapeHtml(buildTransferEmailMessage({ breederName, dogName, breed: oneLine(dog.breed || '', 120) })),
      action_url: TRANSFER_EMAIL_ACTION_URL,
      action_label: TRANSFER_EMAIL_ACTION_LABEL,
    } }
  }

  if (b.kind === 'reminder_digest') {
    if (!decoded.email || decoded.email_verified !== true) {
      return { ok: false, status: 403, error: 'A verified email address is required' }
    }
    return { ok: true, email: {
      to_email: decoded.email,
      to_name: oneLine(b.to_name || '', 120),
      subject: oneLine(`iDogs — Upcoming reminders for ${oneLine(b.date, 40)}`, 200),
      messageHtml: escapeHtml(`You have upcoming reminders:\n\n${clip(b.reminders, 5000)}`),
      action_url: REMINDERS_ACTION_URL,
      action_label: 'Open iDogs →',
    } }
  }

  return { ok: false, status: 403, error: 'This email type cannot be sent by signed-in users' }
}

export function createSendEmailHandler({ verifyIdToken, getDog, sendEmail, cronSecret = () => process.env.CRON_SECRET }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const resolved = await resolveEmailRequest(req, { verifyIdToken, getDog, cronSecret: cronSecret() })
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error })
    }
    const e = resolved.email
    if (!e.to_email || !e.subject || !e.messageHtml) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    try {
      const result = await sendEmail({
        from: 'iDogs <noreply@idogs.com.au>',
        to: [e.to_email],
        subject: e.subject,
        html: renderEmailHtml(e),
      })
      if (!result.ok) {
        console.error('Resend error:', result.error)
        return res.status(500).json({ error: 'Failed to send email' })
      }
      return res.status(200).json({ success: true, id: result.id })
    } catch (err) {
      console.error('Server error:', err)
      return res.status(500).json({ error: 'Server error' })
    }
  }
}
