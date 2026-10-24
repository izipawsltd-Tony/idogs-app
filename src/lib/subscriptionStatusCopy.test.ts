import { describe, expect, it } from 'vitest'
import { subscriptionStatusCopy } from './subscriptionStatusCopy'
const trial = { status: 'trialing', cancelAtPeriodEnd: false, currentPeriodEnd: '2027-01-31T13:30:00Z' }
describe('Native read-only subscription status', () => {
  it('labels a legacy trial without falsely claiming renewal or promotion', () => {
    expect(subscriptionStatusCopy(trial)).toEqual({ label: 'Trial ends', date: trial.currentPeriodEnd, promotion: null })
  })
  it('uses the explicit provider trial date when supplied', () => {
    expect(subscriptionStatusCopy({ ...trial, trialEnd: '2027-01-01T00:00:00Z' }).date).toBe('2027-01-01T00:00:00Z')
  })
  it('prioritises verified cancellation over trial or renewal wording', () => {
    expect(subscriptionStatusCopy({ ...trial, cancelAtPeriodEnd: true }).label).toBe('Access scheduled to end')
  })
  it('shows confirmed promotion only from explicit server confirmation, without purchase steering', () => {
    const copy = subscriptionStatusCopy({ ...trial, promotionStatus: 'confirmed' })
    expect(copy.promotion).toContain('is confirmed')
    expect(copy.promotion).not.toMatch(/\$|checkout|stripe|upgrade|https:/i)
  })
  it('does not invent promotional entitlement for an unconfirmed subscription', () => {
    expect(subscriptionStatusCopy({ ...trial, promotionStatus: 'not_confirmed' }).promotion).toContain('not confirmed')
  })
  it('retains ordinary renewal and unavailable-date behaviour', () => {
    expect(subscriptionStatusCopy({ ...trial, status: 'active', currentPeriodEnd: null })).toEqual({ label: 'Next renewal', date: null, promotion: null })
  })
})
