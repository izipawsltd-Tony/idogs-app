// ClickSend v3 transport. Caller must pass sender-readiness gate before invoking.
const URL = 'https://rest.clicksend.com/v3/sms/send'
export class SmsProviderError extends Error {
  constructor(code, ambiguous = false) { super(code); this.name = 'SmsProviderError'; this.code = code; this.ambiguous = ambiguous }
}
export async function sendClickSendSms(phone, body, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.CLICKSEND_USERNAME || !env.CLICKSEND_API_KEY) throw new SmsProviderError('CLICKSEND_CONFIG_MISSING')
  if (!/^\\+614\\d{8}$/.test(phone) || typeof body !== 'string' || !body.trim() || body.length > 459)
    throw new SmsProviderError('INVALID_SMS_REQUEST')
  let response
  try {
    response = await fetchImpl(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(env.CLICKSEND_USERNAME + ':' + env.CLICKSEND_API_KEY).toString('base64'),
      },
      body: JSON.stringify({ messages: [{ source: 'nodejs', body, to: phone, from: 'iDogs' }] }),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    // Transport timeout/error after request submission may mean provider already queued it.
    // Never refund/retry blindly because this can double-send a chargeable SMS.
    throw new SmsProviderError('CLICKSEND_OUTCOME_UNKNOWN', true)
  }
  if (!response.ok) throw new SmsProviderError('CLICKSEND_HTTP_REJECTED')
  let result
  try { result = await response.json() }
  catch { throw new SmsProviderError('CLICKSEND_RESPONSE_UNREADABLE', true) }
  const msg = result?.data?.messages?.[0]
  if (result.response_code !== 'SUCCESS' || result.data?.queued_count !== 1 ||
      result.data?.blocked_count !== 0 ||
      (typeof msg?.status === 'string' && msg.status !== 'SUCCESS')) {
    throw new SmsProviderError('CLICKSEND_MESSAGE_REJECTED')
  }
  if (!msg?.message_id) throw new SmsProviderError('CLICKSEND_MISSING_MESSAGE_ID', true)
  return { MessageId: msg.message_id, queued: true }
}
