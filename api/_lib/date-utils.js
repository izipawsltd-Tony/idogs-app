// api/_lib/date-utils.js — shared, dependency-free calendar-date
// validation used by every server-side input schema (Codex round 5,
// Blockers 5 + 6). Deliberately NOT merged into parent-eligibility.js's
// parseDobStrictServer (which is narrower — always rejects future dates,
// specific to "a Dog's own date of birth") to avoid touching that
// already-tested function; some date fields validated here (mating/due
// dates, a heat cycle's own start date) are legitimately allowed to be
// future-dated or don't need the future check at all.

// Real YYYY-MM-DD calendar date — catches missing, wrong type, wrong
// shape, and impossible dates (e.g. "2020-02-30", which JS's Date
// constructor would otherwise silently roll over to March 1st instead
// of rejecting).
export function isValidCalendarDateString(value) {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
}

// Assumes `value` has already passed isValidCalendarDateString — compares
// calendar-date components directly (never an absolute-instant/getTime()
// comparison), same timezone-safe approach as parseDobStrictServer.
export function isFutureDateString(value) {
  const [year, month, day] = value.split('-').map(Number)
  const today = new Date()
  return year > today.getFullYear() ||
    (year === today.getFullYear() && month - 1 > today.getMonth()) ||
    (year === today.getFullYear() && month - 1 === today.getMonth() && day > today.getDate())
}
