// api/_lib/litter-quota.js — breeder-profile rolling-365-day litter quota.
//
// Commercial policy (2026-09-01):
// - Free: no litter creation.
// - Plus: 2 INCLUDED whelped litters per rolling 365 days.
// - Additional litters require one purchased Extra Litter credit each.
// - Quota belongs to the Breeder Profile, not the login/subscription.
// - Cancel, downgrade, resubscribe, archive, delete, or re-date attempts
//   never restore a consumed included slot or Extra Litter credit.
//
// The permanent litterQuotaLedger remains the historical source of truth.
// Existing pre-feature rows only have tenantId; new rows ALSO carry a
// deterministic breederProfileId and quotaSource. Live litter fallback
// remains for pre-ledger historical litters.

export const LITTER_INCLUDED_QUOTA = 2
export const EXTRA_LITTER_PRICE_AUD = 39
export const EXTRA_LITTER_PRICE_CENTS = 3900

export const LITTER_QUOTA_BLOCK_MESSAGE =
  "You've used the 2 litters included with iDogs Plus in this rolling 12-month period. Add another litter for A$39."

export const LITTER_PLAN_GATE_MESSAGE =
  'Litters are an iDogs Plus feature. Upgrade to Plus to record up to 2 litters per rolling 12 months.'

export const LITTER_PLANNED_DUPLICATE_MESSAGE =
  'You already have a planned litter without a whelping date. Add its whelping date, or delete it, before starting another.'

export const LITTER_DATE_LOCKED_MESSAGE =
  'The whelping date is locked once set, to keep the litter allowance from being gamed by re-dating. Contact support to correct a genuine mistake.'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_MS = 365 * DAY_MS

export function isWithinRollingWindow(existingDate, newDate) {
  const existing = new Date(`${existingDate}T00:00:00Z`).getTime()
  const proposed = new Date(`${newDate}T00:00:00Z`).getTime()
  return Math.abs(existing - proposed) <= WINDOW_MS
}

function isDatedWithin(entryDate, newDate) {
  return typeof entryDate === 'string' && entryDate.length > 0 && isWithinRollingWindow(entryDate, newDate)
}

function ledgerKey(entry, docId) {
  return typeof entry?.litterId === 'string' && entry.litterId ? entry.litterId : `ledger:${docId}`
}

async function addLedgerQuery(tx, query, rows, newDate, excludeLitterId = null) {
  const snap = await tx.get(query)
  for (const doc of snap.docs) {
    const entry = doc.data()
    if (excludeLitterId && entry.litterId === excludeLitterId) continue
    if (!isDatedWithin(entry.whelpingDate, newDate)) continue
    rows.set(ledgerKey(entry, doc.id), {
      litterId: entry.litterId || null,
      whelpingDate: entry.whelpingDate,
      quotaSource: entry.quotaSource === 'extra' ? 'extra' : (entry.quotaSource || 'included'),
      extraCreditId: entry.extraCreditId || null,
      source: 'ledger',
    })
  }
}

// Returns every distinct litter that must be considered in the proposed
// date's rolling window. New rows are found by breederProfileId. Legacy
// rows and pre-ledger live litters are bridged through related tenant UIDs.
// Ledger rows win over the live fallback so quotaSource:'extra' is kept.
export async function litterUsageWithinRollingWindow(
  tx,
  db,
  { breederProfileId, tenantIds, newDate, excludeLitterId = null },
) {
  const rows = new Map()
  const seenQueries = new Set()

  if (breederProfileId) {
    await addLedgerQuery(
      tx,
      db.collection('litterQuotaLedger').where('breederProfileId', '==', breederProfileId),
      rows,
      newDate,
      excludeLitterId,
    )
  }

  for (const tenantId of new Set(tenantIds || [])) {
    if (!tenantId || seenQueries.has(tenantId)) continue
    seenQueries.add(tenantId)
    await addLedgerQuery(
      tx,
      db.collection('litterQuotaLedger').where('tenantId', '==', tenantId),
      rows,
      newDate,
      excludeLitterId,
    )
  }

  // Historical live-litter fallback. Only add a live row when no ledger
  // row for the same litter already exists.
  for (const tenantId of new Set(tenantIds || [])) {
    if (!tenantId) continue
    const liveSnap = await tx.get(db.collection('litters').where('tenantId', '==', tenantId))
    for (const doc of liveSnap.docs) {
      if (excludeLitterId && doc.id === excludeLitterId) continue
      if (rows.has(doc.id)) continue
      const litter = doc.data()
      if (!isDatedWithin(litter.actualBirthDate, newDate)) continue
      rows.set(doc.id, {
        litterId: doc.id,
        whelpingDate: litter.actualBirthDate,
        quotaSource: 'included',
        extraCreditId: null,
        source: 'live-fallback',
      })
    }
  }

  const entries = [...rows.values()]
  const includedUsed = entries.filter(entry => entry.quotaSource !== 'extra').length
  const extraUsed = entries.filter(entry => entry.quotaSource === 'extra').length
  return { entries, includedUsed, extraUsed, includedLimit: LITTER_INCLUDED_QUOTA }
}

async function addCreditQuery(tx, query, byId) {
  const snap = await tx.get(query)
  for (const doc of snap.docs) {
    if (!byId.has(doc.id)) byId.set(doc.id, { id: doc.id, ref: doc.ref, ...doc.data() })
  }
}

export async function listExtraLitterCreditsTx(
  tx,
  db,
  { breederProfileId, purchasedByUid = null },
) {
  const byId = new Map()

  if (breederProfileId) {
    await addCreditQuery(
      tx,
      db.collection('litterQuotaCredits').where('breederProfileId', '==', breederProfileId),
      byId,
    )
  }
  // Same-account fallback protects a legitimate breeder who changes the
  // identity field used to derive breederProfileId after buying a credit.
  if (purchasedByUid) {
    await addCreditQuery(
      tx,
      db.collection('litterQuotaCredits').where('purchasedByUid', '==', purchasedByUid),
      byId,
    )
  }

  return [...byId.values()]
}

// Read-only selection. Caller performs the update only AFTER every other
// Firestore read in its transaction has completed.
export async function findAvailableExtraLitterCreditTx(
  tx,
  db,
  { breederProfileId, purchasedByUid = null },
) {
  const credits = await listExtraLitterCreditsTx(tx, db, { breederProfileId, purchasedByUid })
  return credits
    .filter(credit => credit.status === 'available')
    .sort((a, b) => String(a.purchasedAt || '').localeCompare(String(b.purchasedAt || '')) || a.id.localeCompare(b.id))[0] || null
}

export async function decideLitterQuotaTx(
  tx,
  db,
  { breederProfileId, tenantIds, purchasedByUid, newDate, excludeLitterId = null },
) {
  const usage = await litterUsageWithinRollingWindow(tx, db, {
    breederProfileId,
    tenantIds,
    newDate,
    excludeLitterId,
  })

  if (usage.includedUsed < LITTER_INCLUDED_QUOTA) {
    return { allowed: true, quotaSource: 'included', credit: null, usage }
  }

  const credit = await findAvailableExtraLitterCreditTx(tx, db, { breederProfileId, purchasedByUid })
  if (credit) {
    return { allowed: true, quotaSource: 'extra', credit, usage }
  }

  return { allowed: false, quotaSource: null, credit: null, usage }
}

export function consumeExtraLitterCredit(tx, credit, { litterId, consumedAt }) {
  if (!credit?.ref || credit.status !== 'available') {
    throw new Error('EXTRA_LITTER_CREDIT_NOT_AVAILABLE')
  }
  tx.update(credit.ref, {
    status: 'consumed',
    consumedByLitterId: litterId,
    consumedAt,
  })
}

export function writeLitterQuotaLedgerEntry(
  tx,
  db,
  { tenantId, breederProfileId, litterId, whelpingDate, quotaSource = 'included', extraCreditId = null },
) {
  const ref = db.collection('litterQuotaLedger').doc()
  tx.set(ref, {
    tenantId,
    breederProfileId: breederProfileId || null,
    litterId,
    whelpingDate,
    quotaSource,
    extraCreditId: extraCreditId || null,
    recordedAt: new Date().toISOString(),
  })
}

export async function hasLedgerEntryForLitter(tx, db, litterId) {
  const snap = await tx.get(db.collection('litterQuotaLedger').where('litterId', '==', litterId))
  return !snap.empty
}

// Backward-compatible helper retained for any old tests/callers that only
// need to know whether there is at least one litter in a window.
export async function hasLitterWithinRollingWindow(tx, db, tenantId, newDate, excludeLitterId = null) {
  const usage = await litterUsageWithinRollingWindow(tx, db, {
    breederProfileId: null,
    tenantIds: [tenantId],
    newDate,
    excludeLitterId,
  })
  return usage.entries.length > 0
}

// A breeder may keep at most one undated planned litter at a time. The
// check spans all known tenant UIDs for the same Breeder Profile, closing
// the account-recreation loophole for planned litters as well.
export async function hasOtherUndatedPlannedLitter(tx, db, tenantIdsOrId, excludeLitterId = null) {
  const tenantIds = Array.isArray(tenantIdsOrId) ? tenantIdsOrId : [tenantIdsOrId]
  for (const tenantId of new Set(tenantIds)) {
    if (!tenantId) continue
    const snap = await tx.get(db.collection('litters').where('tenantId', '==', tenantId))
    const hit = snap.docs.some(doc => {
      if (excludeLitterId && doc.id === excludeLitterId) return false
      const litter = doc.data()
      return !litter.archived && !litter.actualBirthDate
    })
    if (hit) return true
  }
  return false
}
