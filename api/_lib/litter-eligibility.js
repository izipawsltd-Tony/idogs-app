// api/_lib/litter-eligibility.js — the canonical server-side "which of
// this litter's puppies are still safe to delete/edit alongside it"
// policy (Codex round 4, Blockers 3 + 5).
//
// Mirrors src/pages/LittersPage.tsx's own partitionLitterCandidates
// exactly (that copy remains client-side too, used ONLY to word the
// non-authoritative confirm() dialog before the request is even sent —
// see that file's own comment). This copy is the one that actually
// decides what gets deleted/edited, inside api/delete-litter.js and
// api/update-litter.js's Admin SDK transactions. Keep both in sync by
// hand; a client-side preview being briefly stale is harmless (the
// server always re-decides fresh), but this copy drifting from the
// server behavior it's meant to describe would mean the toast/dialog
// lies about what actually happened.
//
// A dog only counts as a confirmed member of `litterId` if its own
// litterId explicitly agrees (a legacy dog with no litterId can't be
// confirmed either way from its own record, so it's excluded entirely
// rather than assumed eligible on the strength of the litter's forward
// reference alone). A confirmed member is eligible for deletion/DOB-
// propagation only if it's still exclusively breeder-controlled AND has
// NO ownership history at all — Codex round 4, Blocker 5: buyerEmail is
// not the only history signal, and claimedBy is checked independently
// too (a legacy/partial record could in principle carry claimedBy
// without claimedAt, or vice versa — either one alone must still block).
export function partitionLitterCandidatesServer(litterId, fetched, requesterUid) {
  const confirmedMembers = fetched.filter(d => d.litterId === litterId)
  const ambiguousCount = fetched.length - confirmedMembers.length
  const eligible = confirmedMembers.filter(d =>
    d.currentOwnerId === requesterUid &&
    d.status !== 'transferred' &&
    d.transferStatus !== 'pendingClaim' &&
    !d.buyerEmail && !d.previousOwnerId && !d.transferredAt && !d.claimedAt && !d.claimedBy
  )
  const preserved = confirmedMembers.length - eligible.length
  return { confirmedMembers, ambiguousCount, eligible, preserved }
}
