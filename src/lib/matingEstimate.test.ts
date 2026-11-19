import { describe, expect, it } from 'vitest'
import {
  addDaysToIsoDate,
  daysBetweenIsoDates,
  isIsoDate,
  matingEstimateFor,
  shiftedMatingReminderDate,
} from './matingEstimate'

describe('matingEstimateFor', () => {
  it('uses Day 10–14 window and Day 9 reminder from heat start', () => {
    // Owner example: Heat 3 started 10 Nov 2026
    expect(matingEstimateFor('2026-11-10')).toEqual({
      windowStart: '2026-11-20',
      windowEnd: '2026-11-24',
      defaultReminderDate: '2026-11-19',
    })
  })

  it('crosses month and year boundaries', () => {
    expect(matingEstimateFor('2026-12-25')).toEqual({
      windowStart: '2027-01-04',
      windowEnd: '2027-01-08',
      defaultReminderDate: '2027-01-03',
    })
  })

  it('handles leap years', () => {
    expect(matingEstimateFor('2028-02-20')?.windowStart).toBe('2028-03-01')
    expect(matingEstimateFor('2028-02-20')?.defaultReminderDate).toBe('2028-02-29')
  })

  it('returns null for missing or invalid dates', () => {
    expect(matingEstimateFor('')).toBeNull()
    expect(matingEstimateFor(undefined)).toBeNull()
    expect(matingEstimateFor('2026-02-30')).toBeNull()
    expect(matingEstimateFor('10/11/2026')).toBeNull()
  })
})

describe('date helpers', () => {
  it('validates real dates only', () => {
    expect(isIsoDate('2026-11-10')).toBe(true)
    expect(isIsoDate('2026-13-01')).toBe(false)
  })

  it('adds and diffs days without timezone drift', () => {
    expect(addDaysToIsoDate('2026-04-04', 1)).toBe('2026-04-05') // Adelaide DST change weekend
    expect(daysBetweenIsoDates('2026-11-10', '2026-11-19')).toBe(9)
    expect(daysBetweenIsoDates('2026-11-19', '2026-11-10')).toBe(-9)
  })
})

describe('shiftedMatingReminderDate', () => {
  it('moves the reminder by the same number of days as the heat start', () => {
    expect(shiftedMatingReminderDate('2026-11-19', '2026-11-10', '2026-11-12')).toBe('2026-11-21')
    // breeder chose Day 7; offset is kept
    expect(shiftedMatingReminderDate('2026-11-17', '2026-11-10', '2026-11-08')).toBe('2026-11-15')
  })

  it('returns null when heat start did not change or data is invalid', () => {
    expect(shiftedMatingReminderDate('2026-11-19', '2026-11-10', '2026-11-10')).toBeNull()
    expect(shiftedMatingReminderDate('2026-11-19', undefined, '2026-11-10')).toBeNull()
    expect(shiftedMatingReminderDate('bad', '2026-11-10', '2026-11-12')).toBeNull()
  })
})
