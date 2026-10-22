import { PLUS_PROMOTION_END, PLUS_PROMOTION_ID, isPlusPromotionActive } from '../../shared/plus-promotion.js'

export const BILLING_URL = 'https://idogs.com.au/app/billing'
export const UNSUBSCRIBE_TOKEN = '{{{RESEND_UNSUBSCRIBE_URL}}}'
export const REMINDER_AT = PLUS_PROMOTION_END - 7 * 24 * 60 * 60_000
export const REMINDER_CHANNEL = 'stripe-native'
const MAX_SNAPSHOT_AGE = 5 * 60_000

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

function safeUrl(value, allowUnsubscribeToken = false) {
  if (allowUnsubscribeToken && value === UNSUBSCRIBE_TOKEN) return value
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('An HTTPS link without embedded credentials is required')
  if (!['idogs.com.au', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Unapproved email link host')
  return url.href
}

function shell({ title, name, content, footer }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;background:#f5f4ef;color:#1a1917;font-family:Arial,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px"><table role="presentation" style="width:100%;max-width:560px;margin:auto;background:#fff;border-radius:18px"><tr><td style="padding:28px 24px;font-size:16px;line-height:1.7;overflow-wrap:anywhere">
<p style="margin:0 0 24px"><a href="https://idogs.com.au" style="display:inline-block;background:#085041;color:white;padding:6px 18px;border-radius:24px;text-decoration:none;font-size:22px;font-weight:bold">🐾 iDogs</a></p>
<p>Hi ${escape(name || 'there')},</p>${content}
<hr style="border:0;border-top:1px solid #e2dfd8;margin:28px 0"><p>The iDogs Team<br><span style="color:#666">For Australian dog owners and breeders</span><br><a href="https://idogs.com.au" style="color:#085041">Visit iDogs</a></p>${footer}
</td></tr></table></td></tr></table></body></html>`
}

function button(url, label) {
  return `<p style="margin:28px 0"><a href="${escape(url)}" style="display:inline-block;background:#085041;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:bold">${escape(label)} →</a></p>`
}

// Provider tokens are deliberately restricted to Broadcasts. Never pass the
// returned invitation to the transactional /api/send-email relay.
export function invitationEmail({ firstName = '', unsubscribeUrl = UNSUBSCRIBE_TOKEN } = {}) {
  const unsubscribe = safeUrl(unsubscribeUrl, true)
  const subject = 'iDogs Plus is free until 31 January 2027 🐾'
  const terms = 'Payment details are required. Your subscription renews automatically at A$7/month, including GST, from 1 February 2027 (Adelaide time) unless you cancel before renewal. SMS and extra litters are charged separately.'
  const content = `<p>There’s something new waiting for you at iDogs.</p>
<h1 style="font-size:30px;line-height:1.25">iDogs Plus is free until<br>31 January 2027</h1>
<p>For a limited time, you can enjoy <strong>iDogs Plus for A$0/month through 31 January 2027</strong>.</p>
<p>Keep your dogs’ records organised with:</p><ul style="padding-left:22px"><li>Up to 5 dogs, with health records and documents in one place.</li><li>10 iDogs Document Scans each month.</li><li>Breeder tools, including 2 litters per rolling 12 months.</li><li>PDF and CSV report exports.</li></ul>
<p style="background:#eef6f2;padding:20px;border-radius:12px"><span style="color:#777;text-decoration:line-through">A$7/month</span><br><strong style="font-size:38px;color:#085041">A$0/month</strong><br>through 31 January 2027 (Adelaide time)</p>
<p><strong>Normally A$7/month — now A$0 until 31 January 2027.</strong></p>
<p>Sign in to your existing account, open <strong>Billing &amp; Payments</strong>, and select <strong>Get Plus for A$0</strong>.</p>${button(BILLING_URL, 'Get your free Plus offer')}
<p style="font-size:14px;color:#555">${terms}</p><p>We’d love to welcome you back.</p>`
  const footer = `<p style="font-size:12px;color:#666">You’re receiving this invitation as an iDogs account holder.<br><a href="${escape(unsubscribe)}" style="color:#085041">Unsubscribe from promotional emails</a></p>`
  const text = `Hi ${firstName || 'there'},\n\nThere’s something new waiting for you at iDogs.\n\niDogs Plus is A$0/month through 31 January 2027 (Adelaide time). Normally A$7/month.\n\nKeep your dogs’ records organised with:\n- Up to 5 dogs, with health records and documents in one place.\n- 10 iDogs Document Scans each month.\n- Breeder tools, including 2 litters per rolling 12 months.\n- PDF and CSV report exports.\n\nSign in to your existing account, open Billing & Payments, and select Get Plus for A$0.\nGet your free Plus offer: ${BILLING_URL}\n\n${terms}\n\nWe’d love to welcome you back.\n\nThe iDogs Team\nFor Australian dog owners and breeders\nhttps://idogs.com.au\n\nUnsubscribe from promotional emails: ${unsubscribe}`
  return { from: 'iDogs <noreply@idogs.com.au>', subject, html: shell({ title: subject, name: firstName, content, footer }), text }
}

// Review copy only: Stripe native is the sole active sender. No app scheduler
// or provider call is installed by this pack. Billing is a durable sign-in
// destination; it creates an owner-authenticated portal link when requested.
export function renewalEmail({ firstName = '', manageUrl = BILLING_URL } = {}) {
  const url = safeUrl(manageUrl)
  const subject = 'Your free iDogs Plus period ends soon — A$7/month from 1 February'
  const content = `<h1 style="font-size:28px;line-height:1.3">Your free Plus period ends soon</h1><p>We hope iDogs Plus has helped you keep your dogs’ records organised.</p>
<p>This is a reminder that your free Plus period ends on <strong>31 January 2027 (Adelaide time)</strong>.</p>
<p style="background:#eef6f2;padding:20px;border-radius:12px"><strong>Your next payment</strong><br><strong style="font-size:30px">A$7/month</strong>, including GST<br>First payment: <strong>1 February 2027 (Adelaide time)</strong><br>Payment method: your saved payment method</p>
<p>Your subscription continues automatically. You don’t need to do anything to keep Plus.</p><p>To avoid the first monthly charge, <strong>cancel before 1 February 2027 (Adelaide time)</strong>. You’ll keep Plus until the free period ends.</p>
${button(url, 'Manage or cancel subscription')}<p>Or sign in to iDogs, open <strong>Billing &amp; Payments</strong>, then select <strong>Manage subscription</strong>.</p><p style="font-size:14px;color:#555">This notice concerns your Plus subscription. Separately purchased SMS and extra litters are additional charges.</p>`
  const text = `Hi ${firstName || 'there'},\n\nWe hope iDogs Plus has helped you keep your dogs’ records organised.\n\nYour free Plus period ends on 31 January 2027 (Adelaide time).\n\nYour next payment:\nAmount: A$7/month, including GST.\nFirst payment: 1 February 2027 (Adelaide time).\nPayment method: your saved payment method.\n\nYour subscription continues automatically. You don’t need to do anything to keep Plus.\n\nTo avoid the first monthly charge, cancel before 1 February 2027 (Adelaide time). You’ll keep Plus until the free period ends.\n\nManage or cancel subscription: ${url}\nOr sign in to iDogs → Billing & Payments → Manage subscription.\n\nThis notice concerns your Plus subscription. Separately purchased SMS and extra litters are additional charges.\n\nThe iDogs Team\nhttps://idogs.com.au`
  return { from: 'iDogs <noreply@idogs.com.au>', subject, html: shell({ title: subject, name: firstName, content, footer: '' }), text, channel: REMINDER_CHANNEL, draftOnly: true }
}

// This is an operator-reviewed snapshot format, NOT fields added to users/{uid}.
// Explicit evidence is required; an account signup or care reminder preference
// is never a proxy for marketing permission. No contacts are emitted or sent.
export function invitationDecision(row, now = Date.now()) {
  if (!isPlusPromotionActive(now) || PLUS_PROMOTION_END - now <= 32 * 60_000) return 'campaign-closed'
  if (!row || typeof row !== 'object') return 'hold-incomplete'
  if (row.marketingPermission === 'denied' || row.suppressed === true) return 'excluded-opt-out'
  if (row.qaOrInternal === true) return 'excluded-qa-internal'
  if (row.accountActive === false || row.deletionPending === true) return 'excluded-account'
  if (row.effectivePlan === 'plus' || row.currentSubscription === true || row.promotionPendingOrJoined === true) return 'excluded-billing'
  if (!validEmail(row.email) || row.emailVerified !== true) return 'hold-address'
  const checkedAt = Date.parse(row.checkedAt)
  if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > MAX_SNAPSHOT_AGE) return 'hold-stale'
  if (row.marketingPermission !== 'verified' || typeof row.permissionEvidence !== 'string' || !row.permissionEvidence.trim()) return 'hold-permission'
  if (row.suppressed !== false || row.qaOrInternal !== false || row.accountActive !== true || row.deletionPending !== false || row.effectivePlan !== 'free' || row.currentSubscription !== false || row.promotionPendingOrJoined !== false) return 'hold-incomplete'
  return 'eligible-for-owner-review'
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value)
}

export function audienceDryRun(rows, now = Date.now()) {
  if (!Array.isArray(rows)) throw new Error('Expected an array of normalized recipient snapshots')
  const frequencies = new Map()
  for (const row of rows) if (validEmail(row?.email)) {
    const key = row.email.toLowerCase()
    frequencies.set(key, (frequencies.get(key) || 0) + 1)
  }
  const counts = {}
  for (const row of rows) {
    // Hold every duplicate, even if one duplicate would otherwise be eligible.
    const reason = validEmail(row?.email) && frequencies.get(row.email.toLowerCase()) > 1 ? 'hold-duplicate' : invitationDecision(row, now)
    counts[reason] = (counts[reason] || 0) + 1
  }
  return { campaign: PLUS_PROMOTION_ID, mode: 'dry-run-no-send', total: rows.length, counts }
}
