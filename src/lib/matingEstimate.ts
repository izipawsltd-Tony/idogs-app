// Mating estimate from the heat start date (Owner-approved 19/11/2026,
// GitHub Issue #69): typical mating window Day 10–14 counted from the
// first day of heat, default "Mating due" reminder on Day 9 so the
// breeder has time to book progesterone testing before the window.
// Reference only — the breeder can pick any reminder date.

export const MATING_WINDOW_START_DAY = 10
export const MATING_WINDOW_END_DAY = 14
export const MATING_REMINDER_DEFAULT_DAY = 9
export const MATING_DUE_MILESTONE_KEY = 'mating_due'
export const MATING_DUE_REMINDER_TITLE = 'Mating due — book progesterone test / plan mating'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function addDaysToIsoDate(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

export interface MatingEstimate {
  windowStart: string
  windowEnd: string
  defaultReminderDate: string
}

/** Null when the heat start date is missing or not a real yyyy-mm-dd date. */
export function matingEstimateFor(heatStartDate: string | undefined | null): MatingEstimate | null {
  if (!isIsoDate(heatStartDate)) return null
  return {
    windowStart: addDaysToIsoDate(heatStartDate, MATING_WINDOW_START_DAY),
    windowEnd: addDaysToIsoDate(heatStartDate, MATING_WINDOW_END_DAY),
    defaultReminderDate: addDaysToIsoDate(heatStartDate, MATING_REMINDER_DEFAULT_DAY),
  }
}

/**
 * When the heat start date is edited, move a pending Mating due reminder
 * by the same number of days, so a breeder's own chosen offset (e.g. Day 7
 * instead of Day 9) is kept. Returns null when nothing should move.
 */
export function shiftedMatingReminderDate(
  reminderDueDate: string,
  previousHeatStart: string | undefined,
  nextHeatStart: string | undefined,
): string | null {
  if (!isIsoDate(reminderDueDate) || !isIsoDate(previousHeatStart) || !isIsoDate(nextHeatStart)) return null
  const shift = daysBetweenIsoDates(previousHeatStart, nextHeatStart)
  if (shift === 0) return null
  return addDaysToIsoDate(reminderDueDate, shift)
}
