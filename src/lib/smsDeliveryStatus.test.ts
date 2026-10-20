import { describe, expect, it } from 'vitest'
import { smsDeliveryStatus } from './smsDeliveryStatus'

const now = Date.parse('2026-10-21T00:00:00Z')
const sms = { status: 'active', creditsUsed: 0, creditsLimit: 1, phone: '0400 000 000',
  periodStart: '2026-10-21T00:00:00Z', periodEnd: '2026-10-22T00:00:00Z', emailReminders: true }

describe('SMS delivery display uses actual entitlement and current period', () => {
  it('shows the QA one-credit limit instead of the normal paid allowance', () => {
    expect(smsDeliveryStatus(sms, now)).toMatchObject({ used: 0, limit: 1, remaining: 1, eligible: true })
  })
  it('treats the start as inclusive and the end as exclusive', () => {
    expect(smsDeliveryStatus(sms, now - 1).message).toContain('has not started')
    expect(smsDeliveryStatus(sms, now).eligible).toBe(true)
    expect(smsDeliveryStatus(sms, Date.parse(sms.periodEnd) - 1).eligible).toBe(true)
    expect(smsDeliveryStatus(sms, Date.parse(sms.periodEnd)).message).toContain('has ended')
  })
  it('never describes an expired active entitlement as eligible', () => {
    expect(smsDeliveryStatus({ ...sms, creditsUsed: 1 }, Date.parse(sms.periodEnd))).toMatchObject({ eligible: false, remaining: 0 })
  })
  it.each(['inactive', 'past_due', 'cancelled', undefined])('blocks readiness for status %s', status => {
    expect(smsDeliveryStatus({ ...sms, status }, now).eligible).toBe(false)
  })
  it.each([{ periodStart: null }, { periodEnd: 'invalid' }, { periodStart: '2026-10-23T00:00:00Z' }])('reports missing or inverted dates honestly: %j', period => {
    expect(smsDeliveryStatus({ ...sms, ...period }, now).message).toContain('period is unavailable')
  })
  it('reports exhausted credits without promising an email while email is off', () => {
    const result = smsDeliveryStatus({ ...sms, creditsUsed: 2, emailReminders: false }, now)
    expect(result.remaining).toBe(0); expect(result.message).toContain('no credits remain')
    expect(result.message).not.toContain('Email reminders continue')
  })
  it('explains that the existing email master also pauses scheduled SMS', () => {
    expect(smsDeliveryStatus({ ...sms, emailReminders: false }, now).message).toContain('Email Reminders is switched off')
  })
  it.each(['0400000000', '+61400000000', '61400000000', '(0400) 000-000'])('accepts supported AU mobile form %s', phone => {
    expect(smsDeliveryStatus({ ...sms, phone }, now).eligible).toBe(true)
  })
  it.each([null, '', '0881234567', '+15551234567'])('explains an unusable mobile %s', phone => {
    expect(smsDeliveryStatus({ ...sms, phone }, now).message).toContain('valid Australian mobile')
  })
})
