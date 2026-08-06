// api/_lib/showcase-notification.js — best-effort breeder email
// notification for a public Litter Showcase enquiry (api/create-
// showcase-enquiry.js), plus the buyer's own confirmation email once
// that notification is accepted. Pure w.r.t. its inputs (plus the
// global `fetch`, injectable in tests) — deliberately has NO Firebase
// Admin SDK dependency at all, unlike the top-level-initializeApp()
// endpoint files that call it, so it can be imported and unit-tested
// directly without real Firebase credentials, matching this codebase's
// own established `_lib/` convention (enquiry-schema.js, showcase-
// share.js, etc.).
//
// Tony live-staging finding ("enquiry destination unclear"): a PREVIOUS
// round already reworded the public success copy once, to stop
// literally claiming "an email was sent" — but the enquiry was (and
// structurally still is) ONLY EVER PERSISTED by api/create-showcase-
// enquiry.js; nothing was ever sent to the breeder, so even the
// reworded "has received your enquiry" copy overstated what actually
// happened. This module adds a REAL best-effort email notification —
// via the SAME Resend provider/domain/sender this codebase already uses
// everywhere else (api/send-email.js, api/survey.js), never a new
// credential/provider/domain.
//
// NEVER throws and NEVER blocks the enquiry from being persisted,
// regardless of outcome — the caller always writes its Firestore
// document either way; this only decides what `notified` ends up being
// on that document.
//
// Gracefully no-ops (returns notified:false, errorCode:null — "not
// attempted", not "failed") when RESEND_API_KEY isn't configured for
// this deployment — the SAME `if (RESEND_API_KEY)` guard api/survey.js
// already uses for its own public-endpoint email sends. This is the
// CURRENT real state on idogs-app-staging (confirmed absent via `vercel
// env ls` during this fix's investigation) — safe to deploy before that
// key is ever added; every enquiry still persists correctly and the
// frontend correctly shows the honest "stored" message until it is.
//
// Buyer/breeder email workflow (Reply-To wiring): the breeder
// notification's Reply-To is the BUYER's own submitted email, so a
// breeder hitting "Reply" in their inbox lands directly in a
// conversation with the buyer — never noreply@idogs.com.au, which
// accepts no replies at all. Symmetrically, the buyer's own
// confirmation email (sendShowcaseEnquiryConfirmation below) sets
// Reply-To to the BREEDER's resolved email, so the buyer can reply
// straight back to the breeder too. Both directions deliberately avoid
// ever making noreply@idogs.com.au a reply target, and neither address
// used for To/Reply-To is ever read from client-supplied request data —
// see isSafeEmailHeaderValue() below and each call site's own comment
// for where every address actually comes from.
const HEADER_SAFE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Defense-in-depth guard applied immediately before any address is used
// as a To/Reply-To value — independent of whatever validation a caller
// already did upstream (api/_lib/enquiry-schema.js's EMAIL_PATTERN for
// the buyer, Firebase Auth for the breeder). Rejects anything containing
// a CR/LF (the classic header-injection vector — a second `To:`/`Bcc:`
// header smuggled into what should be a single address value) or any
// other whitespace, and requires the same permissive-but-structural
// shape as the rest of this codebase's email validation. A value that
// fails this is treated exactly like "unavailable" — the send is
// skipped/degrades gracefully, it never throws and never silently sends
// with a malformed header.
function isSafeEmailHeaderValue(value) {
  return typeof value === 'string' && !/[\r\n]/.test(value) && HEADER_SAFE_EMAIL_PATTERN.test(value)
}

export async function sendShowcaseEnquiryNotification({ breederEmail, litterName, puppyName, enquirerName, enquirerEmail, enquirerPhone, message }) {
  const { RESEND_API_KEY } = process.env
  if (!RESEND_API_KEY) return { notified: false, errorCode: null }
  if (!breederEmail) return { notified: false, errorCode: 'RECIPIENT_EMAIL_UNAVAILABLE' }

  const subject = puppyName ? `🐾 New enquiry about ${puppyName}` : `🐾 New enquiry — ${litterName}`
  const contactLine = [enquirerEmail, enquirerPhone].filter(Boolean).join(' · ') || 'No contact details provided'

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'iDogs <noreply@idogs.com.au>',
        to: [breederEmail],
        // Reply-To the BUYER's own submitted email — never omitted in
        // favour of noreply@idogs.com.au, and never set at all if the
        // buyer only left a phone number or the submitted address fails
        // the header-safety check above (a breeder simply can't reply
        // by email in that case; they still have the address/phone in
        // the email body itself).
        ...(isSafeEmailHeaderValue(enquirerEmail) ? { reply_to: enquirerEmail } : {}),
        subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1A1917;">
            <div style="margin-bottom: 24px;"><span style="display: inline-block; background: #085041; color: white; font-size: 14px; font-weight: 600; padding: 6px 14px; border-radius: 20px;">🐾 iDogs</span></div>
            <p style="font-size: 16px; color: #5C5A54; margin-bottom: 8px;">New enquiry from your Litter Showcase — <strong>${litterName}</strong>${puppyName ? ` (about ${puppyName})` : ''}.</p>
            <p style="font-size: 15px; margin: 16px 0 4px;"><strong>${enquirerName}</strong></p>
            <p style="font-size: 14px; color: #5C5A54; margin: 0 0 16px;">${contactLine}</p>
            <div style="font-size: 15px; line-height: 1.7; color: #1A1917; white-space: pre-line; margin-bottom: 24px; border-left: 3px solid #E1F5EE; padding-left: 14px;">${message}</div>
            <p style="font-size: 13px; color: #5C5A54; margin-bottom: 0;">Reply directly to this email to reach ${enquirerName}, or view this enquiry from your iDogs dashboard — Litters → this litter → Enquiries.</p>
            <hr style="border: none; border-top: 1px solid #E2DFD8; margin: 24px 0;" />
            <p style="font-size: 12px; color: #9A9891;">iDogs · Every dog's story, forever</p>
          </div>
        `,
      }),
    })
    if (!response.ok) return { notified: false, errorCode: 'EMAIL_PROVIDER_REJECTED' }
    return { notified: true, errorCode: null }
  } catch {
    return { notified: false, errorCode: 'NOTIFICATION_SEND_FAILED' }
  }
}

// Buyer's own confirmation email — ONLY ever meaningful to call after
// sendShowcaseEnquiryNotification() above has already returned
// notified:true (see api/create-showcase-enquiry.js's call site
// comment). Same graceful-degradation contract as the function above:
// never throws, no-ops when RESEND_API_KEY is unset, and a missing or
// header-unsafe buyerEmail (e.g. a phone-only enquiry) is treated as
// "not attempted" rather than an error — there is nothing wrong with
// the enquiry itself, there's just no address to confirm to.
export async function sendShowcaseEnquiryConfirmation({ buyerEmail, buyerName, litterName, puppyName, kennelName, breederEmail }) {
  const { RESEND_API_KEY } = process.env
  if (!RESEND_API_KEY) return { sent: false, errorCode: null }
  if (!isSafeEmailHeaderValue(buyerEmail)) return { sent: false, errorCode: 'BUYER_EMAIL_UNAVAILABLE' }

  const breederDisplayName = kennelName || 'the breeder'
  const subject = 'Your enquiry has been sent'

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'iDogs <noreply@idogs.com.au>',
        to: [buyerEmail],
        // Reply-To the BREEDER's own resolved email (never client-
        // supplied — see api/create-showcase-enquiry.js) — never
        // noreply@idogs.com.au, and never set at all if that address
        // somehow fails the header-safety check (fail-closed: omit
        // the header rather than risk an unsafe one).
        ...(isSafeEmailHeaderValue(breederEmail) ? { reply_to: breederEmail } : {}),
        subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1A1917;">
            <div style="margin-bottom: 24px;"><span style="display: inline-block; background: #085041; color: white; font-size: 14px; font-weight: 600; padding: 6px 14px; border-radius: 20px;">🐾 iDogs</span></div>
            <p style="font-size: 16px; color: #5C5A54; margin-bottom: 8px;">Hi ${buyerName},</p>
            <p style="font-size: 15px; line-height: 1.7; color: #1A1917; margin: 0 0 16px;">Your enquiry${puppyName ? ` about <strong>${puppyName}</strong>` : ''}${litterName ? ` (${litterName})` : ''} has been sent to <strong>${breederDisplayName}</strong>.</p>
            <p style="font-size: 15px; line-height: 1.7; color: #1A1917; margin: 0 0 24px;">${breederDisplayName} will contact you directly.</p>
            <hr style="border: none; border-top: 1px solid #E2DFD8; margin: 24px 0;" />
            <p style="font-size: 12px; color: #9A9891;">iDogs · Every dog's story, forever</p>
          </div>
        `,
      }),
    })
    if (!response.ok) return { sent: false, errorCode: 'EMAIL_PROVIDER_REJECTED' }
    return { sent: true, errorCode: null }
  } catch {
    return { sent: false, errorCode: 'NOTIFICATION_SEND_FAILED' }
  }
}
