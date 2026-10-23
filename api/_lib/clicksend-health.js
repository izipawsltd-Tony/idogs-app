// Read-only ClickSend diagnostics. Never send messages or expose provider response/PII.
export async function verifyClickSendAccount({ env = process.env, fetchImpl = fetch } = {}) {
  if (!env.CLICKSEND_USERNAME || !env.CLICKSEND_API_KEY) return { ok:false, reason:'CLICKSEND_CREDENTIALS_MISSING' }
  try {
    const response = await fetchImpl('https://rest.clicksend.com/v3/account', {
      method:'GET',
      headers:{ Authorization:'Basic '+Buffer.from(env.CLICKSEND_USERNAME+':'+env.CLICKSEND_API_KEY).toString('base64') },
      signal: AbortSignal.timeout(10000),
    })
    if (response.status === 401 || response.status === 403) return { ok:false, reason:'CLICKSEND_AUTH_DENIED' }
    if (!response.ok) return { ok:false, reason:'CLICKSEND_ACCOUNT_UNAVAILABLE' }
    const body = await response.json()
    return body?.response_code === 'SUCCESS'
      ? { ok:true, reason:'CLICKSEND_ACCOUNT_AUTHENTICATED' }
      : { ok:false, reason:'CLICKSEND_ACCOUNT_NOT_READY' }
  } catch { return { ok:false, reason:'CLICKSEND_NETWORK_ERROR' } }
}
