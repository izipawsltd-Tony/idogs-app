// api/send-email.js — Vercel serverless function
// Sends email via Resend API.
//
// Auth and content rules live in api/_lib/send-email-handler.js:
//   - x-cron-secret (api/send-reminders.js): server-composed reminder emails;
//   - signed-in users: ONLY server-built 'transfer' (to the dog's pending
//     buyer, for a dog the caller just transferred) and 'reminder_digest'
//     (to the caller's own verified email). No caller-chosen recipient,
//     subject, HTML or link — this endpoint used to be an open relay.

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createSendEmailHandler } from './_lib/send-email-handler.js'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export default createSendEmailHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  getDog: async dogId => {
    const snap = await getFirestore().collection('dogs').doc(dogId).get()
    return snap.exists ? snap.data() : null
  },
  sendEmail: async payload => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    return response.ok ? { ok: true, id: data.id } : { ok: false, error: data }
  },
})
