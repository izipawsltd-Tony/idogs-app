import { test } from 'node:test'
import assert from 'node:assert/strict'
import { APPROVED_VISIT_SOURCES, evaluateVisitToSignup, visitWindow } from '../api/_lib/control-center-traffic.js'
import { buildGrowthSnapshot } from '../api/_lib/control-center-growth.js'
import { buildControlCenterEvidence } from '../api/_lib/control-center-evidence.js'

// Synthetic staging fixture with a predetermined result. "now" is 20 Nov
// 2026 10:00Z; with a 24 h settle period the 7-day window is 12–18 Nov.
const now = new Date('2026-11-20T10:00:00Z')
const DAYS = 7
const FIXTURE_ID = 'synthetic-staging-fixture'
const approved = [FIXTURE_ID]
const dayRows = (sessions = [10, 20, 30, 0, 15, 25, 0]) => sessions.map((count, i) => {
  const day = new Date(Date.UTC(2026, 10, 12 + i)).toISOString().slice(0, 10)
  return { day, sessions: count, finalizedAt: `${new Date(Date.UTC(2026, 10, 13 + i, 2)).toISOString()}` }
})
const source = (overrides = {}) => ({ sourceId: FIXTURE_ID, environment: 'preview', unit: 'SESSION_WITH_SIGNUP_PAGE', botsExcluded: true, testTrafficExcluded: true, days: dayRows(), ...overrides })
// 9 web signups inside the window, 1 web signup before it, 1 on the unsettled day, 1 iOS.
const signups = [
  ...Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, createdAt: `2026-11-${String(12 + (i % 7)).padStart(2, '0')}T08:00:00Z`, platform: 'web' })),
  { id: 'before', createdAt: '2026-11-11T23:59:59Z', platform: 'web' },
  { id: 'unsettled', createdAt: '2026-11-19T12:00:00Z', platform: 'web' },
  { id: 'app', createdAt: '2026-11-14T12:00:00Z', platform: 'ios' },
  { id: 'w0', createdAt: '2026-11-12T08:00:00Z', platform: 'web' }, // duplicate profile
]
const evaluate = (overrides = {}) => evaluateVisitToSignup({ visitSource: source(), signups, environment: 'preview', now, days: DAYS, approvedSources: approved, ...overrides })

test('window covers whole settled UTC days only', () => {
  const window = visitWindow(now, DAYS)
  assert.equal(window.fromDay, '2026-11-12')
  assert.equal(window.toDay, '2026-11-18')
})

test('predetermined fixture: 100 sessions, 9 web signups, 9.0%', () => {
  const result = evaluate()
  assert.equal(result.status, 'VERIFIED')
  assert.equal(result.signupPageSessions, 100)
  assert.equal(result.webSignups, 9)
  assert.equal(result.visitToSignupRate, 0.09)
  assert.deepEqual(result.reasons, [])
})

test('no approved source in production code: the real snapshot is NO_VERIFIED_SOURCE and the rate is empty', () => {
  assert.deepEqual(APPROVED_VISIT_SOURCES, [])
  const result = evaluateVisitToSignup({ visitSource: null, signups, environment: 'preview', now, days: DAYS })
  assert.equal(result.status, 'NO_VERIFIED_SOURCE')
  assert.equal(result.visitToSignupRate, null)
  assert.equal(result.signupPageSessions, null)
  const unapproved = evaluateVisitToSignup({ visitSource: source(), signups, environment: 'preview', now, days: DAYS })
  assert.equal(unapproved.status, 'UNVERIFIED')
  assert.deepEqual(unapproved.reasons, ['SOURCE_NOT_APPROVED'])
  assert.equal(unapproved.signupPageSessions, null)
})

test('identical duplicate day rows collapse; conflicting duplicates are unverified', () => {
  assert.equal(evaluate({ visitSource: source({ days: [...dayRows(), dayRows()[2]] }) }).signupPageSessions, 100)
  const conflict = evaluate({ visitSource: source({ days: [...dayRows(), { ...dayRows()[2], sessions: 31 }] }) })
  assert.equal(conflict.status, 'UNVERIFIED')
  assert.ok(conflict.reasons.includes('CONFLICTING_DUPLICATE'))
  assert.equal(conflict.visitToSignupRate, null)
})

test('late data: a day not finalized yet keeps the result unverified', () => {
  const rows = dayRows()
  rows[6] = { ...rows[6], finalizedAt: '2026-11-18T20:00:00Z' } // before the day ended
  assert.deepEqual(evaluate({ visitSource: source({ days: rows }) }).reasons, ['NOT_FINALIZED'])
  rows[6] = { ...rows[6], finalizedAt: undefined }
  assert.deepEqual(evaluate({ visitSource: source({ days: rows }) }).reasons, ['NOT_FINALIZED'])
  // Data for the unsettled day (19 Nov) is outside the window and ignored.
  assert.equal(evaluate({ visitSource: source({ days: [...dayRows(), { day: '2026-11-19', sessions: 999, finalizedAt: null }] }) }).signupPageSessions, 100)
})

test('zero denominator gives no rate rather than infinity or zero', () => {
  const result = evaluate({ visitSource: source({ days: dayRows([0, 0, 0, 0, 0, 0, 0]) }), signups: [] })
  assert.equal(result.status, 'VERIFIED')
  assert.equal(result.signupPageSessions, 0)
  assert.equal(result.visitToSignupRate, null)
  assert.deepEqual(result.reasons, ['ZERO_VISITS'])
})

test('missing data: absent days, invalid counts and missing filtering are unverified', () => {
  assert.deepEqual(evaluate({ visitSource: source({ days: dayRows().slice(1) }) }).reasons, ['MISSING_DAYS'])
  const invalid = evaluate({ visitSource: source({ days: [...dayRows().slice(0, 6), { day: '2026-11-18', sessions: -1, finalizedAt: '2026-11-19T02:00:00Z' }] }) })
  assert.deepEqual(invalid.reasons, ['INVALID_COUNT', 'MISSING_DAYS'])
  assert.deepEqual(evaluate({ visitSource: source({ botsExcluded: false }) }).reasons, ['FILTERING_NOT_CONFIRMED'])
})

test('numerator and denominator out of scope are unverified', () => {
  assert.deepEqual(evaluate({ environment: 'production' }).reasons, ['ENVIRONMENT_MISMATCH'])
  assert.deepEqual(evaluate({ visitSource: source({ unit: 'PAGE_LOAD' }) }).reasons, ['UNIT_MISMATCH'])
  const noPlatform = evaluate({ signups: [...signups, { id: 'legacy', createdAt: '2026-11-15T00:00:00Z' }] })
  assert.deepEqual(noPlatform.reasons, ['SIGNUP_PLATFORM_UNKNOWN'])
  assert.equal(noPlatform.webSignups, null)
  assert.deepEqual(evaluate({ visitSource: source({ days: dayRows([1, 1, 1, 1, 1, 1, 1]) }) }).reasons, ['NUMERATOR_EXCEEDS_DENOMINATOR'])
})

// Dashboard and Claude must report the same status, window, counts and rate.
function both(visitSource, users) {
  const accounts = users.map(user => ({ uid: user.id, classification: 'REAL_CUSTOMER' }))
  const growth = buildGrowthSnapshot({ users, accounts, visitSource, environment: 'preview', now, days: DAYS })
  return { dashboard: growth.funnel.visits, claude: buildControlCenterEvidence({ generatedAt: now.toISOString(), growthSnapshot: growth }, { now }).acquisition.funnel.visits }
}
const profiles = signups.map(signup => ({ id: signup.id, createdAt: signup.createdAt, signupPlatform: signup.platform }))

test('dashboard and Claude evidence agree for the real no-source case', () => {
  const { dashboard, claude } = both(null, profiles)
  assert.equal(dashboard.status, 'NO_VERIFIED_SOURCE')
  assert.equal(claude.status, dashboard.status)
  assert.deepEqual(claude.window, { fromDay: dashboard.window.fromDay, toDay: dashboard.window.toDay, days: DAYS })
  assert.equal(claude.visitToSignupRate, null)
  assert.equal(claude.signupPageSessions, null)
  assert.equal(claude.webSignups, dashboard.webSignups)
})

test('dashboard and Claude evidence agree when a source is present but unapproved, and Claude never gets the count', () => {
  const { dashboard, claude } = both(source(), profiles)
  assert.equal(dashboard.status, 'UNVERIFIED')
  assert.equal(claude.status, 'UNVERIFIED')
  assert.deepEqual(claude.reasons, dashboard.reasons)
  assert.equal(claude.signupPageSessions, null)
  assert.equal(claude.visitToSignupRate, null)
})

test('legacy profiles with no signup platform keep the rate unverified even on the dashboard path', () => {
  const legacy = profiles.map(({ signupPlatform, ...rest }) => rest)
  const { dashboard, claude } = both(null, legacy)
  assert.equal(dashboard.webSignups, null)
  assert.equal(claude.webSignups, null)
})
