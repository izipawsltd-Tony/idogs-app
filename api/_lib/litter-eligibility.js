// api/_lib/litter-eligibility.js — the canonical server-side "is this
// Dog still safe to delete/edit/detach alongside its litter" policy
// (Codex round 4, Blockers 3 + 5; hardened Codex round 5, Blockers 1-3).
//
// Mirrors src/pages/LittersPage.tsx's own partitionLitterCandidates
// exactly (that copy remains client-side too, used ONLY to word the
// non-authoritative confirm() dialog before the request is even sent —
// see that file's own comment). This copy is the one that actually
// decides what gets deleted/edited/unlinked, inside
// api/delete-litter.js, api/update-litter.js, and
// api/remove-litter-puppy.js's Admin SDK transactions. Keep both in sync
// by hand; a client-side preview being briefly stale is harmless (the
// server always re-decides fresh), but this copy drifting from the
// server behavior it's meant to describe would mean the toast/dialog
// lies about what actually happened.

// Codex round 5, Blocker 3: presence, not truthiness. A history field
// being present at all — even an empty string, 0, or false — is a
// signal this Dog has SOME history that couldn't be cleanly resolved,
// and must fail closed (preserved), never silently treated as "no
// history" the way `!dog.buyerEmail` would (that collapses '', 0, false,
// null, and undefined all into the same "falsy = clean" bucket, which is
// wrong: an empty-but-PRESENT buyerEmail is a malformed/partial record,
// not a clean one). This is also what makes the Admin SDK checks here
// match firestore.rules' own semantics: Rules' `.get(field, null)`
// returns the DEFAULT only when the field is genuinely absent — a
// present-but-empty-string value is returned as-is and fails a
// `== null` check, exactly like this hasOwnProperty-based check does.
const HISTORY_FIELDS = ['buyerEmail', 'previousOwnerId', 'transferredAt', 'claimedAt', 'claimedBy']

export function isDogHistoryBearing(dog) {
  return HISTORY_FIELDS.some(field =>
    Object.prototype.hasOwnProperty.call(dog, field) &&
    dog[field] !== null &&
    dog[field] !== undefined
  )
}

// Codex round 5, Blocker 1: a Dog is safe to detach from a litter (unlink
// or delete alongside it) only if it is CURRENTLY, fully, and
// unambiguously controlled by the requester — every one of these is an
// independent, non-overridable gate:
//   - currentOwnerId is exactly the requester (not merely tenantId
//     provenance);
//   - status/transferStatus show no transfer in flight;
//   - no ownership-history field is present at all (see above) — this
//     alone also covers "claimed", since a claim always sets claimedAt/
//     claimedBy.
// Ambiguity (a dog whose OWN litterId doesn't confirm membership in the
// litter being acted on) is intentionally NOT decided here — see
// resolveLitterMembership below, which is where "confirmed member" is
// established before this function is ever asked to weigh in.
export function isDogSafeToDetach(dog, requesterUid) {
  if (!dog) return false
  if (dog.currentOwnerId !== requesterUid) return false
  if (dog.status === 'transferred' || dog.transferStatus === 'pendingClaim') return false
  if (isDogHistoryBearing(dog)) return false
  return true
}

// Codex round 5, Blocker 2: litter membership must be resolved from
// BOTH directions, not just the litter's forward puppyIds array —
//   - forward: dogId in litter.puppyIds;
//   - reverse: dog.litterId === litterId (found via a direct query, not
//     by only checking dogs already listed in puppyIds).
// A dog is a CONFIRMED member only if both directions agree (forward-
// listed AND dog.litterId matches). forward-only (listed in puppyIds but
// the dog's own litterId disagrees or is absent) and reverse-only
// (dog.litterId matches but it was never added to puppyIds — e.g. a
// partial write that updated the Dog but not the Litter) are each
// AMBIGUOUS: no clean membership signal either way, so — same fail-safe
// posture as round 3/4's "ambiguous legacy dog" handling — never
// silently resolved to "definitely a member" OR "definitely not"; they
// are surfaced separately so callers can decide whether to reconcile
// them (see reconcileAmbiguousMembership in delete-litter.js) rather
// than being folded into "confirmed" and risking an incorrect delete/
// detach, or being silently dropped and leaving a dangling reference.
//
// `forwardFetched`: dogs fetched from litter.puppyIds (may include
// dogs whose own litterId disagrees or is missing).
// `reverseFetched`: dogs fetched via a direct query on dog.litterId ==
// litterId (may include dogs never added to puppyIds).
export function resolveLitterMembership(litterId, forwardFetched, reverseFetched) {
  const byId = new Map()
  for (const dog of forwardFetched) byId.set(dog.id, { dog, forward: true, reverse: dog.litterId === litterId })
  for (const dog of reverseFetched) {
    const existing = byId.get(dog.id)
    if (existing) existing.reverse = true
    else byId.set(dog.id, { dog, forward: false, reverse: true })
  }

  const confirmed = []
  const forwardOnly = [] // listed in puppyIds, but dog.litterId disagrees/absent
  const reverseOnly = [] // dog.litterId matches, but never listed in puppyIds
  for (const entry of byId.values()) {
    if (entry.forward && entry.reverse) confirmed.push(entry.dog)
    else if (entry.forward && !entry.reverse) forwardOnly.push(entry.dog)
    else if (!entry.forward && entry.reverse) reverseOnly.push(entry.dog)
  }
  return { confirmed, forwardOnly, reverseOnly, ambiguousCount: forwardOnly.length + reverseOnly.length }
}

// Partitions CONFIRMED members (both directions agree) into eligible
// (safe to hard-delete/detach) vs preserved (history-bearing, not
// currently controlled, or mid-transfer). forwardOnly/reverseOnly dogs
// are never passed to this function — they're ambiguous, handled
// separately by the caller (never deleted, never silently included).
export function partitionConfirmedMembers(confirmedMembers, requesterUid) {
  const eligible = confirmedMembers.filter(dog => isDogSafeToDetach(dog, requesterUid))
  const preserved = confirmedMembers.filter(dog => !isDogSafeToDetach(dog, requesterUid))
  return { eligible, preserved }
}

// Back-compat convenience wrapper matching the pre-round-5 signature
// (forward-only membership, no reverse query) — used by
// api/update-litter.js's DOB-propagation, which only ever needs to
// consider puppies already reachable via litter.puppyIds (propagating a
// birth-date correction to a dog nobody has linked to this litter yet
// makes no sense), and by the client-side preview in LittersPage.tsx's
// own independent copy of this same logic.
export function partitionLitterCandidatesServer(litterId, fetched, requesterUid) {
  const confirmedMembers = fetched.filter(dog => dog.litterId === litterId)
  const ambiguousCount = fetched.length - confirmedMembers.length
  const { eligible, preserved } = partitionConfirmedMembers(confirmedMembers, requesterUid)
  return { confirmedMembers, ambiguousCount, eligible, preserved: preserved.length }
}
