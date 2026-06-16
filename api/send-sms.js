// api/send-sms.js — Send SMS via AWS SNS
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'

const sns = new SNSClient({
  region: process.env.AWS_SNS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_SNS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SNS_SECRET_ACCESS_KEY,
  },
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { phone, message } = req.body
  if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' })

  try {
    const command = new PublishCommand({
      Message: message,
      PhoneNumber: phone, // E.164 format: +61412345678
      MessageAttributes: {
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: 'iDogs',
        },
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional',
        },
      },
    })

    const result = await sns.send(command)
    return res.status(200).json({ success: true, messageId: result.MessageId })
  } catch (err) {
    console.error('SMS error:', err)
    return res.status(500).json({ error: 'Failed to send SMS', message: String(err) })
  }
}
