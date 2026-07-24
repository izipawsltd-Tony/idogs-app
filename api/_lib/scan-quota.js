// api/_lib/scan-quota.js — atomic AI-scan quota reservation for iDogs
// Pricing v1.1 (Pricing_Decision_Record_v1.1.md §2.5/§3.1, LOCKED).
//
// Codex H3: quota must be RESERVED atomically BEFORE the paid model is
// ever invoked, not checked-then-incremented-after. A plain
// check-then-call-then-increment sequence lets N concurrent requests all
// observe "1 remaining" and all proceed to call the paid model, each then
// incrementing independently — data-consistent (Firestore transactions
// don't corrupt the counter) but quota-INCORRECT (more scans get through
// than were actually available). Reserving inside a single transaction
// closes this: Firestore's own transaction contention/retry semantics
// serialize concurrent reservations against the SAME document, so only
// one concurrent caller can ever claim the last unit — every other
// concurrent caller's transaction retries against the now-updated count
// and correctly observes it exhausted, before spending any Anthropic API
// budget at all.

import { computeEffectivePlan, rollScanPeriod, SCAN_QUOTA } from './entitlements.js'

// Returns { reserved: true, plan, periodStart? } on success (quota has
// already been decremented in this same call) or { reserved: false, plan }
// when nothing was left — the caller must not invoke the paid model at
// all in that case. `periodStart` (Plus only) must be passed back into
// rollbackScanReservation() if the scan itself subsequently fails.
export async function reserveScanQuota(db, userRef) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(userRef)
    const profile = snap.exists ? snap.data() : {}
    const plan = computeEffectivePlan(profile)

    if (plan === 'plus') {
      const rolled = rollScanPeriod(profile)
      if (rolled.plusScansUsed >= SCAN_QUOTA.plusMonthly) {
        // Still persist a rolled-forward period boundary even on a
        // rejected reservation, so an account that hasn't scanned in
        // months has its period state caught up to "now" immediately —
        // safe/idempotent regardless of this call's outcome.
        if (rolled.rolled) {
          tx.set(userRef, {
            plusScansUsed: rolled.plusScansUsed,
            plusScansPeriodStart: rolled.plusScansPeriodStart,
            scanPeriodAnchorDay: rolled.scanPeriodAnchorDay,
          }, { merge: true })
        }
        return { reserved: false, plan }
      }
      tx.set(userRef, {
        plusScansUsed: rolled.plusScansUsed + 1,
        plusScansPeriodStart: rolled.plusScansPeriodStart,
        scanPeriodAnchorDay: rolled.scanPeriodAnchorDay,
      }, { merge: true })
      return { reserved: true, plan, periodStart: rolled.plusScansPeriodStart }
    }

    const used = typeof profile.freeScansUsed === 'number' && profile.freeScansUsed >= 0 ? profile.freeScansUsed : 0
    if (used >= SCAN_QUOTA.freeLifetime) {
      return { reserved: false, plan }
    }
    tx.set(userRef, { freeScansUsed: used + 1 }, { merge: true })
    return { reserved: true, plan }
  })
}

// Undoes a successful reservation when the paid model call itself fails
// (Claude API error, network failure, etc.) — the account must not lose
// real quota for a scan that never actually processed anything.
export async function rollbackScanReservation(db, userRef, plan, periodStart) {
  await db.runTransaction(async tx => {
    const snap = await tx.get(userRef)
    const profile = snap.exists ? snap.data() : {}
    if (plan === 'plus') {
      // If the billing period has since rolled over, the counter was
      // already reset for a NEW period by that rollover — decrementing
      // now would incorrectly reduce genuine new-period usage instead of
      // undoing a reservation that belonged to the OLD period. Skip in
      // that rare case; the failed reservation was already implicitly
      // wiped out by the rollover itself.
      if (profile.plusScansPeriodStart !== periodStart) return
      const current = typeof profile.plusScansUsed === 'number' ? profile.plusScansUsed : 0
      tx.set(userRef, { plusScansUsed: Math.max(0, current - 1) }, { merge: true })
    } else {
      const current = typeof profile.freeScansUsed === 'number' ? profile.freeScansUsed : 0
      tx.set(userRef, { freeScansUsed: Math.max(0, current - 1) }, { merge: true })
    }
  })
}
