# Litter Quota Historical Backfill Plan (NOT EXECUTED)

**Status:** design only. No script in this repo runs this against any project.
Written in response to Codex H7 (`Pricing_Decision_Record_v1.1.md` §3.4/§4.1
rolling-365-day litter quota).

## Why this exists, and why it's optional right now

`api/_lib/litter-quota.js`'s `hasLitterWithinRollingWindow()` already has a
**correctness fallback**: if the immutable `litterQuotaLedger` has no entry
for a historical (pre-ledger) litter, it also scans the live `litters`
collection for any dated litter within the rolling window. This means
correctness does **not** depend on this backfill running — a legacy litter
already blocks a new one today, in both staging and (once promoted)
production.

What this backfill buys, once run, is purely an **efficiency and
defense-in-depth** improvement:
- The live-collection scan becomes unnecessary for backfilled tenants (one
  fewer read per litter-creation attempt).
- A ledger entry survives even if the legacy litter document is later
  hard-deleted by some other path (`api/delete-litter.js` only hard-deletes
  when no history-bearing dog is linked — a legacy litter predating that
  logic could theoretically still be removed by a from a manual Firestore
  console edit). The live-collection fallback cannot protect against a
  litter document that no longer exists at all.

**Recommendation:** run this only after the Pricing v1.1 branch has been
staging-verified and promoted to production, as a separate, low-urgency
follow-up — not a blocker for that promotion.

## Scope

Every document in `litters/{id}` where:
- `actualBirthDate` is a non-empty string (a real calendar date, already
  validated at write time by `api/_lib/litter-schema.js`), **and**
- no existing `litterQuotaLedger` document has `litterId == {id}`.

Both currently-live and `archived: true` litters are in scope — an archived
litter still represents a real whelping event and must still count (see
`Pricing_Decision_Record_v1.1.md` §3.4: "Deleting or archiving an old litter
does not restore quota").

## Idempotency

The backfill script must be safe to run multiple times without creating
duplicate ledger entries:

```js
// Pseudocode — not implemented in this repo.
for (const litterDoc of allDatedLitters) {
  const existing = await db.collection('litterQuotaLedger')
    .where('litterId', '==', litterDoc.id)
    .get() // single where(), filtered client-side — same convention as
           // the rest of this codebase (see CLAUDE.md)
  if (!existing.empty) continue // already backfilled — skip, not an error
  await db.collection('litterQuotaLedger').add({
    tenantId: litterDoc.data().tenantId,
    litterId: litterDoc.id,
    whelpingDate: litterDoc.data().actualBirthDate,
    recordedAt: new Date().toISOString(),
    backfilled: true, // distinguishes a backfilled entry from one written
                       // live by create-litter.js/update-litter.js, purely
                       // for auditability — never read by any quota check
  })
}
```

Running it twice in a row (or after a partial failure) produces the exact
same end state as running it once — every already-ledgered litter is
skipped, only genuinely un-ledgered ones get a new entry.

## Dry run

The script must default to **dry run**: enumerate what it would write
(tenantId, litterId, whelpingDate) and print/log counts, without calling
`.add()` at all. A separate explicit flag (e.g. `--execute`, matching this
repo's existing convention in `scripts/copy-prod-to-staging.mjs`) is
required to actually write. Dry-run output should report:

- Total dated litters scanned.
- Count already ledgered (skipped).
- Count that would be newly backfilled.
- Any litter with a malformed/unparseable `actualBirthDate` found during the
  scan (should be zero, given `litter-schema.js`'s write-time validation,
  but the script must not assume that and must fail closed — skip and
  report, never guess a date).

## Counts and verification

Before running with `--execute`:
1. Run dry run against **staging** (`idogs-app-staging`) first, verify the
   reported counts look sane against what's visually in the Litters page
   for known test accounts.
2. Run dry run against **production** (read-only — the script's dry-run
   mode never writes) and record the exact counts in the deploy/change log
   before proceeding.
3. After `--execute` on staging, re-run dry run — it must report zero
   "would backfill" (proving idempotency) and the correct "already ledgered"
   count.

Only after staging round-trip is clean does `--execute` run against
production, with the same before/after dry-run verification.

## Rollback

Every entry this script writes carries `backfilled: true`. Rollback (if a
mistake is discovered) is a targeted delete:

```js
// Pseudocode — not implemented in this repo.
const toRemove = await db.collection('litterQuotaLedger')
  .where('backfilled', '==', true)
  .get()
for (const doc of toRemove.docs) {
  await doc.ref.delete()
}
```

This can never remove a live-written (non-backfilled) ledger entry, since
`create-litter.js`/`update-litter.js` never set `backfilled: true`. Rollback
does not touch the `litters` collection itself at all — the live-collection
fallback in `hasLitterWithinRollingWindow()` continues to enforce quota
correctly for any litter whose backfilled ledger entry was rolled back,
exactly as it did before the backfill ran.

## Explicit non-goals

- This plan does **not** cover writing a `scripts/backfill-litter-ledger.mjs`
  file — that is future work, to be written and reviewed separately, gated
  on the same staging-first / dry-run-first discipline as
  `scripts/copy-prod-to-staging.mjs` (see that script's own header comment
  for the established hard-guard-against-writing-to-production pattern this
  should follow).
- This plan does not change `hasLitterWithinRollingWindow()`'s behavior —
  the live-collection fallback added for Codex H7 stays in place
  permanently as defense-in-depth, regardless of whether this backfill is
  ever run.
