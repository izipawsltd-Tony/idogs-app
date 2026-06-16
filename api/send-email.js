// api/send-email.js — Vercel serverless function
// Sends email via Resend API

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { to_email, to_name, subject, message, action_url } = req.body

  if (!to_email || !subject || !message) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'iDogs <noreply@idogs.com.au>',
        to: [to_email],
        subject: subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1A1917;">
            <div style="margin-bottom: 24px;">
              <span style="display: inline-block; background: #085041; color: white; font-size: 14px; font-weight: 600; padding: 6px 14px; border-radius: 20px;">🐾 iDogs</span>
            </div>
            <p style="font-size: 16px; color: #5C5A54; margin-bottom: 20px;">Hi ${to_name || 'there'},</p>
            <div style="font-size: 15px; line-height: 1.7; color: #1A1917; white-space: pre-line; margin-bottom: 24px;">${message}</div>
            ${action_url ? `<div style="margin-bottom: 32px;"><a href="${action_url}" style="display: inline-block; background: #085041; color: white; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 10px; text-decoration: none;">Open iDogs →</a></div>` : ''}
            <hr style="border: none; border-top: 1px solid #E2DFD8; margin: 24px 0;" />
            <p style="font-size: 12px; color: #9A9891;">iDogs · Every dog's story, forever · <a href="https://idogs.com.au" style="color: #085041;">idogs.com.au</a></p>
          </div>
        `,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      console.error('Resend error:', error)
      return res.status(500).json({ error: 'Failed to send email', details: error })
    }

    const data = await response.json()
    return res.status(200).json({ success: true, id: data.id })

  } catch (err) {
    console.error('Server error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
