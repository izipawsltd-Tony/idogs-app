import { useRef } from 'react'

// Codex fix-round finding — Litter Showcase account-switch race:
// LittersPage.tsx resets all Showcase state (showcases/showcaseLoading/
// showcaseBusy/showcaseError/expandedLitter) the instant user?.uid
// changes, but an in-flight Showcase read or mutation started under the
// PREVIOUS account can still resolve after that reset, and would — with
// no guard — call setShowcases/setShowcaseError/etc with the old
// account's data, silently resurrecting it under the new account.
//
// Deliberately NOT useRequestGuard.ts's RequestGuardState reused
// directly. That class bumps its `generation` field on EVERY
// beginRequest() call, by design — correct for its own use case (one
// loader per page), but wrong here: LittersPage can have several
// Showcase operations for DIFFERENT litters genuinely in flight at the
// same time (the breeder expands two litter cards, or fires a bulk
// action on one while a puppy toggle on another is still pending), and
// a shared per-request counter would make the SECOND one's start
// invalidate the FIRST one's still-legitimate in-flight request the
// moment it began — a real, unrelated-litter cross-cancellation bug, not
// a fix for the account-switch race this class exists to close.
//
// ShowcaseRequestGuardState's `generation` therefore only ever advances
// on an ACCOUNT change (bumpAccountGeneration(), called exactly once,
// from LittersPage's existing uid-keyed reset effect) — never per
// request. Because of that, any number of concurrent Showcase operations
// — across any number of litters, or even the same litter — stay
// mutually non-interfering as long as the account hasn't changed; they
// only ever ALL invalidate together, at once, the moment it does. No
// additional per-litter/per-operation counter is layered on top: nothing
// in this design can make one litter's request invalidate another's, so
// there is no such race left for a second guard tier to close.
//
// Deliberately does NOT track component-mount state itself —
// LittersPage.tsx already has its own established mountedRef (Codex
// round 14, shared with its litters/dogs loader); every Showcase call
// site combines `mountedRef.current && guard.isCurrent(gen)`, rather
// than this class duplicating a second, competing "is it still mounted"
// concept.
//
// Plain class, no React dependency — mirrors useRequestGuard.ts's own
// RequestGuardState split for exactly the same reason stated there: it
// lets a Node test import and exercise the REAL production guard logic
// directly, rather than testing a hand-mirrored duplicate.
export class ShowcaseRequestGuardState {
  generation = 0

  // Call this, and ONLY this, when the account (user?.uid) actually
  // changes — never per individual Showcase request/operation.
  bumpAccountGeneration() {
    this.generation++
  }

  // Every Showcase async function calls this ONCE, before its first
  // `await`, and captures the return value in a local `const gen`.
  currentGeneration(): number {
    return this.generation
  }

  // Every Showcase async function checks `isCurrent(gen)` after EVERY
  // await — in the success path, in a catch block, and in a finally
  // block — before writing any state or showing a toast. Returns false
  // once the account has changed since `gen` was captured (i.e. this
  // continuation belongs to a superseded account) — never true again for
  // that same `gen` afterward, since `generation` only ever increases.
  isCurrent(gen: number): boolean {
    return this.generation === gen
  }
}

// One ShowcaseRequestGuardState instance persists for the lifetime of
// the calling component instance (same useRef-holds-one-instance shape
// as useRequestGuard() in useRequestGuard.ts).
export function useShowcaseRequestGuard(): ShowcaseRequestGuardState {
  const stateRef = useRef<ShowcaseRequestGuardState | null>(null)
  if (!stateRef.current) stateRef.current = new ShowcaseRequestGuardState()
  return stateRef.current
}
