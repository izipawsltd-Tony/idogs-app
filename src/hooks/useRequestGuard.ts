import { useEffect, useRef } from 'react'

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
// and wires it to mount/uid-change via effects.
export class RequestGuardState {
  mounted = true
  generation = 0
  uid: string | null | undefined = undefined

  setMounted(mounted: boolean) {
    this.mounted = mounted
  }

  setUid(uid: string | null | undefined) {
    this.uid = uid
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

  useEffect(() => {
    state.setMounted(true)
    return () => { state.setMounted(false) }
  }, [state])

  useEffect(() => {
    state.setUid(uid)
  }, [state, uid])

  function beginRequest() {
    return state.beginRequest()
  }

  return { beginRequest }
}
