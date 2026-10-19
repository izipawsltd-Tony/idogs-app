// src/lib/email.ts
// Sends email via Vercel serverless /api/send-email (Resend backend)

import { getAuth } from 'firebase/auth'
import { buildTransferEmailMessage, TRANSFER_EMAIL_ACTION_LABEL, TRANSFER_EMAIL_ACTION_URL } from './transferEmailCopy'

async function sendEmail(params: {
  to_email: string
  to_name: string
  subject: string
  message: string
  action_url?: string
  action_label?: string
}) {
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
  buyerEmail: string
  buyerName: string
  dogName: string
  breed: string
  breederName: string
}) {
  return sendEmail({
    to_email: params.buyerEmail,
    to_name: params.buyerName,
    subject: `${params.breederName} has transferred ${params.dogName} to you on iDogs`,
    message: buildTransferEmailMessage(params),
    action_url: TRANSFER_EMAIL_ACTION_URL,
    action_label: TRANSFER_EMAIL_ACTION_LABEL,
  })
}

export async function sendReminderEmail(params: {
  ownerEmail: string
  ownerName: string
  date: string
  reminders: string
}) {
  return sendEmail({
    to_email: params.ownerEmail,
    to_name: params.ownerName,
    subject: `iDogs — Upcoming reminders for ${params.date}`,
    message: `You have upcoming reminders:\n\n${params.reminders}`,
    action_url: 'https://idogs.com.au/app/reminders',
  })
}
