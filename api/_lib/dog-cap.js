// api/_lib/dog-cap.js — shared dog-count-cap enforcement for iDogs
// Pricing v1.2 (supersedes v1.1 §3.2/§3.3 for the litter-puppy question
// specifically — this is an approved policy change, not a v1.1
// regression; see isEligibleForCap()'s own comment for the exact rule).
//
// A dog counts toward a plan's cap iff: currentOwnerId === uid,
// status === 'active', isDeceased !== true, AND (it is not a
// litter-managed puppy still with its originating breeder, OR it has
// been explicitly retained/promoted). Firestore Rules cannot express a
// cross-document count, so — matching this codebase's own established
// pattern for anything Rules can't safely validate (litters, heat
// cycles, puppies all moved to trusted Admin SDK endpoints) — cap
// enforcement lives here, used inside a single db.runTransaction by every
// caller that changes which dogs are active: api/set-dog-status.js,
// api/reconcile-dog-cap.js, api/claim-transferred-dogs.js, and the
// Stripe webhook's downgrade path (api/stripe-webhook.js /
// api/enforce-billing-grace.js).
//
// Single where() + client-side filter/sort, per this repo's own
// CLAUDE.md convention (avoid composite-index dependencies — see
// "NEVER use orderBy()").
//
// Codex fix-round (Finding 3, HIGH): the original version of this file's
// automatic reconciliation inferred "this restricted litter puppy was
// mis-restricted by the old v1.1 cap bug" purely from its CURRENT SHAPE
// (restricted + litterId + unretained + still with the breeder). That
// inference cannot actually be proven — nothing recorded WHY a dog became
// 'restricted', so a puppy restricted for some other, legitimate reason
// (e.g. a future manual-restrict UI action) would have been silently,
// automatically reactivated too, with no way to tell the two cases apart.
// Fixed by adding an explicit, server-controlled `restrictionReason` field,
// written by every code path that sets status:'restricted':
//   - 'plan_cap_exceeded' — demoteExcessToRestricted() (below),
//     api/create-dog.js's over-cap creation, api/claim-transferred-dogs.js's
//     over-cap claim. All three are cap-driven; safe to auto-reactivate.
//   - 'manual' — api/set-dog-status.js's 'restrict' action (a deliberate,
//     explicit user action). NEVER auto-reactivated by anything in this
//     file.
// Cleared (FieldValue.delete()) on every transition OUT of 'restricted',
// so a stale reason never lingers into a future restriction.
//
// The automatic reconciliation functions below (reconcileDogCapTx,
// reactivateUpToCapTx) now ONLY auto-reactivate a misrestricted litter
// puppy when restrictionReason is EXPLICITLY 'plan_cap_exceeded' — proof,
// not shape-based inference. A LEGACY restricted litter puppy (restricted
// before this field existed, so restrictionReason is simply absent) is no
// longer touched by these automatic paths at all — Codex's explicit
// instruction: "Do not automatically reactivate records based only on
// their shape." Those are instead handled conservatively by a separate,
// explicit, scoped, per-dog, authenticated action —
// api/reconcile-litter-puppy.js — which additionally validates real litter
// ownership (the referenced litters/{litterId} document exists and
// belongs to the caller) and explicitly refuses anything tagged 'manual'.

import { FieldValue } from 'firebase-admin/firestore'

export const DOG_CAP = Object.freeze({ free: 2, plus: 5 })

// Super Admin fix round: `unlimited` is a SEPARATE signal from `plan` —
// callers derive it from api/_lib/entitlements.js's
// hasValidInternalEntitlement(profile), never from plan itself (a valid
// internal entitlement already makes computeEffectivePlan(profile)
// resolve to 'plus', but Plus's own cap is a finite 5 — a genuine
// Super Admin bypass needs a real "no ceiling", not "inherit Plus's
// number"). Defaults to false so every EXISTING caller that doesn't pass
// it (the entire Stripe webhook/grace-cron path, which only ever passes
// a literal 'plus'/'free' string derived from the Stripe event itself,
// never a live profile) is completely unaffected — a real subscription
// event can never accidentally grant or imply unlimited.
export function capForPlan(plan, unlimited = false) {
  if (unlimited) return Infinity
  return plan === 'plus' ? DOG_CAP.plus : DOG_CAP.free
}

// ── Pricing v1.2 — the ONE central eligibility predicate ────────────
//
// THE RULE: "Litter-managed puppies do not count toward the cap. A
// puppy starts counting only when explicitly retained/promoted into the
// breeder's independent Dog List or breeding stock." (approved product
// decision, superseding v1.1's uniform "every active dog counts" rule
// for this one case).
//
// THE SIGNAL — why it's trustworthy: a dog is treated as a
// still-litter-managed puppy iff `litterId` is present AND
// `retainedByBreeder !== true` AND the dog has not left the ORIGINATING
// breeder (`currentOwnerId === tenantId`). All three fields are
// server-controlled:
//   - `litterId` is written exactly once, by api/create-litter-puppy.js
//     (Admin SDK), and is now protected from any direct client write by
//     firestore.rules' dogProtectedFieldsUnchanged() (see that file) —
//     a client can no longer forge a fake litterId onto a standalone dog
//     to dodge the cap, nor strip a real one to force early counting.
//   - `retainedByBreeder` is written ONLY by api/set-dog-status.js's new
//     'promote'/'unpromote' actions (Admin SDK, cap-checked inside the
//     same transaction as the write) — also added to
//     dogProtectedFieldsUnchanged(), so a client cannot self-grant a cap
//     slot by writing this field directly either.
//   - `currentOwnerId`/`tenantId` were ALREADY permanently protected
//     (dogProtectedFieldsUnchanged(), pre-existing) — this is what makes
//     the "still with the originating breeder" check reliable, and is
//     also exactly why a TRANSFERRED/CLAIMED puppy (currentOwnerId no
//     longer equals tenantId) falls through to counting normally for
//     its new owner: once it's no longer being litter-managed by the
//     breeder who whelped it, "litter-managed puppy" no longer applies —
//     preserving existing transfer/claim cap behavior unchanged (Codex
//     H2 / §4.4), not a new exemption for the receiving account.
//
// No client-controlled field is trusted anywhere in this check.
export function isEligibleForCap(dog) {
  if ((dog.status || 'active') !== 'active') return false
  if (dog.isDeceased === true) return false
  const isUnpromotedLitterPuppy = !!dog.litterId &&
    dog.retainedByBreeder !== true &&
    dog.currentOwnerId === dog.tenantId
  return !isUnpromotedLitterPuppy
}

// Codex fix-round (Finding 3): a dog that is 'restricted' AND explicitly
// tagged restrictionReason:'plan_cap_exceeded' AND still shaped like an
// unpromoted litter puppy (same three-field signal as isEligibleForCap()
// above) was NEVER supposed to consume a cap slot in the first place —
// the cap-driven write that restricted it happened before this litter
// puppy ever became cap-exempt, or (going forward) the puppy's own
// eligibility changed between when it was restricted and now (e.g. it was
// promoted, then unpromoted again). Requiring the EXPLICIT reason (not
// just the shape) is what makes this safe to auto-reactivate: a puppy
// restricted for any OTHER, non-cap reason (restrictionReason:'manual', or
// no reason recorded at all — a legacy record from before this field
// existed) is deliberately NOT matched here, and is never touched by the
// automatic reconciliation functions below. Also does NOT match a
// genuinely cap-restricted adult/breeding dog, a promoted-then-restricted
// puppy, or a transferred/claimed dog — none of those are misrestrictions.
function isConfirmedCapRestrictedLitterPuppy(dog) {
  return dog.status === 'restricted' &&
    dog.restrictionReason === 'plan_cap_exceeded' &&
    dog.isDeceased !== true &&
    !!dog.litterId &&
    dog.retainedByBreeder !== true &&
    dog.currentOwnerId === dog.tenantId
}

// createdAt is NOT a consistent shape across creation paths: createDog()
// (client SDK, the main "+ Add dog" UI flow) writes it via Firestore's
// serverTimestamp() sentinel, which the Admin SDK reads back as a real
// Timestamp instance (with a .toDate() method) — never a string.
// create-litter-puppy.js (Admin SDK), by contrast, writes a plain
// `new Date().toISOString()` string. Found via live staging QA: treating
// only the string shape as "known" silently sorted every serverTimestamp()
// dog as if it had no createdAt at all (falling back to '', tying with
// every other such dog and leaving their relative order to whatever
// arbitrary sequence Firestore's un-ordered where() query happened to
// return) — on an account where every dog came through the client SDK
// path, this meant "earliest-created stays active" was not actually being
// honored; only the correct COUNT was. Both real shapes are normalized to
// an ISO string here; a genuinely missing/malformed value still falls back
// to '' (sorts first/oldest) rather than throwing or being excluded.
// Also accepts a native Date instance directly (Codex Medium item) — not
// a shape any current write path produces, but a cheap, safe addition
// since callers of these helpers are not guaranteed to stay Admin-SDK-only.
function createdAtKey(dog) {
  const raw = dog.createdAt
  if (typeof raw === 'string') return raw
  if (raw instanceof Date) return raw.toISOString()
  if (raw && typeof raw.toDate === 'function') return raw.toDate().toISOString()
  if (raw && typeof raw._seconds === 'number') return new Date(raw._seconds * 1000).toISOString()
  return ''
}

// Secondary comparator for createdAtKey ties (Codex Medium item —
// deterministic dog-ID tie-breaking). Two dogs created in the same
// request batch (e.g. a litter's puppies, all written with the same
// `new Date().toISOString()` value) previously had their relative order
// left to whatever arbitrary sequence Firestore's un-ordered where()
// query happened to return, which could vary between reads — undermining
// the "earliest-created stays active" cap rule's determinism. Sorting by
// `id` as a tiebreaker doesn't recover true creation order (Firestore
// auto-IDs aren't chronological) but guarantees the SAME dog is picked
// consistently across repeated calls, which is what §3.3 predictability
// actually requires.
function compareDogsByCreatedAt(a, b) {
  const byCreatedAt = createdAtKey(a).localeCompare(createdAtKey(b))
  if (byCreatedAt !== 0) return byCreatedAt
  return a.id.localeCompare(b.id)
}

// Returns every dog this uid currently, actively owns — eligible for the
// cap count per Pricing v1.2's isEligibleForCap() above — sorted
// oldest-created-first. Must be called with a transaction (`tx`) so the
// read is part of the same atomic operation as any write that follows it.
export async function getOwnedActiveDogsSorted(tx, db, uid) {
  const snap = await tx.get(db.collection('dogs').where('currentOwnerId', '==', uid))
  const dogs = snap.docs
    .map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter(isEligibleForCap)
  dogs.sort(compareDogsByCreatedAt)
  return dogs
}

// Demotes the newest active dogs beyond `cap` to 'restricted', keeping the
// earliest-created `cap` dogs active — the default §3.3 rule ("If no
// choice is made, the system defaults to the 2 earliest-created dogs").
// A no-op when already within cap. Must run inside `tx`. Returns the ids
// demoted.
export function demoteExcessToRestricted(tx, activeDogsSorted, cap) {
  const excess = activeDogsSorted.slice(cap)
  const nowIso = new Date().toISOString()
  for (const dog of excess) {
    // restrictionReason:'plan_cap_exceeded' — see this file's header
    // comment. This is the ONLY thing that later lets automatic
    // reconciliation prove (not guess) that a restriction was cap-driven.
    tx.update(dog.ref, { status: 'restricted', restrictionReason: 'plan_cap_exceeded', updatedAt: nowIso })
  }
  return excess.map(d => d.id)
}

// Convenience wrapper combining the two above — used by the webhook
// downgrade path, the grace-period cron sweep, and api/reconcile-dog-cap.js
// (called automatically after every dog creation), all of which just want
// "bring this account's active-dog count down to its current plan's cap"
// with no dog-by-dog choice involved.
//
// Pricing v1.2, Task 6 (redesigned in the Codex fix round — Finding 3) —
// the "safe, idempotent reconciliation mechanism" for litter puppies whose
// restriction is PROVABLY cap-driven: reactivates any of this uid's own
// isConfirmedCapRestrictedLitterPuppy() matches (restrictionReason
// EXPLICITLY 'plan_cap_exceeded' — see this file's header), unconditionally
// (they never consumed a slot), regardless of which plan/cap this call is
// reconciling against. Touches NOTHING else — no other restricted dog
// (adult, promoted puppy, transferred/claimed dog, manually-restricted
// dog, or a LEGACY litter puppy with no restrictionReason recorded at all)
// is ever reactivated by this. Legacy litter puppies are handled instead
// by the separate, explicit api/reconcile-litter-puppy.js action — see
// this file's header comment for why shape alone is no longer trusted
// here. Deliberately does ONE read of this uid's dogs up front, not a
// call into getOwnedActiveDogsSorted() as a separate read — Firestore
// transactions require every read to happen before any write, so
// reactivating (a write) and then re-reading for the demotion count would
// throw; both the reactivate-candidates and the eligible-active-count are
// derived from this SAME snapshot instead. This is deliberately NOT a
// batch/production migration: it only ever touches the calling user's own
// data, via api/reconcile-dog-cap.js — which already runs automatically
// for every signed-in user right after they create a dog — the next time
// THEY trigger it. Safe no-op, repeatable, for every account with nothing
// to fix.
export async function reconcileDogCapTx(tx, db, uid, plan, unlimited = false) {
  const snap = await tx.get(db.collection('dogs').where('currentOwnerId', '==', uid))
  const all = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))

  const misrestrictedPuppies = all.filter(isConfirmedCapRestrictedLitterPuppy)
  const active = all.filter(isEligibleForCap)
  active.sort(compareDogsByCreatedAt)

  const nowIso = new Date().toISOString()
  for (const dog of misrestrictedPuppies) {
    tx.update(dog.ref, { status: 'active', restrictionReason: FieldValue.delete(), updatedAt: nowIso })
  }
  const misrestrictedPuppiesReactivated = misrestrictedPuppies.map(d => d.id)

  const cap = capForPlan(plan, unlimited)
  if (active.length <= cap) return { demoted: [], cap, activeCount: active.length, misrestrictedPuppiesReactivated }
  const demoted = demoteExcessToRestricted(tx, active, cap)
  return { demoted, cap, activeCount: cap, misrestrictedPuppiesReactivated }
}

// Reactivates restricted dogs, earliest-created first, up to `cap` — the
// §3.3 upgrade rule ("On upgrade back to Plus, all restricted dogs return
// to active automatically, up to the new cap of 5. If more than 5 exist,
// the earliest-created 5 become active and the user is prompted to
// choose."). Never touches archived dogs (a deliberate user action,
// distinct from a system-imposed restriction). Must run inside `tx`.
//
// Pricing v1.2 (redesigned in the Codex fix round — Finding 3):
// PROVABLY cap-restricted litter puppies (see
// isConfirmedCapRestrictedLitterPuppy() above — restrictionReason
// EXPLICITLY 'plan_cap_exceeded') are reactivated FIRST and
// UNCONDITIONALLY — they never consumed a cap slot under the current
// rule, so reactivating them costs no "room" and is never gated by it. A
// legacy litter puppy with no restrictionReason recorded is NOT touched
// here — see api/reconcile-litter-puppy.js. Only genuinely cap-restricted
// dogs draw from the remaining room, exactly as before this change.
export async function reactivateUpToCapTx(tx, db, uid, plan, unlimited = false) {
  const cap = capForPlan(plan, unlimited)
  const activeSnap = await tx.get(db.collection('dogs').where('currentOwnerId', '==', uid))
  const all = activeSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
  const currentlyActive = all.filter(isEligibleForCap)

  const misrestrictedPuppies = all.filter(isConfirmedCapRestrictedLitterPuppy)
  const restricted = all.filter(d => d.status === 'restricted' && d.isDeceased !== true && !isConfirmedCapRestrictedLitterPuppy(d))
  restricted.sort(compareDogsByCreatedAt)

  const nowIso = new Date().toISOString()
  for (const dog of misrestrictedPuppies) {
    tx.update(dog.ref, { status: 'active', restrictionReason: FieldValue.delete(), updatedAt: nowIso })
  }

  const room = Math.max(0, cap - currentlyActive.length)
  const toReactivate = restricted.slice(0, room)
  for (const dog of toReactivate) {
    tx.update(dog.ref, { status: 'active', restrictionReason: FieldValue.delete(), updatedAt: nowIso })
  }
  const remainingRestricted = restricted.length - toReactivate.length
  return {
    reactivated: toReactivate.map(d => d.id),
    remainingRestricted,
    misrestrictedPuppiesReactivated: misrestrictedPuppies.map(d => d.id),
  }
}
