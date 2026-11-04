import { describe, expect, it } from 'vitest'
import { freeDogUsage } from './dogLimit'
import { dogLimitReachedBody, dogLimitUpgradeCta } from './nativeUpgradeCopy'

const dog = (over: Record<string, unknown> = {}) => ({ status: 'active', tenantId: 'u1', currentOwnerId: 'u1', ...over }) as never
const free = { plan: 'free' } as never
const plus = { plan: 'plus' } as never

describe('Free dog limit (QA 4 Nov 2026)', () => {
  it('counts 0/1/2 active dogs and is at the limit only at 2 on Free', () => {
    expect(freeDogUsage([], free)).toMatchObject({ used: 0, limit: 2, atLimit: false, isFree: true })
    expect(freeDogUsage([dog()], free)).toMatchObject({ used: 1, atLimit: false })
    expect(freeDogUsage([dog(), dog()], free)).toMatchObject({ used: 2, atLimit: true })
  })
  it('never limits Plus, and treats a trial/unknown plan as Free', () => {
    expect(freeDogUsage([dog(), dog(), dog()], plus)).toMatchObject({ isFree: false, atLimit: false })
    expect(freeDogUsage([dog(), dog()], { plan: 'trial' } as never).atLimit).toBe(true)
  })
  it('does not count transferred or deceased dogs (same rule as Add Dog)', () => {
    expect(freeDogUsage([dog(), dog({ status: 'transferred' }), dog({ isDeceased: true })], free)).toMatchObject({ used: 1, atLimit: false })
  })
  it('copy no longer claims documents, iDogs Scan or transfer need Plus', () => {
    for (const msg of [dogLimitReachedBody(false, true), dogLimitReachedBody(false, false), dogLimitReachedBody(true, true)]) {
      expect(msg).not.toMatch(/unlock .*documents|documents, and ownership transfer are Plus/i)
      expect(msg).toMatch(/documents, QR Passports, reminders and ownership transfer stay free/)
    }
  })
  it('quotes the live promotion while it runs, the regular price after', () => {
    expect(dogLimitReachedBody(false, true)).toMatch(/A\$0 until 31 January 2027, then A\$7\/month/)
    expect(dogLimitReachedBody(false, false)).toMatch(/A\$7\/month/)
    expect(dogLimitReachedBody(false, false)).not.toMatch(/A\$0/)
    expect(dogLimitUpgradeCta(true)).toBe('Get Plus for A$0')
    expect(dogLimitUpgradeCta(false)).toBe('Upgrade — A$7/mo')
  })
})
