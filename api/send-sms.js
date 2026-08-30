// api/send-sms.js — trusted internal SMS relay through the configured provider.
// V1 deliberately rejects browser/user-originated arbitrary SMS sends.
import { checkCronAuth } from './_lib/cron-auth.js'
import { sendSmsProvider, getSmsProviderName } from './_lib/sms-provider.js'

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

  try {
    const result = await sendSmsProvider(phone, message)
    return res.status(200).json({ success: true, provider: getSmsProviderName(), messageId: result.MessageId })
  } catch (error) {
    console.error('send-sms: provider send failed', String(error?.code || 'PROVIDER_FAILED'))
    return res.status(502).json({ error: 'Failed to send SMS' })
  }
}
