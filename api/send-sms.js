// api/send-sms.js — trusted internal SMS relay via AWS SNS.
// V1 deliberately rejects browser/user-originated arbitrary SMS sends.
// The reminder engine sends structured, server-generated messages only.
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { checkCronAuth } from './_lib/cron-auth.js'

const sns = new SNSClient({
  region: process.env.AWS_SNS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_SNS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SNS_SECRET_ACCESS_KEY,
  },
})

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
    const result = await sns.send(new PublishCommand({
      Message: message,
      PhoneNumber: phone,
      MessageAttributes: {
        'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: 'iDogs' },
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    }))
    return res.status(200).json({ success: true, messageId: result.MessageId })
  } catch {
    console.error('send-sms: provider send failed')
    return res.status(502).json({ error: 'Failed to send SMS' })
  }
}
