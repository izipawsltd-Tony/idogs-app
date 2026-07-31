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

export const DOG_CAP = Object.freeze({ free: 2, plus: 5 })

export function capForPlan(plan) {
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

// Pricing v1.2, Task 6 — a dog that is 'restricted' purely because it's
// a litter-managed puppy that was cap-restricted under the OLD (v1.1)
// rule was NEVER supposed to consume a cap slot in the first place. This
// identifies exactly that (and only that) shape: still litter-managed
// (same three-field signal as isEligibleForCap() above — litterId
// present, never retained, never left the originating breeder), currently
// restricted, not deceased. Deliberately does NOT match a genuinely
// cap-restricted adult/breeding dog, a promoted-then-restricted puppy,
// or a transferred/claimed dog — none of those were ever mis-restricted,
// and none should ever be silently reactivated by this check.
function isMisrestrictedLitterPuppy(dog) {
  return dog.status === 'restricted' &&
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
    tx.update(dog.ref, { status: 'restricted', updatedAt: nowIso })
  }
  return excess.map(d => d.id)
}

// Convenience wrapper combining the two above — used by the webhook
// downgrade path, the grace-period cron sweep, and api/reconcile-dog-cap.js
// (called automatically after every dog creation), all of which just want
// "bring this account's active-dog count down to its current plan's cap"
// with no dog-by-dog choice involved.
//
// Pricing v1.2, Task 6 — the "safe, idempotent reconciliation mechanism"
// for existing litter puppies restricted solely under the old (v1.1)
// rule: also reactivates any of this uid's own isMisrestrictedLitterPuppy()
// matches, unconditionally (they never consumed a slot), regardless of
// which plan/cap this call is reconciling against. Touches NOTHING else —
// no other restricted dog (adult, promoted puppy, transferred/claimed
// dog) is ever reactivated by this. Deliberately does ONE read of this
// uid's dogs up front, not a call into getOwnedActiveDogsSorted() as a
// separate read — Firestore transactions require every read to happen
// before any write, so reactivating (a write) and then re-reading for the
// demotion count would throw; both the reactivate-candidates and the
// eligible-active-count are derived from this SAME snapshot instead. This
// is deliberately NOT a batch/production migration: it only ever touches
// the calling user's own data, via api/reconcile-dog-cap.js — which
// already runs automatically for every signed-in user right after they
// create a dog — the next time THEY trigger it. Safe no-op, repeatable,
// for every account with nothing to fix.
export async function reconcileDogCapTx(tx, db, uid, plan) {
  const snap = await tx.get(db.collection('dogs').where('currentOwnerId', '==', uid))
  const all = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))

  const misrestrictedPuppies = all.filter(isMisrestrictedLitterPuppy)
  const active = all.filter(isEligibleForCap)
  active.sort(compareDogsByCreatedAt)

  const nowIso = new Date().toISOString()
  for (const dog of misrestrictedPuppies) {
    tx.update(dog.ref, { status: 'active', updatedAt: nowIso })
  }
  const misrestrictedPuppiesReactivated = misrestrictedPuppies.map(d => d.id)

  const cap = capForPlan(plan)
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
// Pricing v1.2: mis-restricted litter puppies (see
// isMisrestrictedLitterPuppy() above) are reactivated FIRST and
// UNCONDITIONALLY — they never consumed a cap slot under the current
// rule, so reactivating them costs no "room" and is never gated by it.
// Only genuinely cap-restricted dogs draw from the remaining room, exactly
// as before this change.
export async function reactivateUpToCapTx(tx, db, uid, plan) {
  const cap = capForPlan(plan)
  const activeSnap = await tx.get(db.collection('dogs').where('currentOwnerId', '==', uid))
  const all = activeSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
  const currentlyActive = all.filter(isEligibleForCap)

  const misrestrictedPuppies = all.filter(isMisrestrictedLitterPuppy)
  const restricted = all.filter(d => d.status === 'restricted' && d.isDeceased !== true && !isMisrestrictedLitterPuppy(d))
  restricted.sort(compareDogsByCreatedAt)

  const nowIso = new Date().toISOString()
  for (const dog of misrestrictedPuppies) {
    tx.update(dog.ref, { status: 'active', updatedAt: nowIso })
  }

  const room = Math.max(0, cap - currentlyActive.length)
  const toReactivate = restricted.slice(0, room)
  for (const dog of toReactivate) {
    tx.update(dog.ref, { status: 'active', updatedAt: nowIso })
  }
  const remainingRestricted = restricted.length - toReactivate.length
  return {
    reactivated: toReactivate.map(d => d.id),
    remainingRestricted,
    misrestrictedPuppiesReactivated: misrestrictedPuppies.map(d => d.id),
  }
}
