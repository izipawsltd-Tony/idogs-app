// scripts/_lib/test-check.mjs — shared, async-safe assertion helper for
// this project's plain-Node emulator/regression test scripts (Codex
// round 7, Blocker 1).
//
// WHY THIS EXISTS: round 6 discovered that 5 of these test files' local
// check() functions were being called as check(label, description,
// condition) — a 3-argument shape — against a check(label, cond, extra)
// signature, so `cond` was silently bound to the (always-truthy)
// description STRING and the real boolean was discarded. That was fixed
// per-file at the time. This module fixes the DEEPER, related class of
// bug the round-7 task specifically calls out: EVERY check() helper in
// this codebase — including the already-fixed ones — still does a bare
// `if (cond)`, and in JavaScript a Promise object is ALWAYS truthy
// regardless of what it resolves to. `check(label, someAsyncCall())`
// (forgetting to `await`) would therefore ALWAYS report PASS, even if
// the promise resolves to `false` or outright rejects — silently, with
// no error, no different from a genuinely passing assertion.
//
// Design (the task's own "alternatively" option): TWO helpers, not one
// that tries to do both jobs.
//
//   - check(...)      — stays fully SYNCHRONOUS. If the resolved
//     condition value is a thenable (a Promise or anything with a
//     `.then` method), it THROWS immediately with a specific, actionable
//     message instead of silently treating the Promise object as truthy.
//     This turns "silently always-PASS" into "loud, impossible-to-miss
//     crash naming the exact call site" — a fail-safe default for the
//     700+ existing call sites across this project, none of which
//     currently pass a Promise as a condition (verified — see the round
//     7 report), so this is a pure safety net with zero behavior change
//     for every existing call.
//
//   - checkAsync(...) — properly async. Accepts either a Promise/
//     thenable OR a plain function (a thunk — called, and its own
//     result awaited if it's also a thenable) as the condition. A sync
//     throw from a thunk, a rejected Promise, and a resolved
//     Promise<false> are all caught/awaited and converted into a
//     counted FAIL — never an uncaught exception, never an unhandled
//     rejection, even if the caller doesn't `await` the call (the
//     returned Promise always FULFILLS, it never rejects).
//
// Both share the exact same 2-arg / 3-arg call-shape detection
// established in round 6 (check(label, cond) vs
// check(label, description, cond)), plus a formal skip() for emulator-
// unavailable sections — skipped checks are counted in a THIRD bucket,
// never folded into pass or fail, so "0 failed" can never quietly mean
// "everything was actually skipped."
//
// Usage:
//   import { makeChecker } from './_lib/test-check.mjs'
//   const { check, checkAsync, skip, summary } = makeChecker()
//   check('some label', someBooleanExpression)
//   check('section', 'description', someBooleanExpression)
//   await checkAsync('label', async () => someAsyncCondition())
//   skip('label', 'reason emulator env vars are not set')
//   await summary() // waits for any still-pending checkAsync() calls,
//                    // THEN prints totals and calls process.exit() —
//                    // always last, always awaited

function isThenable(value) {
  return !!value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function'
}

// Shared shape resolution for both check() and checkAsync(): supports
// check(label, cond, extra?) and check(label, description, cond, extra?).
function resolveShape(label, arg2, arg3, arg4) {
  if (typeof arg2 === 'string' && arg3 !== undefined) {
    return { label: `${label}: ${arg2}`, condInput: arg3, extra: arg4 !== undefined ? arg4 : '' }
  }
  return { label, condInput: arg2, extra: arg3 !== undefined ? arg3 : '' }
}

export function makeChecker() {
  let pass = 0
  let fail = 0
  let skipped = 0

  // Codex round 8: a checkAsync() call the caller forgot to `await` used
  // to run to completion "eventually" but summary() had no way to know
  // it was still in flight — it would print totals and call
  // process.exit() immediately, so a delayed FAIL (or a rejection) that
  // hadn't resolved yet was silently dropped from the count and the
  // process could exit 0 despite a real failure. Every checkAsync() call
  // registers its own settlement promise here — synchronously, before
  // any `await` inside it can run — so summary() can wait for the full
  // set even when the caller never awaited the individual calls.
  const pending = new Set()

  function check(label, arg2, arg3, arg4) {
    const shaped = resolveShape(label, arg2, arg3, arg4)
    if (isThenable(shaped.condInput)) {
      throw new Error(
        `check() received an unawaited Promise/thenable as the condition for "${shaped.label}". ` +
        `A Promise is always truthy, so this would have silently reported PASS regardless of what ` +
        `it resolves to. Fix: await the value before calling check(), or use checkAsync() instead.`
      )
    }
    if (shaped.condInput) {
      console.log(`PASS: ${shaped.label}`)
      pass++
    } else {
      console.log(`FAIL: ${shaped.label} ${shaped.extra}`)
      fail++
    }
  }

  // Never throws and never returns a rejected Promise — a thrown error
  // from a thunk, a rejected Promise, and a resolved Promise<false> are
  // ALL caught here and converted into a counted FAIL. Safe to call
  // without awaiting: the settlement is tracked in `pending` (added
  // synchronously below, before this function's first `await` actually
  // suspends it) and summary() will wait for it regardless of whether
  // the caller ever awaits the returned promise directly.
  function checkAsync(label, arg2, arg3, arg4) {
    const shaped = resolveShape(label, arg2, arg3, arg4)
    const settlement = (async () => {
      let cond
      try {
        const resolved = typeof shaped.condInput === 'function' ? shaped.condInput() : shaped.condInput
        cond = isThenable(resolved) ? await resolved : resolved
      } catch (err) {
        const detail = err && err.message ? err.message : String(err)
        console.log(`FAIL: ${shaped.label} (threw/rejected: ${detail}) ${shaped.extra}`)
        fail++
        return
      }
      if (cond) {
        console.log(`PASS: ${shaped.label}`)
        pass++
      } else {
        console.log(`FAIL: ${shaped.label} ${shaped.extra}`)
        fail++
      }
    })()
    // The IIFE above never lets `settlement` reject (every path is
    // caught internally), so attaching .finally() here cannot itself
    // create a second, competing unhandled-rejection source — it only
    // ever runs on fulfillment. Attached BEFORE returning, so
    // `pending` is guaranteed to shrink even if the caller drops the
    // returned promise entirely (true fire-and-forget).
    pending.add(settlement)
    settlement.finally(() => pending.delete(settlement))
    return settlement
  }

  // A formally-counted third bucket — a skipped section (e.g. no
  // emulator reachable) is neither a pass nor a fail; it must never be
  // silently omitted in a way that could read as "0 failed" meaning
  // "everything ran and passed" when really nothing ran at all.
  function skip(label, reason = '') {
    console.log(`SKIP: ${label}${reason ? ' — ' + reason : ''}`)
    skipped++
  }

  function counts() {
    return { pass, fail, skipped }
  }

  // ASYNC now (Codex round 8): waits for every checkAsync() call ever
  // started — including ones the caller never awaited — before printing
  // totals or exiting, so a delayed false/rejection still counts and
  // still produces a nonzero exit. The while-loop (rather than a single
  // Promise.allSettled) covers the edge case of a checkAsync() call
  // that itself schedules another checkAsync() call from within its
  // condition thunk: each pass drains whatever is currently pending,
  // and the loop only exits once a full pass finds nothing left.
  // Callers must `await summary()` — see every test-*.mjs file's final
  // line.
  async function summary() {
    while (pending.size > 0) {
      await Promise.allSettled([...pending])
    }
    const skippedSuffix = skipped > 0 ? `, ${skipped} skipped` : ''
    console.log(`\n${pass} passed, ${fail} failed${skippedSuffix}`)
    process.exit(fail > 0 ? 1 : 0)
  }

  return { check, checkAsync, skip, counts, summary }
}
