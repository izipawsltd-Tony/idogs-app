// Reminders page view rules (QA 4 Nov 2026: with 2 overdue and nothing due
// this week, the page opened on "Upcoming" and said "All caught up!").
export type ReminderFilter = 'upcoming' | 'overdue' | 'all' | 'done'
export const REMINDER_FILTERS: readonly ReminderFilter[] = ['upcoming', 'overdue', 'all', 'done']

export function parseReminderFilter(value: string | null | undefined): ReminderFilter | null {
  return REMINDER_FILTERS.includes(value as ReminderFilter) ? value as ReminderFilter : null
}

/** An explicit choice (link ?filter= or a tap) always wins; otherwise open on Overdue when anything is overdue. */
export function effectiveReminderFilter(chosen: ReminderFilter | null, overdueCount: number): ReminderFilter {
  return chosen ?? (overdueCount > 0 ? 'overdue' : 'upcoming')
}

/** Empty-list copy that never says "All caught up" while something is still outstanding. */
export function reminderEmptyState(filter: ReminderFilter, overdueCount: number): { title: string; desc: string; showOverdue: boolean } {
  if (filter === 'upcoming' && overdueCount > 0) {
    return { title: 'Nothing coming up', desc: `No reminders are due later, but ${overdueCount} ${overdueCount === 1 ? 'is' : 'are'} overdue.`, showOverdue: true }
  }
  if (filter === 'upcoming') return { title: 'All caught up!', desc: 'You have no overdue or upcoming reminders.', showOverdue: false }
  if (filter === 'overdue') return { title: 'Nothing overdue', desc: 'No reminders are overdue.', showOverdue: false }
  if (filter === 'done') return { title: 'No completed reminders', desc: 'Reminders you mark done will appear here.', showOverdue: false }
  return { title: 'No reminders yet', desc: 'Add a reminder to stay on top of vaccines, worming and vet visits.', showOverdue: false }
}
