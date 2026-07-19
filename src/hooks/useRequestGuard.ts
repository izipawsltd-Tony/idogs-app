import { useLayoutEffect, useRef } from 'react'

// Codex round 15: every async loader keyed off the signed-in user (Dashboard,
// Audit, Documents, Export, DogList, DogDetail's BreedingTab, Buyers,
// Reminders, Reports, Litters, AppLayout) shares the same race-condition
// shape LittersPage's retry loop already had to solve in round 14 — a
// mountedRef + a monotonic generation token — but here the race is broader
// than just "an old retry resolves late": switching accounts (logout +
// login as someone else, or a buyer claiming a dog mid-session) reassigns
// `user.uid` while an in-flight request for the PREVIOUS uid may still be
// pending. Without a guard, that stale response can land after the new
// account's own load has started (or even after it's finished) and
// overwrite the new account's state with the old account's data — a
// genuine cross-account data leak, not just a UI glitch.
//
// Codex round 16: round 15's version updated the tracked uid inside a
// plain useEffect — a PASSIVE effect, which React flushes strictly after
// the browser has already painted. Round 16 "fixed" this by writing
// `state.uid` directly in the render body instead.
//
// Codex round 17: that render-body write was itself unsafe. React can
// call a component's render function WITHOUT ever committing the result —
// a render can be started and then abandoned/discarded (superseded by a
// higher-priority update, thrown away after a Suspense retry, or
// otherwise interrupted) before it ever reaches the commit phase. If uid
// changes to 'B' and a render observes that new uid but is then
// ABANDONED — the DOM is never updated, the browser never paints
// anything from it — the round-16 code would still have already mutated
// `state.uid` to 'B' during that abandoned render's function call,
// incorrectly invalidating account A's still-current, still-committed,
// still-VISIBLE request. A React render function must be treated as pure
// and side-effect-free for exactly this reason: it may run more than
// once, or not "count", for a single eventual commit.
//
// Fixed by moving the uid write into a useLayoutEffect. Layout effects
// are commit-phase-only: React only runs them after a render has actually
// been committed to the DOM, never for a render that gets thrown away.
// This makes `state.uid` authoritative for exactly the sequence of uids
// that were ever actually committed and visible — never a value from a
// render that never painted anything — while useLayoutEffect's own
// scheduling guarantee (synchronous, after DOM mutation, before paint)
// still closes the "before paint" requirement: an old account's data
// cannot be painted after a new committed uid, because invalidation
// happens in the same synchronous phase, strictly before the browser
// gets a chance to paint the new commit.
//
// The primary defense against a cross-account paint is still UID-keyed
// remounting: AppLayout renders `<Outlet key={user?.uid} />`, so React
// fully unmounts the old page instance and mounts a completely fresh one
// on every account switch — the old instance's state can never be
// visible again, and the guard below only ever needs to defend within a
// single mounted instance (overlapping retries, a dogId/tab change,
// post-async-unmount, and — for AppLayout, which deliberately does NOT
// get the remount treatment since it's the persistent sidebar shell — a
// genuine same-instance uid change).
//
// isCurrent() must be checked immediately before every state write coming
// out of an async continuation. It returns true only if ALL of:
//   - the component is still mounted;
//   - no newer request has started since this one (beginRequest() bumps a
//     generation counter, so a manual retry or a dependency-driven re-run
//     invalidates any older in-flight request, including on overlapping
//     retries — "only the newest result may commit");
//   - the uid this request was made for still matches the CURRENT
//     (committed) uid (covers the case where uid changes without a fresh
//     beginRequest() call ever having a chance to run first — e.g. a
//     response that was already in flight when the account switched).
//
// The actual guard logic lives in RequestGuardState, a plain class with no
// React dependency — this lets a Node test script import and exercise the
// exact production logic directly (Node 24 executes a plain, "erasable
// syntax" .ts file over ESM with no build step), rather than testing a
// hand-mirrored copy. useRequestGuard() itself is a thin glue layer that
// keeps one RequestGuardState instance alive for a component's lifetime
// and wires it to the COMMIT phase only, via two useLayoutEffects.
export class RequestGuardState {
  mounted = true
  generation = 0
  uid: string | null | undefined = undefined

  setMounted(mounted: boolean) {
    this.mounted = mounted
  }

  // Codex round 16: a uid CHANGE bumps `generation` too, not just
  // beginRequest() calls. Without this, a component instance whose uid
  // prop flip-flops (A → B → A) without a fresh beginRequest() call in
  // between — realistic for AppLayout, which deliberately does NOT get
  // the uid-keyed remount treatment the routed pages do, e.g. a rapid
  // logout/login or an auth-state hiccup — would let a token issued
  // during the FIRST "A" period silently become "current" again once uid
  // cycles back to 'A', even though a whole different account's session
  // happened in between. Bumping generation on every uid change closes
  // that: any token issued before ANY uid change is permanently invalid,
  // regardless of what uid value is current later.
  //
  // Codex round 17: this method must now ONLY ever be called from a
  // useLayoutEffect (i.e. only for a uid value that was actually
  // committed) — never from render. See useRequestGuard() below.
  setUid(uid: string | null | undefined) {
    if (uid !== this.uid) {
      this.uid = uid
      this.generation++
    }
  }

  beginRequest() {
    const gen = ++this.generation
    const requestUid = this.uid
    return {
      isCurrent: () => this.mounted && this.generation === gen && this.uid === requestUid,
    }
  }
}

export function useRequestGuard(uid: string | null | undefined) {
  const stateRef = useRef<RequestGuardState | null>(null)
  if (!stateRef.current) stateRef.current = new RequestGuardState()
  const state = stateRef.current

  // Codex round 17: moved out of the render body — see the file-level
  // comment above for why a render-time mutation is unsafe (an abandoned/
  // uncommitted render must never invalidate a still-current, still-
  // painted account). useLayoutEffect only fires for a render that
  // actually committed, and fires synchronously before the browser paints
  // that commit — so this uid write happens exactly once per COMMITTED
  // uid value, strictly before anything from that commit is visible.
  useLayoutEffect(() => {
    state.setUid(uid)
  }, [state, uid])

  useLayoutEffect(() => {
    state.setMounted(true)
    return () => { state.setMounted(false) }
  }, [state])

  function beginRequest() {
    return state.beginRequest()
  }

  return { beginRequest }
}
