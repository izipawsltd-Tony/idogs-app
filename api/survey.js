// api/survey.js — Save survey response to Firestore + send notification email
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const db = getFirestore()

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { name, email, state, ankc, dogCount, litterCount, tools, toolsOther,
          headache, missingRecords, wtp, softwareBefore, softwareWhich, source } = req.body

  if (!name || !email) return res.status(400).json({ error: 'Name and email required' })

  try {
    // Check duplicate email
    const existing = await db.collection('surveyResponses').where('email', '==', email).get()
    if (!existing.empty) {
      return res.status(409).json({ error: 'duplicate', message: 'This email has already submitted a survey response.' })
    }

    // Save to Firestore
    const docRef = await db.collection('surveyResponses').add({
      name, email, state, ankc, dogCount, litterCount,
      tools, toolsOther, headache, missingRecords, wtp,
      softwareBefore, softwareWhich, source: source || 'landing',
      status: 'pending', // pending → approved → code_sent
      promoCode: null,
      createdAt: FieldValue.serverTimestamp(),
    })

    // Send notification to Tony
    const { RESEND_API_KEY } = process.env
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'iDogs Survey <noreply@idogs.com.au>',
          to: 'info@izipaws.com.au',
          subject: `🐾 New survey response — ${name} (${state})`,
          html: `
            <h2>New iDogs Survey Response</h2>
            <table style="border-collapse:collapse;width:100%">
              <tr><td><strong>Name</strong></td><td>${name}</td></tr>
              <tr><td><strong>Email</strong></td><td>${email}</td></tr>
              <tr><td><strong>State</strong></td><td>${state}</td></tr>
              <tr><td><strong>ANKC Registered</strong></td><td>${ankc}</td></tr>
              <tr><td><strong>Dogs owned/bred</strong></td><td>${dogCount}</td></tr>
              <tr><td><strong>Litters/year</strong></td><td>${litterCount}</td></tr>
              <tr><td><strong>Tools used</strong></td><td>${tools?.join(', ')} ${toolsOther ? '— ' + toolsOther : ''}</td></tr>
              <tr><td><strong>Biggest headache</strong></td><td>${headache}</td></tr>
              <tr><td><strong>Missing records issue</strong></td><td>${missingRecords}</td></tr>
              <tr><td><strong>WTP if saves 2hrs/week</strong></td><td>${wtp}</td></tr>
              <tr><td><strong>Used software before</strong></td><td>${softwareBefore} ${softwareWhich ? '— ' + softwareWhich : ''}</td></tr>
              <tr><td><strong>Source</strong></td><td>${source || 'landing'}</td></tr>
              <tr><td><strong>Response ID</strong></td><td>${docRef.id}</td></tr>
            </table>
            <br/>
            <a href="https://idogs.com.au/app/admin/survey" style="background:#085041;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">
              Review in Admin Panel →
            </a>
          `,
        }),
      })
    }

    // Send confirmation to breeder
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'iDogs Team <noreply@idogs.com.au>',
          to: email,
          subject: 'Thanks for your feedback — your 3 months free is coming!',
          html: `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
              <div style="background:#085041;padding:24px;border-radius:12px 12px 0 0;text-align:center">
                <span style="font-size:32px">🐾</span>
                <h1 style="color:#fff;font-size:22px;margin:8px 0 0">Thank you, ${name}!</h1>
              </div>
              <div style="background:#fff;padding:28px;border:1px solid #E2DFD8;border-top:none;border-radius:0 0 12px 12px">
                <p style="color:#5C5A54;font-size:15px;line-height:1.6">
                  Your feedback is incredibly valuable to us. We are building iDogs for Australian breeders like you, and your experience helps us get it right.
                </p>
                <p style="color:#5C5A54;font-size:15px;line-height:1.6">
                  We will personally review your responses and send you a <strong>3-month free promo code</strong> within 24 hours.
                </p>
                <div style="background:#E1F5EE;border-radius:10px;padding:16px;margin:20px 0">
                  <p style="color:#085041;font-size:14px;margin:0">
                    💡 In the meantime, you can <a href="https://idogs.com.au/signup" style="color:#085041;font-weight:600">create your free account</a> and start adding your dogs — no credit card required.
                  </p>
                </div>
                <p style="color:#9A9891;font-size:13px">
                  Tony Ngo<br/>
                  Founder, iDogs · iziPaws Pty Ltd<br/>
                  info@izipaws.com.au
                </p>
              </div>
            </div>
          `,
        }),
      })
    }

    return res.status(200).json({ success: true, id: docRef.id })
  } catch (err) {
    console.error('Survey error:', err)
    return res.status(500).json({ error: 'Failed to save survey', message: String(err) })
  }
}
