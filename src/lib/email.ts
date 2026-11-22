// src/lib/email.ts
// Sends email via Vercel serverless /api/send-email (Resend backend).
//
// SECURITY: the endpoint no longer accepts a caller-chosen recipient,
// subject, body or link from signed-in users. The browser only names
// WHICH email it wants (`kind`) plus the minimum context; the server
// builds the recipient and content itself:
//   - 'transfer'        → recipient = the dog's pending buyerEmail, only for
//                          a dog the caller has just transferred
//   - 'reminder_digest' → recipient = the caller's own verified email

import { getAuth } from 'firebase/auth'

async function postEmail(params: Record<string, unknown>) {
  const currentUser = getAuth().currentUser
  if (!currentUser) {
    throw new Error('Must be signed in to send email')
  }
  const idToken = await currentUser.getIdToken()

  const res = await fetch('/api/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to send email')
  }
  return res.json()
}

export async function sendTransferEmail(params: {
  dogId: string
  buyerEmail: string
  buyerName: string
  dogName: string
  breed: string
  breederName: string
}) {
  // buyerEmail/dogName/breed are kept in the signature for callers, but the
  // server reads them from the dog's pending-transfer record, never from here.
  return postEmail({
    kind: 'transfer',
    dogId: params.dogId,
    to_name: params.buyerName,
    breederName: params.breederName,
  })
}

export async function sendReminderEmail(params: {
  ownerEmail: string
  ownerName: string
  date: string
  reminders: string
}) {
  // Always delivered to the signed-in user's own verified email (server-side).
  return postEmail({
    kind: 'reminder_digest',
    to_name: params.ownerName,
    date: params.date,
    reminders: params.reminders,
  })
}
