import { describe, expect, it } from 'vitest'
import { effectiveReminderFilter, parseReminderFilter, reminderEmptyState } from './reminderView'

describe('reminders view — overdue is never hidden', () => {
  it('opens on Overdue when anything is overdue, otherwise Upcoming', () => {
    expect(effectiveReminderFilter(null, 2)).toBe('overdue')   // QA repro: 2 overdue, 0 upcoming
    expect(effectiveReminderFilter(null, 0)).toBe('upcoming')
  })
  it('keeps an explicit ?filter= link or tap', () => {
    expect(effectiveReminderFilter('upcoming', 2)).toBe('upcoming')
    expect(effectiveReminderFilter('done', 2)).toBe('done')
    expect(effectiveReminderFilter(parseReminderFilter('all'), 3)).toBe('all')
    expect(parseReminderFilter('bogus')).toBeNull()
    expect(parseReminderFilter(null)).toBeNull()
  })
  it('only says "All caught up" when nothing is overdue', () => {
    const withOverdue = reminderEmptyState('upcoming', 2)
    expect(withOverdue.title).not.toMatch(/caught up/i)
    expect(withOverdue.desc).toContain('2 are overdue')
    expect(withOverdue.showOverdue).toBe(true)
    expect(reminderEmptyState('upcoming', 1).desc).toContain('1 is overdue')
    expect(reminderEmptyState('upcoming', 0)).toMatchObject({ title: 'All caught up!', showOverdue: false })
    for (const f of ['overdue', 'all', 'done'] as const) expect(reminderEmptyState(f, 0).title).not.toMatch(/caught up/i)
  })
})
