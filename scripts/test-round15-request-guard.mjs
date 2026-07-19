// scripts/test-round15-request-guard.mjs — Codex round 15, Blocker 2:
// cross-account and stale-async-result protection. Imports the REAL
// production RequestGuardState class directly from
// src/hooks/useRequestGuard.ts (Node 24 executes a plain, "erasable
// syntax" .ts file over ESM with no build step) — this is the exact
// class every audited loader (Dashboard, Audit, Documents, Export,
// DogList, DogDetail's BreedingTab, Buyers, Reminders, Reports, Litters,
// AppLayout) uses via the useRequestGuard() hook, not a mirrored copy.
//
// The three required race scenarios:
//   A) "A starts → switch to B → A resolves late"
//   B) "retry 1 starts → retry 2 succeeds → retry 1 resolves late"
//   C) "unmount before resolve"
//
// Usage: node scripts/test-round15-request-guard.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { RequestGuardState } from '../src/hooks/useRequestGuard.ts'

const { check, checkAsync, summary } = makeChecker()

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

// =========================================================================
// SECTION 1 — baseline: a single request with no races always commits
// =========================================================================
{
  const guard = new RequestGuardState()
  guard.setUid('user-A')
  const req = guard.beginRequest()
  check('a fresh, uncontested request is current', req.isCurrent())
}

// =========================================================================
// SECTION 2 — Scenario A: "A starts → switch to B → A resolves late"
// (the actual cross-account data-leak case this blocker exists to close)
// =========================================================================
await checkAsync('Scenario A: account A\'s slow response must NOT be current after switching to account B, even though A\'s request started first and resolves after B\'s',
  (async () => {
    const guard = new RequestGuardState()
    guard.setUid('account-A')
    const reqA = guard.beginRequest() // A's request starts

    // Account switch: uid changes to B, B's own load starts (a fresh
    // beginRequest(), exactly like a page's uid-keyed effect re-running).
    guard.setUid('account-B')
    const reqB = guard.beginRequest()

    // A's slow network response finally arrives, after B has already
    // started (and, in a real page, likely already committed).
    await sleep(5)

    return !reqA.isCurrent() && reqB.isCurrent()
  })())

await checkAsync('Scenario A variant: A\'s response landing AFTER B has already committed must still be rejected, not overwrite B\'s committed state',
  (async () => {
    const guard = new RequestGuardState()
    guard.setUid('account-A')
    const reqA = guard.beginRequest()

    guard.setUid('account-B')
    const reqB = guard.beginRequest()
    // B "commits" (in a real page: setDogs(bData); etc.)
    const bCommitted = reqB.isCurrent()

    // A's response arrives even later.
    await sleep(5)
    const aCanStillCommit = reqA.isCurrent()

    return bCommitted && !aCanStillCommit
  })())

// =========================================================================
// SECTION 3 — Scenario B: "retry 1 starts → retry 2 succeeds → retry 1
// resolves late" (same account throughout — this is the overlapping-
// retries case, not an account switch)
// =========================================================================
await checkAsync('Scenario B: retry 1\'s late-arriving response must not be current once retry 2 has already started and succeeded',
  (async () => {
    const guard = new RequestGuardState()
    guard.setUid('same-account')

    const retry1 = guard.beginRequest() // first attempt (or first retry)
    await sleep(2)
    const retry2 = guard.beginRequest() // a second retry supersedes it — same uid throughout
    const retry2Succeeded = retry2.isCurrent() // retry 2's response arrives and commits

    await sleep(5) // retry 1's response FINALLY arrives, after retry 2 already committed
    const retry1StillCurrent = retry1.isCurrent()

    return retry2Succeeded && !retry1StillCurrent
  })())

await checkAsync('Scenario B variant: three overlapping retries — only the LAST one to call beginRequest() may ever be current',
  (async () => {
    const guard = new RequestGuardState()
    guard.setUid('same-account')
    const r1 = guard.beginRequest()
    const r2 = guard.beginRequest()
    const r3 = guard.beginRequest()
    return !r1.isCurrent() && !r2.isCurrent() && r3.isCurrent()
  })())

// =========================================================================
// SECTION 4 — Scenario C: "unmount before resolve"
// =========================================================================
await checkAsync('Scenario C: a request in flight when the component unmounts must never be current once it resolves',
  (async () => {
    const guard = new RequestGuardState()
    guard.setUid('account-A')
    const req = guard.beginRequest()
    const wasCurrentBeforeUnmount = req.isCurrent()

    guard.setMounted(false) // component unmounts while the request is still in flight
    await sleep(5) // the response arrives after unmount

    return wasCurrentBeforeUnmount && !req.isCurrent()
  })())

await checkAsync('Scenario C variant: a request begun AFTER a remount (fresh beginRequest(), matching real React StrictMode double-invoke semantics) is current again',
  (async () => {
    const guard = new RequestGuardState()
    guard.setUid('account-A')
    guard.setMounted(false) // e.g. React StrictMode's dev-only mount→cleanup cycle
    guard.setMounted(true)  // ...then mounts again, same component instance
    const freshReq = guard.beginRequest() // a NEW request started after remounting
    return freshReq.isCurrent()
  })())

// =========================================================================
// SECTION 5 — combined: an account switch THEN an unmount, in either
// order, must both independently invalidate an old request
// =========================================================================
await checkAsync('combined: account switch followed by unmount both invalidate a request started before either',
  (async () => {
    const guard = new RequestGuardState()
    guard.setUid('account-A')
    const req = guard.beginRequest()
    guard.setUid('account-B')
    guard.setMounted(false)
    return !req.isCurrent()
  })())

// =========================================================================
// SECTION 6 — a request for uid=null/undefined (e.g. a logged-out state
// that briefly starts a load before the `if (!user) return` guard) never
// becomes current once a real account signs in
// =========================================================================
await checkAsync('a request begun while signed out never becomes current after a real account signs in',
  (async () => {
    const guard = new RequestGuardState()
    guard.setUid(undefined)
    const loggedOutReq = guard.beginRequest()
    guard.setUid('real-account')
    return !loggedOutReq.isCurrent()
  })())

// =========================================================================
// SECTION 7 — source-pattern checks: every audited page actually uses
// useRequestGuard (not just the hook existing in isolation), and each
// async continuation checks isCurrent() before writing state
// =========================================================================
{
  const auditedFiles = [
    'src/pages/DashboardPage.tsx',
    'src/pages/AuditPage.tsx',
    'src/pages/DocumentsPage.tsx',
    'src/pages/ExportPage.tsx',
    'src/pages/DogListPage.tsx',
    'src/pages/DogDetailPage.tsx',
    'src/pages/BuyersPage.tsx',
    'src/pages/RemindersPage.tsx',
    'src/pages/ReportsPage.tsx',
    'src/pages/LittersPage.tsx',
    'src/components/layout/AppLayout.tsx',
  ]
  for (const relPath of auditedFiles) {
    const src = readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')
    if (relPath === 'src/pages/LittersPage.tsx') {
      // LittersPage keeps its own round-14 mountedRef/loadTokenRef retry
      // machinery (already covers the same guarantees end-to-end) rather
      // than adopting useRequestGuard — verify it's still keyed on uid
      // and still clears state on switch, not that it imports the hook.
      check(`${relPath}: load effect is keyed on user?.uid, not just user`,
        /\}, \[user\?\.uid\]\)/.test(src))
      check(`${relPath}: clears litters/dogs immediately on the uid-keyed effect`,
        /setLitters\(\[\]\)[\s\S]{0,40}setDogs\(\[\]\)[\s\S]{0,40}startLoad\(\)/.test(src))
      continue
    }
    check(`${relPath}: imports useRequestGuard`, /import \{ useRequestGuard \} from ['"].*useRequestGuard['"]/.test(src))
    check(`${relPath}: calls useRequestGuard(...)`, /useRequestGuard\(/.test(src))
    check(`${relPath}: at least one isCurrent() check guards a state write`, /req\.isCurrent\(\)|beginDogCountRequest|beginLitterCountRequest/.test(src))
  }
}

// =========================================================================
// SECTION 8 (round 16, Blocker 2) — UID-keyed remounting: AppLayout
// renders <Outlet key={user?.uid}/>, structurally eliminating the
// account-switch race for every routed page in one stroke (a torn-down
// component instance's async continuations can never write into or paint
// the new instance, since they're different component instances
// entirely — not just the same instance with updated props).
// =========================================================================
{
  const appLayoutSrc = readFileSync(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')
  check('AppLayout renders <Outlet key={user?.uid} /> — forces a full remount of the routed page on every account switch',
    /<Outlet key=\{user\?\.uid\} \/>/.test(appLayoutSrc))
  check('AppLayout itself does NOT remount (no key on AppLayout\'s own root) — it must persist as the sidebar shell',
    !/<AppLayout[^>]*key=/.test(readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8')))
}

// =========================================================================
// SECTION 9 (round 16, Blocker 2) — useRequestGuard's uid write moved
// from a passive useEffect to the render body (render-time ref mutation),
// and mount-tracking moved from useEffect to useLayoutEffect — both
// verified behaviorally in test-round16-request-guard-lifecycle.mjs;
// re-verified here via source pattern as a fast regression tripwire.
// =========================================================================
{
  const guardSrc = readFileSync(new URL('../src/hooks/useRequestGuard.ts', import.meta.url), 'utf8')
  check('useRequestGuard writes state.setUid(uid) directly in the render body, NOT inside a useEffect',
    (() => {
      // The render-time write must appear BEFORE the first useLayoutEffect
      // call (i.e. outside any effect callback).
      const setUidIdx = guardSrc.indexOf('state.setUid(uid)')
      const firstEffectIdx = guardSrc.indexOf('useLayoutEffect(()')
      return setUidIdx !== -1 && firstEffectIdx !== -1 && setUidIdx < firstEffectIdx
    })())
  check('useRequestGuard uses useLayoutEffect (not useEffect) for mount tracking',
    /useLayoutEffect\(\(\) => \{\s*state\.setMounted\(true\)/.test(guardSrc) && !/useEffect\(\(\) => \{\s*state\.setMounted\(true\)/.test(guardSrc))
  check('useRequestGuard no longer imports useEffect at all (only useLayoutEffect + useRef)',
    /import \{ useLayoutEffect, useRef \} from 'react'/.test(guardSrc))
  check('RequestGuardState.setUid() bumps generation on any uid CHANGE (not just on beginRequest() calls) — closes the A→B→A flip-flop resurrection gap',
    /setUid\(uid: string \| null \| undefined\) \{\s*if \(uid !== this\.uid\) \{\s*this\.uid = uid\s*this\.generation\+\+/.test(guardSrc))
}

// =========================================================================
// SECTION 10 (round 16, Blocker 4) — AppLayout's pending-claim and
// litter counts use null/unknown on failure, matching dogCount's
// pre-existing contract, instead of silently defaulting to 0
// =========================================================================
{
  const appLayoutSrc = readFileSync(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')
  check('pendingClaimCount is typed number | null (not just number)',
    /const \[pendingClaimCount, setPendingClaimCount\] = useState<number \| null>\(null\)/.test(appLayoutSrc))
  check('pendingClaimCount is set to null (not 0) on a claimTransferredDogs() failure',
    /claimTransferredDogs\(user\.uid, user\.email, 'check'\)[\s\S]{0,200}catch\(\(\) => \{ if \(req\.isCurrent\(\)\) setPendingClaimCount\(null\) \}\)/.test(appLayoutSrc))
  check('the pending-claim banner checks pendingClaimCount !== null before checking > 0 (never renders "0 dogs waiting" for an unknown count)',
    /pendingClaimCount !== null && pendingClaimCount > 0/.test(appLayoutSrc))
  check('litterCount is set to null (not 0) on a getLitters() failure',
    /getLitters\(\)[\s\S]{0,120}catch\(\(\) => \{ if \(req\.isCurrent\(\)\) setLitterCount\(null\) \}\)/.test(appLayoutSrc))
  check('AppLayout\'s count-clearing effects use useLayoutEffect (clear before paint), not useEffect',
    (() => {
      const dogCountEffectMatch = appLayoutSrc.match(/useLayoutEffect\(\(\) => \{\s*setDogCount\(null\)/)
      const litterCountEffectMatch = appLayoutSrc.match(/useLayoutEffect\(\(\) => \{\s*setLitterCount\(null\)/)
      return !!dogCountEffectMatch && !!litterCountEffectMatch
    })())
}

await summary()
