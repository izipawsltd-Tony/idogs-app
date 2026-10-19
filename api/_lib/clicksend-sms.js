// Server-only transport. No automatic retries: a timed-out POST may be queued.
export const SMS_PROVIDER = 'clicksend'

export class SmsProviderError extends Error {
  constructor(code, definitive = false) {
    super(code)
    this.code = code
    this.definitive = definitive
  }
}

export async function sendClickSendSms(phone, message, { deliveryId } = {}, {
  env = process.env, fetchImpl = fetch,
} = {}) {
  const username = env.CLICKSEND_USERNAME?.trim()
  const apiKey = env.CLICKSEND_API_KEY?.trim()
  if (!username || !apiKey) throw new SmsProviderError('SMS_NOT_CONFIGURED', true)
  if (!/^\+614\d{8}$/.test(phone) || typeof message !== 'string' || !message.trim() || message.length > 459) {
    throw new SmsProviderError('INVALID_SMS_REQUEST', true)
  }

  const sms = { source: 'idogs', to: phone, body: message }
  if (deliveryId) sms.custom_string = deliveryId
  // Use the account's approved default sender; never assume an alpha tag is approved.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetchImpl('https://rest.clicksend.com/v3/sms/send', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
        'Content-Type': 'application/json', Accept: 'application/json',
      },
      body: JSON.stringify({ messages: [sms] }),
    })
    // Auth rejection proves the send did not run. Other HTTP/malformed outcomes
    // remain ambiguous; do not refund/retry an SMS that may already be queued.
    if (response.status === 401 || response.status === 403) {
      throw new SmsProviderError('SMS_AUTH_REJECTED', true)
    }
    if (!response.ok) throw new SmsProviderError('SMS_DELIVERY_UNKNOWN')
    const payload = await response.json()
    const messages = payload?.data?.messages
    const item = Array.isArray(messages) && messages.length === 1 ? messages[0] : null
    if (payload?.response_code === 'SUCCESS' && item?.status === 'SUCCESS' &&
        typeof item.message_id === 'string' && item.message_id.trim()) {
      return { provider: SMS_PROVIDER, providerMessageId: item.message_id, accepted: true }
    }
    const rejected = new Set(['INVALID_RECIPIENT', 'INVALID_SENDER_ID', 'INSUFFICIENT_CREDIT',
      'ACCOUNT_NOT_ACTIVATED', 'INVALID_CREDENTIALS', 'MISSING_CREDENTIALS', 'COUNTRY_NOT_ENABLED'])
    if (rejected.has(item?.status) || (!item && rejected.has(payload?.response_code))) {
      throw new SmsProviderError('SMS_PROVIDER_REJECTED', true)
    }
    throw new SmsProviderError('SMS_DELIVERY_UNKNOWN')
  } catch (error) {
    if (error instanceof SmsProviderError) throw error
    // Never expose the provider response, recipient, body, or credentials in errors.
    throw new SmsProviderError('SMS_DELIVERY_UNKNOWN')
  } finally {
    clearTimeout(timer)
  }
}
