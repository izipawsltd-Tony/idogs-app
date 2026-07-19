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
// the browser has already painted the render that observed the new uid.
// That leaves a real window: a render commits showing the new uid (e.g.
// via a prop/context change), the browser paints it, and only THEN does
// the effect run and update `state.uid` — during that window, any async
// continuation from the OLD uid that happens to check isCurrent() would
// still see the OLD `state.uid` and could wrongly report itself current,
// right up until the effect finally flushes. Fixed by writing `state.uid`
// directly in the render body below, via `state.setUid(uid)` — mutating a
// plain (non-React-state) ref-held object during render is a standard,
// sanctioned pattern for tracking a derived value across renders without
// waiting for an effect (this does NOT call a React state setter, so it
// doesn't violate the "no setState during render" rule — `state` is a
// plain class instance held in a ref, invisible to React's own state/
// scheduling machinery). This makes the new uid authoritative for
// isCurrent() checks from the very same render/commit that observed it —
// there is no passive-effect delay left to exploit.
//
// The primary defense against a cross-account paint, though, is now
// UID-keyed remounting: AppLayout renders `<Outlet key={user?.uid} />`,
// so React fully unmounts the old page instance and mounts a completely
// fresh one on every account switch — the old instance's state can never
// be visible again, and the guard below only ever needs to defend within
// a single mounted instance (overlapping retries, a dogId/tab change,
// post-async-unmount). AppLayout itself does NOT remount (it's the
// persistent sidebar shell), so it uses this guard directly, combined
// with its own useLayoutEffect-based clearing — see AppLayout.tsx.
//
// isCurrent() must be checked immediately before every state write coming
// out of an async continuation. It returns true only if ALL of:
//   - the component is still mounted;
//   - no newer request has started since this one (beginRequest() bumps a
//     generation counter, so a manual retry or a dependency-driven re-run
//     invalidates any older in-flight request, including on overlapping
//     retries — "only the newest result may commit");
//   - the uid this request was made for still matches the CURRENT uid
//     (covers the case where uid changes without a fresh beginRequest()
//     call ever having a chance to run first — e.g. a response that was
//     already in flight when the account switched).
//
// The actual guard logic lives in RequestGuardState, a plain class with no
// React dependency — this lets a Node test script import and exercise the
// exact production logic directly (Node 24 executes a plain, "erasable
// syntax" .ts file over ESM with no build step), rather than testing a
// hand-mirrored copy. useRequestGuard() itself is a thin glue layer that
// keeps one RequestGuardState instance alive for a component's lifetime
// and wires it to render/mount via a render-time uid write plus a
// useLayoutEffect for mount tracking.
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

  // Render-time write (NOT inside an effect): `state` is a plain object
  // held in a ref, not React state, so mutating it here doesn't call a
  // state setter and doesn't violate render purity for React's own
  // scheduling — it's the same category of pattern as caching a derived
  // value in a ref for the "adjusting state during render" case React's
  // own docs describe, just applied to a ref-held instance instead of a
  // useState value. This guarantees isCurrent() reflects the LATEST
  // rendered uid from the moment this render is committed, not one
  // passive-effect cycle later.
  state.setUid(uid)

  // useLayoutEffect (not useEffect): mount/unmount tracking is flushed
  // synchronously after DOM mutations but before the browser paints,
  // matching the same "no stale window before paint" requirement as the
  // uid write above.
  useLayoutEffect(() => {
    state.setMounted(true)
    return () => { state.setMounted(false) }
  }, [state])

  function beginRequest() {
    return state.beginRequest()
  }

  return { beginRequest }
}
