// api/_lib/sms-provider.js — server-only SMS provider adapter.
// Provider selection is explicit via SMS_PROVIDER. Existing production remains
// on AWS SNS until env is deliberately changed to clicksend.

const PROVIDERS = new Set(['aws_sns', 'clicksend'])

function providerError(code, message = code) {
  const error = new Error(message)
  error.code = code
  return error
}

export function getSmsProviderName(env = process.env) {
  const name = String(env.SMS_PROVIDER || 'aws_sns').trim().toLowerCase()
  if (!PROVIDERS.has(name)) throw providerError('SMS_PROVIDER_UNSUPPORTED')
  return name
}

export function smsProviderConfigStatus(env = process.env) {
  let provider
  try { provider = getSmsProviderName(env) } catch {
    return { provider: 'unsupported', configured: false }
  }

  if (provider === 'clicksend') {
    return {
      provider,
      configured: Boolean(env.CLICKSEND_USERNAME && env.CLICKSEND_API_KEY),
      senderIdConfigured: Boolean(env.CLICKSEND_SENDER_ID),
    }
  }

  return {
    provider,
    configured: Boolean(env.AWS_SNS_ACCESS_KEY_ID && env.AWS_SNS_SECRET_ACCESS_KEY),
    senderIdConfigured: true,
  }
}

async function sendClickSend(phone, message, { env, fetchImpl }) {
  const username = String(env.CLICKSEND_USERNAME || '').trim()
  const apiKey = String(env.CLICKSEND_API_KEY || '').trim()
  if (!username || !apiKey) throw providerError('CLICKSEND_NOT_CONFIGURED')

  const sms = {
    source: String(env.CLICKSEND_SOURCE || 'iDogs').trim() || 'iDogs',
    body: message,
    to: phone,
  }
  const senderId = String(env.CLICKSEND_SENDER_ID || '').trim()
  if (senderId) sms.from = senderId

  const auth = Buffer.from(`${username}:${apiKey}`, 'utf8').toString('base64')
  const response = await fetchImpl('https://rest.clicksend.com/v3/sms/send', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [sms] }),
  })

  let payload = null
  try { payload = await response.json() } catch {}
  if (!response.ok || payload?.response_code !== 'SUCCESS') {
    throw providerError(`CLICKSEND_${response.status || 'ERROR'}`)
  }

  const messages = payload?.data?.messages
  const first = Array.isArray(messages) ? messages[0] : null
  const messageId = first?.message_id || first?.messageId || payload?.data?.message_id || null
  if (!messageId) throw providerError('CLICKSEND_MESSAGE_ID_MISSING')

  return {
    MessageId: String(messageId),
    provider: 'clicksend',
    providerStatus: first?.status || null,
  }
}

async function sendAwsSns(phone, message, { env }) {
  const { SNSClient, PublishCommand } = await import('@aws-sdk/client-sns')
  if (!env.AWS_SNS_ACCESS_KEY_ID || !env.AWS_SNS_SECRET_ACCESS_KEY) {
    throw providerError('AWS_SNS_NOT_CONFIGURED')
  }
  const sns = new SNSClient({
    region: env.AWS_SNS_REGION || 'ap-southeast-2',
    credentials: {
      accessKeyId: env.AWS_SNS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SNS_SECRET_ACCESS_KEY,
    },
  })
  return sns.send(new PublishCommand({
    Message: message,
    PhoneNumber: phone,
    MessageAttributes: {
      'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: 'iDogs' },
      'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
    },
  }))
}

export async function sendSmsProvider(phone, message, options = {}) {
  const env = options.env || process.env
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const provider = getSmsProviderName(env)
  if (provider === 'clicksend') {
    if (typeof fetchImpl !== 'function') throw providerError('FETCH_UNAVAILABLE')
    return sendClickSend(phone, message, { env, fetchImpl })
  }
  return sendAwsSns(phone, message, { env })
}
