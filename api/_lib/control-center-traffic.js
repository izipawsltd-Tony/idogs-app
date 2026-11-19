// Visit → signup rate (Owner definition, 13 Nov 2026): eligible signups divided
// by sessions that include the signup page, from a verified analytics source.
//
// Join rule: aggregate, not per session. Both sides are counted over the same
// whole UTC days, in the same environment, and the numerator only counts web
// signups (an iOS signup never opens the web signup page). The rate is shown
// only when every check passes; otherwise the status explains why and the
// visit count and rate stay null. null is unknown, never zero.
//
// No source is approved today. A source becomes usable only after the Owner
// approves it and its id is added here in a reviewed change.
export const APPROVED_VISIT_SOURCES = Object.freeze([])
export const VISIT_UNIT = 'SESSION_WITH_SIGNUP_PAGE'
const DAY = 86400000
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

export const VISIT_STATUS = Object.freeze({ NO_VERIFIED_SOURCE: 'NO_VERIFIED_SOURCE', UNVERIFIED: 'UNVERIFIED', VERIFIED: 'VERIFIED' })

const dayStart = key => Date.parse(`${key}T00:00:00Z`)
const dayKey = ms => new Date(ms).toISOString().slice(0, 10)
const isCount = value => Number.isSafeInteger(value) && value >= 0
function timestamp(value) {
  try {
    const date = value?.toDate instanceof Function ? value.toDate()
      : value instanceof Date ? value
      : typeof value === 'string' ? new Date(value)
      : typeof value?.seconds === 'number' ? new Date(value.seconds * 1000) : null
    return date && Number.isFinite(date.getTime()) ? date.getTime() : null
  } catch { return null }
}

// The last `days` whole UTC days that have had `settleHours` to finish
// arriving. Late data for more recent days is left out of the window.
export function visitWindow(now, days, settleHours = 24) {
  const lastSettledEnd = Math.floor((now.getTime() - settleHours * 3600000) / DAY) * DAY
  const fromMs = lastSettledEnd - days * DAY
  return { fromDay: dayKey(fromMs), toDay: dayKey(lastSettledEnd - DAY), days, settleHours, fromMs, toMs: lastSettledEnd }
}

const NOTES = {
  NO_VERIFIED_SOURCE: 'No approved analytics source for sessions that include the signup page is connected. The visit-to-signup rate stays empty.',
  SOURCE_NOT_APPROVED: 'The visit source has not been approved by the Owner.',
  ENVIRONMENT_MISMATCH: 'Visits and signups come from different environments.',
  UNIT_MISMATCH: 'The source does not count sessions that include the signup page.',
  FILTERING_NOT_CONFIRMED: 'The source does not confirm that bots and test traffic are excluded.',
  INVALID_COUNT: 'The source has a missing or invalid daily count.',
  CONFLICTING_DUPLICATE: 'The source reports the same day twice with different counts.',
  MISSING_DAYS: 'The source does not cover every day of the window.',
  NOT_FINALIZED: 'Some days in the window are not finalized by the source yet (late data).',
  SIGNUP_PLATFORM_UNKNOWN: 'Some signups have no recorded platform, so web signups cannot be separated from app signups.',
  NUMERATOR_EXCEEDS_DENOMINATOR: 'More web signups than signup-page sessions: the two counts do not cover the same scope.',
  ZERO_VISITS: 'No signup-page sessions in the window, so there is no rate.',
}

// visitSource: { sourceId, environment, unit, botsExcluded, testTrafficExcluded,
//   days: [{ day: 'YYYY-MM-DD', sessions, finalizedAt }] } or null.
// signups: eligible (non-internal, non-QA) profiles { id, createdAt, platform }.
export function evaluateVisitToSignup({ visitSource, signups = [], environment, now = new Date(), days = 30, settleHours = 24, approvedSources = APPROVED_VISIT_SOURCES }) {
  const window = visitWindow(now, days, settleHours)
  const seen = new Set()
  let webSignups = 0, unknownPlatform = 0
  for (const signup of signups) {
    if (typeof signup?.id !== 'string' || seen.has(signup.id)) continue
    const created = timestamp(signup.createdAt)
    if (created === null || created < window.fromMs || created >= window.toMs) continue
    seen.add(signup.id)
    if (signup.platform === 'web') webSignups++
    else if (signup.platform !== 'ios' && signup.platform !== 'android') unknownPlatform++
  }
  const base = {
    unit: VISIT_UNIT, environment: environment ?? null,
    window: { fromDay: window.fromDay, toDay: window.toDay, days: window.days, settleHours },
    webSignups: unknownPlatform ? null : webSignups,
    signupsUnknownPlatform: unknownPlatform,
    signupPageSessions: null, visitToSignupRate: null,
    joinRule: 'Same whole UTC days, same environment, web signups only. Aggregate counts, not matched session by session.',
  }
  if (!visitSource || typeof visitSource !== 'object') {
    return { ...base, status: VISIT_STATUS.NO_VERIFIED_SOURCE, sourceId: null, reasons: ['NO_VERIFIED_SOURCE'], note: NOTES.NO_VERIFIED_SOURCE }
  }
  const reasons = []
  if (!approvedSources.includes(visitSource.sourceId)) reasons.push('SOURCE_NOT_APPROVED')
  if (visitSource.environment !== environment) reasons.push('ENVIRONMENT_MISMATCH')
  if (visitSource.unit !== VISIT_UNIT) reasons.push('UNIT_MISMATCH')
  if (visitSource.botsExcluded !== true || visitSource.testTrafficExcluded !== true) reasons.push('FILTERING_NOT_CONFIRMED')

  // Duplicate day rows: identical repeats collapse; different counts conflict.
  const byDay = new Map()
  let invalid = false, conflict = false
  for (const row of Array.isArray(visitSource.days) ? visitSource.days : []) {
    if (!DAY_KEY.test(row?.day ?? '') || !Number.isFinite(dayStart(row.day)) || !isCount(row.sessions)) { invalid = true; continue }
    const prior = byDay.get(row.day)
    if (prior && prior.sessions !== row.sessions) conflict = true
    if (!prior || timestamp(row.finalizedAt) > timestamp(prior.finalizedAt)) byDay.set(row.day, row)
  }
  if (invalid) reasons.push('INVALID_COUNT')
  if (conflict) reasons.push('CONFLICTING_DUPLICATE')
  let sessions = 0, missing = false, unfinalized = false
  for (let ms = window.fromMs; ms < window.toMs; ms += DAY) {
    const row = byDay.get(dayKey(ms))
    if (!row) { missing = true; continue }
    const finalized = timestamp(row.finalizedAt)
    if (finalized === null || finalized < ms + DAY || finalized > now.getTime()) unfinalized = true
    sessions += row.sessions
  }
  if (missing) reasons.push('MISSING_DAYS')
  if (unfinalized) reasons.push('NOT_FINALIZED')
  if (unknownPlatform) reasons.push('SIGNUP_PLATFORM_UNKNOWN')
  if (!reasons.length && webSignups > sessions) reasons.push('NUMERATOR_EXCEEDS_DENOMINATOR')
  if (reasons.length) {
    return { ...base, status: VISIT_STATUS.UNVERIFIED, sourceId: typeof visitSource.sourceId === 'string' ? visitSource.sourceId.slice(0, 60) : null, reasons, note: reasons.map(reason => NOTES[reason]).join(' ') }
  }
  return {
    ...base, status: VISIT_STATUS.VERIFIED, sourceId: visitSource.sourceId,
    signupPageSessions: sessions,
    visitToSignupRate: sessions > 0 ? webSignups / sessions : null,
    reasons: sessions > 0 ? [] : ['ZERO_VISITS'],
    note: sessions > 0 ? `Web signups divided by signup-page sessions, ${window.fromDay} to ${window.toDay} (UTC).` : NOTES.ZERO_VISITS,
  }
}
