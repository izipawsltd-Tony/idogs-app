// src/lib/email.ts
// Sends email via Vercel serverless /api/send-email (Resend backend)

async function sendEmail(params: {
  to_email: string
  to_name: string
  subject: string
  message: string
  action_url?: string
}) {
  const res = await fetch('/api/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  passportUrl: string
}) {
  return sendEmail({
    to_email: params.buyerEmail,
    to_name: params.buyerName,
    subject: `${params.breederName} has transferred ${params.dogName} to you on iDogs`,
    message: `${params.breederName} has transferred ownership of ${params.dogName} (${params.breed}) to you.\n\nView ${params.dogName}'s passport here:\n${params.passportUrl}\n\nTo claim full ownership and manage ${params.dogName}'s profile, create your free iDogs account — the dog will appear automatically in your dashboard.`,
    action_url: 'https://idogs.com.au/signup',
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
