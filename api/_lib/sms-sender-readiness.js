// Prevent accidental SMS sends while ACMA/provider/account readiness is unverified.
// Read-only QA and tests do not call an SMS provider.
export const ACMA_APPROVED_SENDER_ID = 'iDogs'
export function smsSendGate(env = process.env) {
  if (env.SMS_SENDING_ENABLED !== 'true') return { ready: false, reason: 'SMS_SENDING_DISABLED' }
  if (env.SMS_SENDER_ID !== ACMA_APPROVED_SENDER_ID) return { ready: false, reason: 'SMS_SENDER_ID_UNVERIFIED' }
  if (env.AWS_SNS_REGION !== 'ap-southeast-2') return { ready: false, reason: 'SMS_REGION_UNVERIFIED' }
  if (env.SMS_PROVIDER_ACCOUNT_VERIFIED !== 'true') return { ready: false, reason: 'SMS_PROVIDER_ACCOUNT_UNVERIFIED' }
  return { ready: true, senderId: ACMA_APPROVED_SENDER_ID }
}
