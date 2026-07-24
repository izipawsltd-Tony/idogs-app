// scripts/test-entitlements.mjs — pure-logic tests for
// api/_lib/entitlements.js (iDogs Pricing v1.1, LOCKED). No emulator, no
// network — every case here is deterministic math against fixed inputs.
//
// Usage: node scripts/test-entitlements.mjs

import { makeChecker } from './_lib/test-check.mjs'
import {
  computeEffectivePlan,
  isPastDueGraceExpired,
  rollScanPeriod,
  remainingScans,
  anchorDayFromDate,
  SCAN_QUOTA,
} from '../api/_lib/entitlements.js'

const { check, summary } = makeChecker()

// ── computeEffectivePlan / grace window (§4.2) ──────────────────────

check('free plan (no plan field) is free', computeEffectivePlan({}) === 'free')
check('plan=plus with no subscriptionStatus is plus', computeEffectivePlan({ plan: 'plus' }) === 'plus')
check('legacy plan values (pro/kennel/trial) are treated as free, never plus', ['pro', 'kennel', 'trial', 'starter', 'basic'].every(p => computeEffectivePlan({ plan: p }) === 'free'))

{
  const now = new Date('2026-07-24T00:00:00Z')
  const withinGrace = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days ago
  const pastGrace = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8 days ago
  check('past_due within the 7-day grace window still resolves to plus', computeEffectivePlan({ plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: withinGrace }, now) === 'plus')
  check('past_due beyond the 7-day grace window resolves to free (read-time, before any write)', computeEffectivePlan({ plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: pastGrace }, now) === 'free')
  check('isPastDueGraceExpired agrees with computeEffectivePlan at the same boundary', isPastDueGraceExpired({ plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: pastGrace }, now) === true)
  check('isPastDueGraceExpired is false when not past_due at all', isPastDueGraceExpired({ plan: 'plus', subscriptionStatus: 'active', pastDueSince: pastGrace }, now) === false)
  check('exactly 7 days is NOT yet expired (grace is a strict >7day check)', isPastDueGraceExpired({ plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() }, now) === false)
}

// ── Monthly anchor math — day 29/30/31 clamp to the month's last day ──

check('anchorDayFromDate reads the UTC day-of-month', anchorDayFromDate('2026-01-31T00:00:00Z') === 31)

{
  // Anchored on the 31st, checked in February (28 days in 2026 — not a
  // leap year) — the reset must land on Feb 28, not silently roll into
  // March or throw.
  const rolled = rollScanPeriod(
    { plusScansUsed: 4, plusScansPeriodStart: '2026-01-31T00:00:00.000Z', scanPeriodAnchorDay: 31 },
    new Date('2026-02-28T12:00:00Z')
  )
  check('day-31 anchor rolls to Feb 28 in a non-leap year (last day of the month), not an error', rolled.plusScansPeriodStart.startsWith('2026-02-28'))
  check('rollScanPeriod resets the used count to 0 on the day it rolls over', rolled.plusScansUsed === 0)
  check('rollScanPeriod reports rolled:true when a reset actually happened', rolled.rolled === true)
}

{
  // Anchored on the 30th, rolling into February (which has neither the
  // 30th nor 31st) — must clamp to Feb 28/29, never crash on an
  // out-of-range date.
  const rolled = rollScanPeriod(
    { plusScansUsed: 9, plusScansPeriodStart: '2026-01-30T00:00:00.000Z', scanPeriodAnchorDay: 30 },
    new Date('2026-03-01T00:00:00Z')
  )
  check('day-30 anchor clamps correctly through a short February', rolled.plusScansPeriodStart.startsWith('2026-02-28'))
}

{
  // An account untouched for several months must roll through EVERY
  // skipped period, landing on the one that actually contains `now` —
  // not just the very next one after the stored start.
  const rolled = rollScanPeriod(
    { plusScansUsed: 3, plusScansPeriodStart: '2026-01-15T00:00:00.000Z', scanPeriodAnchorDay: 15 },
    new Date('2026-06-20T00:00:00Z')
  )
  check('a multi-month gap rolls all the way to the period actually containing "now"', rolled.plusScansPeriodStart.startsWith('2026-06-15'))
  check('a multi-month gap still resets the used count', rolled.plusScansUsed === 0)
}

{
  // No rollover yet — used count and anchor must be preserved untouched.
  const rolled = rollScanPeriod(
    { plusScansUsed: 6, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1 },
    new Date('2026-07-15T00:00:00Z')
  )
  check('mid-period read does not reset the used count', rolled.plusScansUsed === 6)
  check('mid-period read reports rolled:false', rolled.rolled === false)
}

// ── remainingScans / free-vs-plus separation (§2.5/§3.1) ─────────────

check('Free lifetime allowance is 2, never resets by design (no period math for Free)', SCAN_QUOTA.freeLifetime === 2)
check('Plus monthly allowance is 10', SCAN_QUOTA.plusMonthly === 10)

check('a Free account with 0 used has 2 remaining', remainingScans({ freeScansUsed: 0 }, 'free').remaining === 2)
check('a Free account with 2 used has 0 remaining', remainingScans({ freeScansUsed: 2 }, 'free').remaining === 0)
check('a Free account can never go negative even if the stored count is corrupted upward', remainingScans({ freeScansUsed: 99 }, 'free').remaining === 0)

check(
  'a downgraded former-Plus account keeps its prior freeScansUsed — downgrade never resets the lifetime Free counter',
  remainingScans({ plan: 'free', freeScansUsed: 1 }, 'free').remaining === 1
)

{
  const plusRemaining = remainingScans({ plusScansUsed: 3, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1 }, 'plus', new Date('2026-07-15T00:00:00Z'))
  check('a Plus account with 3/10 used has 7 remaining mid-period', plusRemaining.remaining === 7)
}

check(
  'Plus usage never draws from the Free lifetime allowance (independent counters)',
  (() => {
    const profile = { plan: 'plus', plusScansUsed: 10, freeScansUsed: 0, plusScansPeriodStart: '2026-07-01T00:00:00.000Z', scanPeriodAnchorDay: 1 }
    const plusResult = remainingScans(profile, 'plus', new Date('2026-07-05T00:00:00Z'))
    const freeResult = remainingScans(profile, 'free', new Date('2026-07-05T00:00:00Z')) // hypothetical: if downgraded right now
    return plusResult.remaining === 0 && freeResult.remaining === 2
  })()
)

await summary()
