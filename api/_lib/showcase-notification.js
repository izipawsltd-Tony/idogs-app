// api/_lib/showcase-notification.js — best-effort breeder email
// notification for a public Litter Showcase enquiry (api/create-
// showcase-enquiry.js). Pure w.r.t. its inputs (plus the global `fetch`,
// injectable in tests) — deliberately has NO Firebase Admin SDK
// dependency at all, unlike the top-level-initializeApp() endpoint files
// that call it, so it can be imported and unit-tested directly without
// real Firebase credentials, matching this codebase's own established
// `_lib/` convention (enquiry-schema.js, showcase-share.js, etc.).
//
// Tony live-staging finding ("enquiry destination unclear"): a PREVIOUS
// round already reworded the public success copy once, to stop
// literally claiming "an email was sent" — but the enquiry was (and
// structurally still is) ONLY EVER PERSISTED by api/create-showcase-
// enquiry.js; nothing was ever sent to the breeder, so even the
// reworded "has received your enquiry" copy overstated what actually
// happened. This module adds a REAL best-effort email notification —
// via the SAME Resend provider/domain/sender this codebase already uses
// everywhere else (api/send-email.js, api/survey.js) — never a new
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
        from: 'iDogs Showcase <noreply@idogs.com.au>',
        to: [breederEmail],
        subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1A1917;">
            <div style="margin-bottom: 24px;"><span style="display: inline-block; background: #085041; color: white; font-size: 14px; font-weight: 600; padding: 6px 14px; border-radius: 20px;">🐾 iDogs</span></div>
            <p style="font-size: 16px; color: #5C5A54; margin-bottom: 8px;">New enquiry from your Litter Showcase — <strong>${litterName}</strong>${puppyName ? ` (about ${puppyName})` : ''}.</p>
            <p style="font-size: 15px; margin: 16px 0 4px;"><strong>${enquirerName}</strong></p>
            <p style="font-size: 14px; color: #5C5A54; margin: 0 0 16px;">${contactLine}</p>
            <div style="font-size: 15px; line-height: 1.7; color: #1A1917; white-space: pre-line; margin-bottom: 24px; border-left: 3px solid #E1F5EE; padding-left: 14px;">${message}</div>
            <p style="font-size: 13px; color: #5C5A54; margin-bottom: 0;">View and reply to this enquiry from your iDogs dashboard — Litters → this litter → Enquiries.</p>
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
