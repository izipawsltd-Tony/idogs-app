// ClickSend v3 transport. No outbound request without explicit caller readiness gate.
const URL = 'https://rest.clicksend.com/v3/sms/send'
export async function sendClickSendSms(phone, body, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.CLICKSEND_USERNAME || !env.CLICKSEND_API_KEY) throw new Error('CLICKSEND_CONFIG_MISSING')
  if (!/^\+614\d{8}$/.test(phone) || typeof body !== 'string' || !body.trim() || body.length > 459)
    throw new Error('INVALID_SMS_REQUEST')
  const response = await fetchImpl(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(env.CLICKSEND_USERNAME + ':' + env.CLICKSEND_API_KEY).toString('base64'),
    },
    body: JSON.stringify({ messages: [{ source: 'nodejs', body, to: phone, from: 'iDogs' }] }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('CLICKSEND_HTTP_ERROR')
  const result = await response.json()
  const msg = result?.data?.messages?.[0]
  // ClickSend can return HTTP 200 with per-message failures.
  if (result.response_code !== 'SUCCESS' || result.data?.queued_count !== 1 ||
      result.data?.blocked_count !== 0 || !msg?.message_id ||
      (typeof msg.status === 'string' && msg.status !== 'SUCCESS')) {
    throw new Error('CLICKSEND_MESSAGE_NOT_QUEUED')
  }
  return { MessageId: msg.message_id, queued: true }
}
