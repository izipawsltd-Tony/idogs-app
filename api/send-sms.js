// api/send-sms.js — trusted internal SMS relay via ClickSend.
// V1 deliberately rejects browser/user-originated arbitrary SMS sends.
// The reminder engine sends structured, server-generated messages only.
import { sendClickSendSms } from './_lib/clicksend-sms.js'
import { checkCronAuth } from './_lib/cron-auth.js'
import { smsSendGate } from './_lib/sms-sender-readiness.js'


export default async function handler(req, res) {
  const auth = checkCronAuth(req)
  if (!auth.authorized) return res.status(auth.status).json(auth.body)
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { phone, message } = typeof req.body === 'string'
    ? (() => { try { return JSON.parse(req.body || '{}') } catch { return {} } })()
    : (req.body || {})

  if (typeof phone !== 'string' || typeof message !== 'string' || !phone || !message) {
    return res.status(400).json({ error: 'Missing phone or message' })
  }
  if (!/^\+614\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Australian mobile number required' })
  }
  if (message.length > 459) {
    return res.status(400).json({ error: 'Message too long' })
  }

  const gate = smsSendGate()
  if (!gate.ready) return res.status(503).json({ error: gate.reason })

  try {
    const result = await sendClickSendSms(phone, message)
    return res.status(200).json({ success: true, messageId: result.MessageId })
  } catch {
    console.error('send-sms: provider send failed')
    return res.status(502).json({ error: 'Failed to send SMS' })
  }
}
