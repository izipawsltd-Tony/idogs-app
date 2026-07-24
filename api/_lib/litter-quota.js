// api/_lib/litter-quota.js — rolling-365-day litter quota enforcement for
// iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md §3.4/§4.1, LOCKED).
//
// "whelpingDate" in the pricing record maps to the Litter.actualBirthDate
// field already in this codebase's schema (api/_lib/litter-schema.js) —
// there is no separate whelpingDate field; a litter "whelps" the day it's
// actually born, which is exactly what actualBirthDate records. A litter
// without actualBirthDate is the record's "planned litter without a
// whelpingDate" (§4.1) — not yet counted.
//
// litterQuotaLedger is an append-only, permanent record of every litter
// that has ever counted against the rolling window — written once, the
// first time a litter's actualBirthDate is set, and never deleted or
// rewritten afterward (not even when the litter document itself is later
// hard-deleted by api/delete-litter.js, or its date is edited again — see
// api/update-litter.js, which now rejects changing an already-activated
// actualBirthDate outright, the simplest fully-correct reading of
// "prevent whelpingDate edits from evading quota"). This decouples quota
// tracking from the litter document's own lifecycle entirely, which is
// what makes "delete/archive must not restore quota" hold even for a
// litter that gets fully hard-deleted.

export const LITTER_QUOTA_BLOCK_MESSAGE =
  "You've reached your iDogs litter allowance of one litter in a rolling 12-month period. Breeding more regularly? Explore iziPaws."

export const LITTER_PLAN_GATE_MESSAGE =
  'Litters are an iDogs Plus feature. Upgrade to Plus to record litters — one every 12 months.'

export const LITTER_PLANNED_DUPLICATE_MESSAGE =
  'You already have a planned litter without a whelping date. Add its whelping date, or delete it, before starting another.'

export const LITTER_DATE_LOCKED_MESSAGE =
  'The whelping date is locked once set, to keep the litter allowance from being gamed by re-dating. Contact support to correct a genuine mistake.'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_MS = 365 * DAY_MS

// Both dates are 'YYYY-MM-DD' strings (already validated calendar dates
// by litter-schema.js). "within the 365 days preceding" (§3.4) — a
// one-directional, inclusive check against the PAST relative to the new
// date, exactly as worded in the pricing record.
export function isWithinRollingWindow(existingDate, newDate) {
  const existing = new Date(`${existingDate}T00:00:00Z`).getTime()
  const proposed = new Date(`${newDate}T00:00:00Z`).getTime()
  return existing <= proposed && existing >= proposed - WINDOW_MS
}

// Reads every ledger entry for this tenant (single where(), filtered/
// compared client-side per this repo's no-orderBy/composite-index
// convention — see CLAUDE.md) and returns true if any falls within the
// rolling window of `newDate`. Must be called with a transaction (`tx`)
// so the read is part of the same atomic operation as the litter write
// and ledger entry that follow — closes the race where two concurrent
// litter creations could otherwise both pass the check before either
// commits.
export async function hasLitterWithinRollingWindow(tx, db, tenantId, newDate) {
  const snap = await tx.get(db.collection('litterQuotaLedger').where('tenantId', '==', tenantId))
  return snap.docs.some(d => {
    const entry = d.data()
    return typeof entry.whelpingDate === 'string' && isWithinRollingWindow(entry.whelpingDate, newDate)
  })
}

export function writeLitterQuotaLedgerEntry(tx, db, { tenantId, litterId, whelpingDate }) {
  const ref = db.collection('litterQuotaLedger').doc()
  tx.set(ref, { tenantId, litterId, whelpingDate, recordedAt: new Date().toISOString() })
}

// §4.1 — "A Plus account may hold at most one un-dated planned litter at
// a time." Checked against the LIVE litters collection (not the ledger —
// an un-dated litter was never counted, so it isn't and shouldn't be
// ledgered), excluding archived litters and, when re-checking an existing
// litter, itself.
export async function hasOtherUndatedPlannedLitter(tx, db, tenantId, excludeLitterId = null) {
  const snap = await tx.get(db.collection('litters').where('tenantId', '==', tenantId))
  return snap.docs.some(d => {
    if (excludeLitterId && d.id === excludeLitterId) return false
    const litter = d.data()
    return !litter.archived && !litter.actualBirthDate
  })
}
