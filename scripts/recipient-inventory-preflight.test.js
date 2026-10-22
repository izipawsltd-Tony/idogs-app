import { describe, it, expect } from 'vitest'
import { reconcileRecipientInventory, MARKETING_CONSENT_CONTRACT } from './recipient-inventory-preflight.mjs'
const now = Date.parse('2026-10-23T01:00:00Z')
const capturedAt = new Date(now).toISOString()
const good = () => ({
  capturedAt,
  auth: [{ uid:'u1', email:'member@example.invalid', emailVerified:true, disabled:false }],
  profiles: [{ uid:'u1', accountActive:true, deletionPending:false, qaOrInternal:false }],
  billing: [{ uid:'u1', effectivePlan:'free', currentSubscription:false, promotionPendingOrJoined:false }],
  consent: [{ uid:'u1', email:'member@example.invalid', choice:'opt_in', channel:'email_marketing', source:'explicit_checkbox', checkboxDefault:false, policyVersion:'2026-10', evidenceRef:'record-1', optedInAt:capturedAt, revokedAt:null }],
  suppression: [{ email:'member@example.invalid', status:'clear', checkedAt:capturedAt }]
})
const check = value => reconcileRecipientInventory(value, now).counts
describe('private recipient inventory preflight, no sends', () => {
  it('accepts only complete affirmative evidence and emits aggregate counts', () => {
    const report = reconcileRecipientInventory(good(), now)
    expect(report.counts).toEqual({ 'eligible-for-owner-review':1 })
    expect(JSON.stringify(report)).not.toContain('@')
    expect(report.mode).toBe('dry-run-no-send')
    expect(MARKETING_CONSENT_CONTRACT.checkboxDefault).toBe(false)
  })
  it.each(['profiles','billing','consent','suppression'])('holds missing %s evidence', key => {
    const data = good(); data[key] = []
    expect(check(data)['eligible-for-owner-review']).toBeUndefined()
  })
  it('does not treat signup, terms or reminders as marketing consent', () => {
    const data = good(); data.consent[0].source = 'terms_accepted'
    expect(check(data)['hold-permission']).toBe(1)
  })
  it.each([
    ['choice','opt_out'],['checkboxDefault',true],['policyVersion',''],['evidenceRef',''],
    ['channel','care_reminders'],['email','different@example.invalid'],['source','prechecked_box']
  ])('rejects ambiguous consent %s', (key,value) => {
    const data=good();data.consent[0][key]=value
    expect(check(data)['eligible-for-owner-review']).toBeUndefined()
  })
  it('accepts explicit settings opt-in, not care-reminder settings', () => {
    const data=good(); data.consent[0].source='account_settings'
    expect(check(data)['eligible-for-owner-review']).toBe(1)
    data.consent[0].source='reminder_settings'
    expect(check(data)['eligible-for-owner-review']).toBeUndefined()
  })
  it('respects unsubscribe and never resets it', () => {
    const data=good();data.suppression[0].status='suppressed'
    expect(check(data)['excluded-opt-out']).toBe(1)
  })
  it('holds stale provider suppression checks', () => {
    const data=good();data.suppression[0].checkedAt=new Date(now-300001).toISOString()
    expect(check(data)['eligible-for-owner-review']).toBeUndefined()
  })
  it('holds duplicate email case insensitively', () => {
    const data=good()
    data.auth.push({uid:'u2',email:'MEMBER@example.invalid',emailVerified:true,disabled:false})
    expect(check(data)['hold-duplicate']).toBe(2)
  })
  it('holds subscription uncertainty', () => {
    const data=good();data.billing[0].currentSubscription='unknown'
    expect(check(data)['eligible-for-owner-review']).toBeUndefined()
  })
  it('fails closed on stale snapshots or absent required sources', () => {
    const data=good();data.capturedAt=new Date(now-300001).toISOString()
    expect(()=>check(data)).toThrow(/stale/)
    delete data.consent
    expect(()=>check(data)).toThrow(/Missing required array/)
  })
  it('never exposes addresses, names or source records', () => {
    const result=JSON.stringify(reconcileRecipientInventory(good(),now))
    expect(result).not.toContain('member@example.invalid')
    expect(result).not.toContain('record-1')
  })
})
