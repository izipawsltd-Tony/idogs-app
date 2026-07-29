// api/_lib/showcase-access.js — shared authorization checks for every
// Litter Showcase endpoint (Slice 1).
//
// Slice 1 requirements 9 + 10 + SECURITY: only the owning breeder/tenant
// may manage a Showcase, and Owner/Free-plan accounts must not be able
// to reach breeder controls — server-side, not merely hidden in the UI.
// Litters themselves already require plan 'plus' to CREATE (see
// api/create-litter.js's LITTER_PLAN_GATE_MESSAGE) — but an account can
// still legitimately downgrade back to 'free' after creating litters, so
// this is checked fresh on every Showcase mutation rather than assumed
// from the litter's mere existence. Mirrors computeEffectivePlan's call
// contract (api/_lib/entitlements.js) — pass in a users/{uid} profile
// already read via the Admin SDK, never trust client input.
//
// Deliberately return-based, not throw-based — mirrors
// api/create-litter.js / api/update-litter.js's own
// `{ ok: false, status, body }` transaction-result convention (see
// those files' own comments) rather than throwing across a
// db.runTransaction() boundary, so every Showcase endpoint's transaction
// body reads the same way as the rest of this codebase's litter
// endpoints.

import { computeEffectivePlan } from './entitlements.js'

export const SHOWCASE_ROLE_PLAN_GATE_MESSAGE = 'Litter Showcase is available to Plus-plan breeders'

// Returns an { ok:false, status, body } result if the profile is not a
// 'breeder'/'admin' on an effective 'plus' plan, or null when access is
// granted. Never trusts a client-supplied role/plan — `profile` must
// come from a fresh Admin SDK read of users/{uid} taken inside the same
// transaction as any write that follows.
export function checkBreederPlusAccess(profile) {
  const role = profile?.role
  if (role !== 'breeder' && role !== 'admin') {
    return { ok: false, status: 403, body: { error: SHOWCASE_ROLE_PLAN_GATE_MESSAGE, reason: 'SHOWCASE_ROLE_GATE' } }
  }
  if (computeEffectivePlan(profile) !== 'plus') {
    return { ok: false, status: 403, body: { error: SHOWCASE_ROLE_PLAN_GATE_MESSAGE, reason: 'SHOWCASE_PLAN_GATE' } }
  }
  return null
}

// Reads litters/{litterId} inside `tx` and verifies it exists and is
// owned by `uid`. Returns { litter } on success or { error: {ok:false,...} }
// otherwise — the same ownership contract every other litter-touching
// endpoint (update-litter.js, delete-litter.js, remove-litter-puppy.js)
// already applies, kept here once so Showcase endpoints don't each
// re-derive it.
export async function loadOwnedLitter(tx, db, litterId, uid) {
  const litterSnap = await tx.get(db.collection('litters').doc(litterId))
  if (!litterSnap.exists) {
    return { error: { ok: false, status: 404, body: { error: 'Litter not found' } } }
  }
  const litter = litterSnap.data()
  if (litter.tenantId !== uid) {
    return { error: { ok: false, status: 403, body: { error: 'Not your litter' } } }
  }
  return { litter }
}

// Reads litterShowcases/{litterId} inside `tx` and verifies it exists
// and is owned by `uid`. Returns { showcase } on success or
// { error: {ok:false,...} } otherwise.
export async function loadOwnedShowcase(tx, db, litterId, uid) {
  const showcaseSnap = await tx.get(db.collection('litterShowcases').doc(litterId))
  if (!showcaseSnap.exists) {
    return { error: { ok: false, status: 404, body: { error: 'Showcase not found for this litter' } } }
  }
  const showcase = showcaseSnap.data()
  if (showcase.tenantId !== uid) {
    return { error: { ok: false, status: 403, body: { error: 'Not your showcase' } } }
  }
  return { showcase }
}
