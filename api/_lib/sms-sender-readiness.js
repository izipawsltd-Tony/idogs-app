// Fail closed until ClickSend iDogs sender authorization is explicitly confirmed.
export const ACMA_APPROVED_SENDER_ID = 'iDogs'
export function smsSendGate(env = process.env) {
  if (env.SMS_SENDING_ENABLED !== 'true') return { ready:false, reason:'SMS_SENDING_DISABLED' }
  if (env.SMS_PROVIDER !== 'clicksend') return { ready:false, reason:'SMS_PROVIDER_UNVERIFIED' }
  if (env.SMS_SENDER_ID !== ACMA_APPROVED_SENDER_ID) return { ready:false, reason:'SMS_SENDER_ID_UNVERIFIED' }
  if (env.SMS_PROVIDER_ACCOUNT_VERIFIED !== 'true') return { ready:false, reason:'SMS_PROVIDER_ACCOUNT_UNVERIFIED' }
  if (!env.CLICKSEND_USERNAME || !env.CLICKSEND_API_KEY) return { ready:false, reason:'CLICKSEND_CREDENTIALS_MISSING' }
  return { ready:true, senderId:ACMA_APPROVED_SENDER_ID }
}
