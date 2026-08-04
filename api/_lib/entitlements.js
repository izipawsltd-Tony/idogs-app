// api/_lib/entitlements.js — plan/quota math shared by every server
// endpoint that gates a feature on iDogs Pricing v1.1
// (Pricing_Decision_Record_v1.1.md, LOCKED): api/scan.js,
// api/create-litter.js, api/update-litter.js, api/set-dog-status.js,
// api/reconcile-dog-cap.js, api/export-report.js, api/stripe-webhook.js.
//
// Nothing here trusts client input — every caller passes in a
// users/{uid} profile already read from Firestore via the Admin SDK.

export const SCAN_QUOTA = Object.freeze({ freeLifetime: 2, plusMonthly: 10 })

const GRACE_MS = 7 * 24 * 60 * 60 * 1000 // §4.2 — 7-day past_due grace

// Derives the CURRENT effective entitlement from a users/{uid} profile.
// `plan` is the persisted/trusted value the webhook/grace-cron last wrote
// ('plus' or 'free' — anything else is treated as 'free', the safe
// default). The one case this computes LAZILY, without waiting for a
// dedicated write, is the §4.2 7-day past_due grace window: once
// `pastDueSince` is more than 7 days in the past, every read of this
// account is treated as Free immediately, even before
// api/enforce-billing-grace.js's next sweep has run its downgrade
// transaction (which is what actually moves excess dogs to `restricted`
// and persists plan:'free' — this function only affects in-the-moment
// quota decisions, e.g. "how many scans do I have left right now").
// Internal/admin-granted entitlement override — completely independent of
// Stripe. Exists for verified internal accounts (e.g. the founder's own
// account) that need full Plus/breeder feature access without a real
// subscription, without ever faking one. `profile.internalEntitlement` is
// a server-owned field (see firestore.rules' userBillingFields() — added
// to that same protected-field allowlist, so a client can never write,
// modify, or clear it directly; only a trusted Admin SDK path can). Never
// written by api/stripe-webhook.js/api/enforce-billing-grace.js — those
// only ever touch `plan`/`subscriptionStatus`/etc., so a real Stripe event
// (or its absence) can never grant, revoke, or otherwise affect this field.
//
// Shape: { granted: boolean, grantedAt: ISOstring, grantedBy: string,
//          reason: string, expiresAt: ISOstring | null }
// `granted: false` (an explicit revoke) always denies, regardless of any
// other field — this is what lets a revoke be recorded as an auditable
// state transition (who revoked it, when) rather than deleting the field
// outright and losing that history.
function hasValidInternalEntitlement(profile, now) {
  const entitlement = profile?.internalEntitlement
  if (!entitlement || entitlement.granted !== true) return false
  if (entitlement.expiresAt) {
    const expiresAtMs = new Date(entitlement.expiresAt).getTime()
    if (!Number.isNaN(expiresAtMs) && now.getTime() >= expiresAtMs) return false
  }
  return true
}

export function computeEffectivePlan(profile, now = new Date()) {
  const rawPlan = profile?.plan === 'plus' ? 'plus' : 'free'
  let paidPlanActive = rawPlan === 'plus'
  if (paidPlanActive && profile?.subscriptionStatus === 'past_due' && profile?.pastDueSince) {
    const since = new Date(profile.pastDueSince).getTime()
    if (!Number.isNaN(since) && now.getTime() - since > GRACE_MS) paidPlanActive = false
  }
  if (paidPlanActive) return 'plus'
  if (hasValidInternalEntitlement(profile, now)) return 'plus'
  return 'free'
}

export function isPastDueGraceExpired(profile, now = new Date()) {
  if (profile?.subscriptionStatus !== 'past_due' || !profile?.pastDueSince) return false
  const since = new Date(profile.pastDueSince).getTime()
  return !Number.isNaN(since) && now.getTime() - since > GRACE_MS
}

// ── AI scan monthly-anchor math (§3.1) ──────────────────────────────
//
// "Quota reset is application logic, not Stripe billing state... The app
// computes monthly anchors itself from subscription.start_date,
// identically for both monthly and annual plans." Day 29/30/31 in a
// month that lacks it falls on that month's LAST day.

// Date.UTC(year, month+1, 0) is the last day of `month` — a deliberate
// use of JS Date's day-0-rolls-back-one-month behavior to compute a real
// calendar boundary, not an accidental out-of-range value.
function daysInMonthUTC(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

function clampedDateUTC(year, monthIndex0, day) {
  const clampedDay = Math.min(day, daysInMonthUTC(year, monthIndex0))
  return new Date(Date.UTC(year, monthIndex0, clampedDay))
}

export function anchorDayFromDate(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  return d.getUTCDate()
}

function nextPeriodBoundary(periodStart, anchorDay) {
  return clampedDateUTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, anchorDay)
}

// Rolls plusScansUsed/plusScansPeriodStart forward as many times as
// needed so the returned period describes the one containing `now` —
// correct even for an account untouched for several months (each
// skipped period is rolled through, not special-cased). `rolled` tells
// the caller whether a write is actually needed.
export function rollScanPeriod({ plusScansUsed, plusScansPeriodStart, scanPeriodAnchorDay }, now = new Date()) {
  let used = typeof plusScansUsed === 'number' && plusScansUsed >= 0 ? plusScansUsed : 0
  let periodStart = plusScansPeriodStart ? new Date(plusScansPeriodStart) : now
  if (Number.isNaN(periodStart.getTime())) periodStart = now
  const anchorDay = scanPeriodAnchorDay && scanPeriodAnchorDay >= 1 && scanPeriodAnchorDay <= 31
    ? scanPeriodAnchorDay
    : anchorDayFromDate(periodStart)

  let boundary = nextPeriodBoundary(periodStart, anchorDay)
  let rolled = false
  // Bounded loop (120 = 10 years of monthly periods) — a defensive cap
  // against a corrupted/far-future stored date ever spinning forever.
  for (let i = 0; i < 120 && boundary.getTime() <= now.getTime(); i++) {
    used = 0
    periodStart = boundary
    boundary = nextPeriodBoundary(periodStart, anchorDay)
    rolled = true
  }
  return {
    plusScansUsed: used,
    plusScansPeriodStart: periodStart.toISOString(),
    scanPeriodAnchorDay: anchorDay,
    rolled,
  }
}

// Remaining-quota computation. Free: 2 lifetime minus whatever's been
// used, floor 0 — and per §3.3/§4.2, downgrading from Plus does NOT
// reset freeScansUsed, since it's a lifetime counter that was already
// counting before the account ever upgraded (or continues counting if it
// never used any Free scans while on Plus).
export function remainingScans(profile, effectivePlan, now = new Date()) {
  if (effectivePlan === 'plus') {
    const rolled = rollScanPeriod(profile, now)
    return {
      remaining: Math.max(0, SCAN_QUOTA.plusMonthly - rolled.plusScansUsed),
      periodState: rolled,
    }
  }
  const used = typeof profile?.freeScansUsed === 'number' && profile.freeScansUsed >= 0 ? profile.freeScansUsed : 0
  return { remaining: Math.max(0, SCAN_QUOTA.freeLifetime - used), periodState: null }
}
