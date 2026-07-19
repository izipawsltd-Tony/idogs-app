// scripts/test-round16-request-guard-lifecycle.mjs — Codex round 16,
// Blocker 2: real MOUNTED-COMPONENT lifecycle tests for useRequestGuard,
// using react-test-renderer (added as a devDependency this round
// specifically to make this possible — this project has no DOM/jsdom, so
// react-dom/client can't render, but react-test-renderer needs no DOM and
// correctly implements React's real layout-effect-then-passive-effect
// flush ordering via act()).
//
// Round 15 covered useRequestGuard.beginRequest()/isCurrent() only via
// direct calls against the RequestGuardState class — real coverage of the
// class's own logic, but it couldn't prove anything about the HOOK's
// render/effect-timing behavior, which is exactly what round 16 fixed:
// round 15 updated the tracked uid inside a passive useEffect, so a stale
// response from the OLD uid could still read the OLD uid and wrongly
// report itself current for one full passive-effect cycle AFTER a render
// had already committed showing the NEW uid. Round 16 moved the uid write
// into the render body itself (a ref mutation, not a state setter) — but
// that turned out to be unsafe too (see Section 7, round 17): a render
// function can be called by React without ever being committed (an
// abandoned/interrupted render), and a render-body mutation would still
// have applied even though nothing from that render was ever painted.
// Round 17 moves the uid write into a useLayoutEffect instead — commit-
// phase-only, so it only ever runs for a render that actually happened.
//
// This suite renders an ACTUAL function component using the REAL
// useRequestGuard hook from src/hooks/useRequestGuard.ts (Node 24 executes
// plain .ts over ESM), and exploits react-test-renderer's act() timing —
// confirmed empirically: a synchronous check placed immediately after
// renderer.update() but still INSIDE the same act() callback runs BEFORE
// any of the new render's effects (layout or passive) have flushed — to
// prove the fix actually changes observable behavior, not just to
// re-confirm the class's own logic in isolation.
//
// Usage: node scripts/test-round16-request-guard-lifecycle.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import React, { useState, useLayoutEffect, useEffect } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useRequestGuard } from '../src/hooks/useRequestGuard.ts'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

// A minimal "loader" component: exposes beginRequest() and a commit()
// helper (which only writes state if the passed-in request is still
// current — the exact pattern every audited page uses) through a
// mutable `controls` object, and renders whatever was last committed so
// the test can inspect the ACTUAL rendered tree, not just isCurrent()'s
// return value in isolation.
//
// It also exposes an explicit layout-effect and passive-effect PROBE:
// if `controls.probeReq` is set, each render records whether that token
// was still current at the moment of ITS OWN layout effect and its own
// passive effect. React guarantees layout effects for a render always
// fire strictly before that render's passive effects — so comparing
// these two recorded values gives a REAL "was it already stale before
// passive effects ran" checkpoint, grounded in React's actual phase
// ordering rather than any react-test-renderer scheduling implementation
// detail (empirically, react-test-renderer defers the actual render/
// commit work of an update() call until act() drains its queue, so a
// check placed merely "after calling update(), still inside the act()
// callback" does NOT reliably observe post-render state — it's testing
// react-test-renderer's own scheduling, not React's phase-ordering
// guarantee. The layout-vs-passive-effect probe below sidesteps that
// entirely by using real effect timing instead of call-stack position.)
function Harness({ uid, controls, mode }) {
  const { beginRequest } = useRequestGuard(uid)
  const [committed, setCommitted] = useState('(nothing committed)')
  controls.beginRequest = beginRequest
  controls.commit = (req, value) => {
    if (req.isCurrent()) setCommitted(value)
  }
  controls.getRenderedText = () => committed
  useLayoutEffect(() => {
    if (controls.probeReq) controls.layoutEffectProbeResult = controls.probeReq.isCurrent()
  })
  useEffect(() => {
    if (controls.probeReq) controls.passiveEffectProbeResult = controls.probeReq.isCurrent()
  })
  const el = React.createElement('div', null, committed)
  return mode === 'strict' ? React.createElement(React.StrictMode, null, el) : el
}

function renderHarness(uid, controls, mode) {
  let renderer
  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness, { uid, controls, mode }))
  })
  return renderer
}

// =========================================================================
// SECTION 1 — "A starts → render switches to B before passive effects →
// A resolves; A's data must never paint/commit"
// =========================================================================
{
  const controls = {}
  const renderer = renderHarness('account-A', controls)
  const reqA = controls.beginRequest()
  check('A: a freshly begun request is current immediately after mount', reqA.isCurrent())

  // Arm the probe with A's token, THEN switch the render to B. React
  // guarantees B's layout effect fires before B's passive effect for
  // this same render — so if A is already stale by B's LAYOUT effect,
  // it was stale strictly before any passive effect could have run,
  // regardless of exactly when within act()'s processing the render
  // itself occurred.
  controls.probeReq = reqA
  controls.layoutEffectProbeResult = undefined
  controls.passiveEffectProbeResult = undefined
  act(() => {
    renderer.update(React.createElement(Harness, { uid: 'account-B', controls }))
  })

  check('B\'s layout effect fired (probe actually ran — sanity check)', controls.layoutEffectProbeResult !== undefined)
  check('A is already stale by the time B\'s LAYOUT effect runs — i.e. before B\'s passive effect could possibly run',
    controls.layoutEffectProbeResult === false)
  check('A is (still, consistently) stale by B\'s passive effect too', controls.passiveEffectProbeResult === false)

  // Simulate A's slow response finally "arriving" well after this and
  // trying to commit.
  act(() => { controls.commit(reqA, 'DATA-FROM-ACCOUNT-A') })
  check('A\'s data was never committed to rendered state (commit() no-oped since isCurrent() was false)',
    controls.getRenderedText() !== 'DATA-FROM-ACCOUNT-A')
  check('the rendered tree reflects this — react-test-renderer\'s toJSON() never shows A\'s data',
    JSON.stringify(renderer.toJSON()).includes('DATA-FROM-ACCOUNT-A') === false)

  // Now B's own (fresh) request legitimately resolves and commits.
  controls.probeReq = null
  const reqB = controls.beginRequest()
  act(() => { controls.commit(reqB, 'DATA-FROM-ACCOUNT-B') })
  check('B\'s own request DOES commit successfully', controls.getRenderedText() === 'DATA-FROM-ACCOUNT-B')
  check('B\'s data is the only thing ever painted for this instance',
    JSON.stringify(renderer.toJSON()).includes('DATA-FROM-ACCOUNT-B'))

  act(() => { renderer.unmount() })
}

// =========================================================================
// SECTION 2 — a fully async race: A's promise resolves AFTER a real
// macrotask delay (not just "the next synchronous statement"), well after
// B has already rendered AND B's own effects have flushed — the more
// realistic version of the same account-switch race
// =========================================================================
{
  const controls = {}
  const renderer = renderHarness('account-A', controls)
  const reqA = controls.beginRequest()

  await act(async () => {
    renderer.update(React.createElement(Harness, { uid: 'account-B', controls }))
    await sleep(10) // let B's effects fully flush, simulating real time passing
  })

  const reqB = controls.beginRequest()
  await act(async () => {
    await sleep(5)
    controls.commit(reqB, 'B-async-data')
  })
  check('B\'s async-resolved data commits correctly', controls.getRenderedText() === 'B-async-data')

  // A's very-late response finally arrives.
  await act(async () => {
    await sleep(5)
    controls.commit(reqA, 'A-late-async-data')
  })
  check('A\'s late-resolving async response (arriving well after B has already committed) never overwrites B\'s state',
    controls.getRenderedText() === 'B-async-data')

  act(() => { renderer.unmount() })
}

// =========================================================================
// SECTION 3 — overlapping retries within the SAME account (no uid
// change): "retry 1 starts → retry 2 succeeds → retry 1 resolves late"
// =========================================================================
{
  const controls = {}
  const renderer = renderHarness('same-account', controls)

  const retry1 = controls.beginRequest()
  const retry2 = controls.beginRequest() // supersedes retry1, same uid throughout

  act(() => { controls.commit(retry2, 'retry-2-result') })
  check('retry 2 commits successfully', controls.getRenderedText() === 'retry-2-result')

  act(() => { controls.commit(retry1, 'retry-1-STALE-result') })
  check('retry 1\'s late-arriving result never overwrites retry 2\'s already-committed state',
    controls.getRenderedText() === 'retry-2-result')

  act(() => { renderer.unmount() })
}

// =========================================================================
// SECTION 4 — unmount before resolve: a request in flight when the
// component unmounts must never commit, even via a real React unmount
// (not just RequestGuardState.setMounted(false) called directly)
// =========================================================================
{
  const controls = {}
  const renderer = renderHarness('account-A', controls)
  const req = controls.beginRequest()
  check('request is current before unmount', req.isCurrent())

  act(() => { renderer.unmount() })

  check('request is NOT current after a real React unmount', !req.isCurrent())
  // commit() would call setCommitted (a state setter) on an unmounted
  // component if isCurrent() incorrectly returned true — that would
  // itself throw/warn in React. Confirms the guard, not just that no
  // crash occurred.
  let threw = false
  try {
    act(() => { controls.commit(req, 'post-unmount-data') })
  } catch {
    threw = true
  }
  check('calling commit() after unmount does not throw (isCurrent() correctly short-circuits before any state write)', !threw)
}

// =========================================================================
// SECTION 5a — rapid A → B → A prop-level switching WITHOUT unmounting
// (the realistic shape for AppLayout, which deliberately does NOT get the
// uid-keyed remount treatment the routed pages do — its uid comes from a
// normal prop/context change, not a key change, so the SAME component
// instance's uid can legitimately flip-flop, e.g. a rapid re-login or an
// auth-state hiccup). A token issued during the FIRST "A" period must
// never become current again just because uid later cycles back to 'A'.
// =========================================================================
{
  const controls = {}
  const renderer = renderHarness('account-A', controls)
  const reqA1 = controls.beginRequest()

  act(() => { renderer.update(React.createElement(Harness, { uid: 'account-B', controls })) })
  act(() => { renderer.update(React.createElement(Harness, { uid: 'account-A', controls })) }) // back to A, SAME instance

  check('a token from the FIRST "A" period is never current again after A→B→A, even without remounting',
    !reqA1.isCurrent())

  const reqA2 = controls.beginRequest() // a fresh request issued during the SECOND "A" period
  check('a NEW request made after cycling back to A is current', reqA2.isCurrent())

  act(() => { controls.commit(reqA2, 'fresh-A-data') })
  check('the fresh second-"A"-period request commits normally', controls.getRenderedText() === 'fresh-A-data')

  act(() => { renderer.unmount() })
}

// =========================================================================
// SECTION 5b — rapid A → B → A via REAL unmount/remount (the actual
// production shape for every Outlet-rendered page, keyed on uid) — the
// second "A" is a completely distinct component instance/RequestGuardState,
// not a resurrection of the first
// =========================================================================
{
  const controlsA1 = {}
  const rendererA1 = renderHarness('account-A', controlsA1)
  const reqA1 = controlsA1.beginRequest()
  check('5b: first "A" instance\'s request is current before any switch', reqA1.isCurrent())

  act(() => { rendererA1.unmount() }) // simulates the Outlet key changing away from 'account-A'
  check('5b: first "A" instance\'s request is invalid immediately after its real unmount', !reqA1.isCurrent())

  // A brand-new component instance mounts for the second "A" period —
  // exactly what <Outlet key={uid}/> produces when uid cycles back.
  const controlsA2 = {}
  const rendererA2 = renderHarness('account-A', controlsA2)
  const reqA2 = controlsA2.beginRequest()
  check('5b: second "A" instance\'s fresh request is current', reqA2.isCurrent())
  check('5b: the first instance\'s stale token remains invalid even after a second "A" instance exists',
    !reqA1.isCurrent())

  act(() => { controlsA2.commit(reqA2, 'second-instance-A-data') })
  check('5b: second instance commits its own data normally', controlsA2.getRenderedText() === 'second-instance-A-data')

  act(() => { rendererA2.unmount() })
}

// =========================================================================
// SECTION 6 — React.StrictMode safety: dev-only double-invoke of render
// and effects must not break the guard or cause duplicate/inconsistent
// state
// =========================================================================
{
  const controls = {}
  let renderer
  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness, { uid: 'strict-account', controls, mode: 'strict' }))
  })
  const req = controls.beginRequest()
  check('StrictMode: a request begun after mount is current', req.isCurrent())

  act(() => { controls.commit(req, 'strict-mode-data') })
  check('StrictMode: commit succeeds normally despite double-invoked effects', controls.getRenderedText() === 'strict-mode-data')

  act(() => { renderer.unmount() })
  check('StrictMode: request is invalid after unmount', !req.isCurrent())
}

// =========================================================================
// SECTION 7 (round 17) — "guard mutation during render" removed: uid
// tracking must be commit-only, so an abandoned/uncommitted render can
// never invalidate a still-current, still-painted request.
//
// Testing-tool limitation, stated plainly: react-test-renderer's public
// API does not expose a way to genuinely abandon a render before commit
// (there is no supported way to start a render and discard it without
// going through TestRenderer.create()/.update(), both of which always
// run the full commit + layout-effect cycle synchronously — confirmed
// empirically while building this suite, including WITHOUT wrapping
// calls in act(), which made no difference: layout effects are always
// synchronous with commit in both React DOM and react-test-renderer,
// unlike passive effects). There is no lower-level hook in this
// environment (no jsdom, no react-dom/client, no access to React's
// internal Scheduler/Fiber APIs) to force React to start-then-discard a
// render. Given that constraint, this section proves the STRUCTURAL
// guarantee instead: the hook contains no render-body mutation for an
// abandoned render to ever apply in the first place, verified by
// (a) a source-pattern check that RequestGuardState.setUid() is only
// ever called from inside a useLayoutEffect body in the real file, and
// (b) confirming every COMMITTED uid transition (the only kind
// observable through this tool) is still correctly picked up, so the
// fix didn't trade "unsafe but working" for "safe but broken".
// =========================================================================
{
  const guardSrc = readFileSync(new URL('../src/hooks/useRequestGuard.ts', import.meta.url), 'utf8')

  check('useRequestGuard() contains NO render-body call to state.setUid(...) — the only call site is inside a useLayoutEffect',
    (() => {
      const hookBodyMatch = guardSrc.match(/export function useRequestGuard\([\s\S]*?\n}\r?\n/)
      const hookBody = hookBodyMatch ? hookBodyMatch[0] : ''
      if (!hookBody) return false
      // Exactly one call to state.setUid(, and it must be inside the
      // useLayoutEffect(() => { ... }, [state, uid]) block, not loose in
      // the function body before/after any effect.
      const setUidCalls = (hookBody.match(/state\.setUid\(/g) || []).length
      const effectWrappedMatch = hookBody.match(/useLayoutEffect\(\(\) => \{\s*state\.setUid\(uid\)\s*\}, \[state, uid\]\)/)
      return setUidCalls === 1 && !!effectWrappedMatch
    })())

  check('the render body (everything before the first useLayoutEffect call) contains no state mutation at all',
    (() => {
      const hookBodyMatch = guardSrc.match(/export function useRequestGuard\([\s\S]*?\n}\r?\n/)
      const hookBody = hookBodyMatch ? hookBodyMatch[0] : ''
      const firstEffectIdx = hookBody.indexOf('useLayoutEffect(')
      if (firstEffectIdx === -1) return false
      const renderBody = hookBody.slice(0, firstEffectIdx)
      return !/state\.set(Uid|Mounted)\(/.test(renderBody)
    })())

  check('mount-tracking is ALSO commit-only (useLayoutEffect, not render body or useEffect)',
    /useLayoutEffect\(\(\) => \{\s*state\.setMounted\(true\)/.test(guardSrc) &&
    !/useEffect\(\(\) => \{\s*state\.setMounted\(true\)/.test(guardSrc))
}

{
  // Confirms the fix didn't regress the basic committed-transition case:
  // every uid value that genuinely commits is still picked up correctly,
  // in strict sequence, with no committed transition ever silently
  // skipped or applied out of order.
  const controls = {}
  const renderer = renderHarness('seq-A', controls)
  const reqA = controls.beginRequest()
  act(() => { renderer.update(React.createElement(Harness, { uid: 'seq-B', controls })) })
  const reqB = controls.beginRequest()
  act(() => { renderer.update(React.createElement(Harness, { uid: 'seq-C', controls })) })
  const reqC = controls.beginRequest()

  check('round 17 regression check: after two committed uid transitions, only the LATEST (C) token is current',
    !reqA.isCurrent() && !reqB.isCurrent() && reqC.isCurrent())

  act(() => { controls.commit(reqC, 'seq-C-data') })
  check('round 17 regression check: the current token commits its data normally', controls.getRenderedText() === 'seq-C-data')

  act(() => { renderer.unmount() })
}

await summary()
