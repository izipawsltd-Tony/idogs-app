export interface SmsDisplayState {
  status?: string | null
  creditsUsed?: number
  creditsLimit?: number
  periodStart?: string | null
  periodEnd?: string | null
  emailReminders?: boolean
  phone?: string | null
}

// Display only. Server entitlement/quota checks remain authoritative.
export function smsDeliveryStatus(sms: SmsDisplayState, now = Date.now()) {
  const used = Number.isInteger(sms.creditsUsed) && sms.creditsUsed! >= 0 ? sms.creditsUsed! : 0
  const limit = Number.isInteger(sms.creditsLimit) && sms.creditsLimit! >= 0 ? sms.creditsLimit! : 20
  const remaining = Math.max(0, limit - used)
  const start = typeof sms.periodStart === 'string' ? Date.parse(sms.periodStart) : NaN
  const end = typeof sms.periodEnd === 'string' ? Date.parse(sms.periodEnd) : NaN
  let message: string
  let eligible = false
  if (sms.status !== 'active') message = 'SMS add-on is not active.'
  else if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    message = 'Scheduled SMS paused: the billing period is unavailable. Check Billing.'
  } else if (now < start) message = 'Scheduled SMS paused: the billing period has not started.'
  else if (now >= end) message = 'Scheduled SMS paused: the billing period has ended. Check Billing for renewal status.'
  else if (remaining === 0) message = 'Scheduled SMS paused: no credits remain in this billing period.'
  else if (sms.emailReminders === false) message = 'Scheduled SMS paused: Email Reminders is switched off in Settings.'
  else if (!/^(?:04\d{8}|\+?614\d{8})$/.test((sms.phone || '').trim().replace(/[\s()-]/g, ''))) {
    message = 'Scheduled SMS paused: add a valid Australian mobile number in Settings.'
  } else {
    eligible = true
    message = 'Eligible scheduled reminders can use SMS. A due reminder and successful delivery are still required.'
  }
  return { used, limit, remaining, eligible, message }
}
