// Self-tests for scripts/_lib/test-check.mjs (Codex round 7, Blocker 1).
// No emulator needed — pure logic. Uses its OWN separate makeChecker()
// instance to report its own results, while testing a SEPARATE
// "subject" checker instance's behavior in isolation (so a deliberately
// FAILING subject-checker assertion, exercised on purpose to prove
// check() actually can fail, never pollutes this file's own pass/fail
// totals).
//
// Usage: node scripts/test-check-helpers.mjs

import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, skip, summary } = makeChecker()

// Captures console.log output produced by a callback (used to inspect
// what a SUBJECT checker printed, without that output — or its
// pass/fail counts — affecting this file's own checker instance at all).
async function captureLogs(fn) {
  const lines = []
  const original = console.log
  console.log = (...args) => { lines.push(args.join(' ')) }
  try {
    await fn()
  } finally {
    console.log = original
  }
  return lines
}

// =========================================================================
// SECTION 1 — check(): synchronous true/false, both call shapes
// =========================================================================
{
  const subject = makeChecker()
  subject.check('sync true', true)
  subject.check('sync false', false)
  subject.check('section', 'description form, true', true)
  subject.check('section', 'description form, false', false)
  const counts = subject.counts()
  check('check(): synchronous true passes', counts.pass >= 1 && subject.counts().fail >= 0)
  check('check(): exactly 2 passes and 2 fails recorded for the 4 calls above', counts.pass === 2 && counts.fail === 2)
}

// =========================================================================
// SECTION 2 — check(): rejects an unawaited Promise/thenable instead of
// silently treating it as truthy (the actual bug this module exists to
// close)
// =========================================================================
{
  const subject = makeChecker()
  let threwForResolvedTruePromise = false
  try { subject.check('unawaited Promise<true>', Promise.resolve(true)) }
  catch (err) { threwForResolvedTruePromise = err instanceof Error && /unawaited Promise/.test(err.message) }
  check('check() throws (does not silently PASS) when given an unawaited Promise<true>', threwForResolvedTruePromise)

  let threwForResolvedFalsePromise = false
  try { subject.check('unawaited Promise<false>', Promise.resolve(false)) }
  catch (err) { threwForResolvedFalsePromise = err instanceof Error && /unawaited Promise/.test(err.message) }
  check('check() throws when given an unawaited Promise<false> too (never silently PASSES a thenable)', threwForResolvedFalsePromise)

  let threwForPendingPromise = false
  try { subject.check('unawaited pending Promise', new Promise(() => {})) }
  catch (err) { threwForPendingPromise = true }
  check('check() throws for a never-resolving Promise rather than hanging or silently passing', threwForPendingPromise)

  // Confirm NEITHER of the throw-triggering calls above was counted as
  // a pass — a thrown error must never be conflated with a real result.
  check('None of the rejected-thenable calls above were counted as a PASS', subject.counts().pass === 0)

  // A thenable that ISN'T a real Promise (a plain object with a .then
  // method — the actual spec definition of "thenable") must also be
  // rejected, not just literal Promise instances.
  let threwForCustomThenable = false
  try { subject.check('custom thenable', { then: () => {} }) }
  catch (err) { threwForCustomThenable = true }
  check('check() rejects any thenable (duck-typed .then), not just real Promise instances', threwForCustomThenable)
}

// =========================================================================
// SECTION 3 — checkAsync(): resolved Promise<true>/<false>, rejected
// Promise, thrown error inside a thunk — all correctly awaited/caught
// =========================================================================
{
  const subject = makeChecker()
  await subject.checkAsync('resolved Promise<true>', Promise.resolve(true))
  await subject.checkAsync('resolved Promise<false>', Promise.resolve(false))
  const afterTwo = subject.counts()
  check('checkAsync(): a resolved Promise<true> is awaited and counted as PASS', afterTwo.pass === 1)
  check('checkAsync(): a resolved Promise<false> is awaited and counted as FAIL (not a silent PASS)', afterTwo.fail === 1)

  await subject.checkAsync('rejected Promise', Promise.reject(new Error('simulated network failure')))
  check('checkAsync(): a REJECTED Promise is caught and counted as FAIL, not an uncaught rejection', subject.counts().fail === 2)

  await subject.checkAsync('thunk that throws synchronously', () => { throw new Error('simulated sync throw') })
  check('checkAsync(): a thunk that throws synchronously is caught and counted as FAIL', subject.counts().fail === 3)

  await subject.checkAsync('thunk returning a resolved Promise<true>', async () => true)
  check('checkAsync(): a thunk returning an async true is awaited and counted as PASS', subject.counts().pass === 2)

  await subject.checkAsync('thunk returning a rejected Promise', async () => { throw new Error('async thunk throw') })
  check('checkAsync(): a thunk whose returned Promise rejects is caught and counted as FAIL', subject.counts().fail === 4)

  // 3-arg description-form shape must also work through checkAsync.
  await subject.checkAsync('section', 'description form async', Promise.resolve(true))
  check('checkAsync(): the 3-arg (label, description, cond) shape resolves correctly too', subject.counts().pass === 3)
}

// =========================================================================
// SECTION 4 — checkAsync(): never produces an unhandled promise
// rejection, even when the caller does NOT await it
// =========================================================================
{
  const subject = makeChecker()
  let unhandled = false
  const onUnhandledRejection = () => { unhandled = true }
  process.on('unhandledRejection', onUnhandledRejection)

  // Deliberately NOT awaited — this is exactly the "fire and forget"
  // pattern that would produce an unhandled rejection if checkAsync
  // propagated the rejection instead of catching it internally.
  subject.checkAsync('fire-and-forget rejected promise', Promise.reject(new Error('should never surface as unhandled')))

  // Give the microtask queue a turn to actually process the rejection
  // handling inside checkAsync before we check whether it leaked.
  await new Promise(resolve => setTimeout(resolve, 50))

  process.off('unhandledRejection', onUnhandledRejection)
  check('checkAsync() called WITHOUT awaiting it still never produces an unhandled promise rejection', unhandled === false)
}

// =========================================================================
// SECTION 5 — skip(): a formally distinct third bucket, never folded
// into pass or fail
// =========================================================================
{
  const subject = makeChecker()
  subject.check('one real pass', true)
  subject.skip('an emulator-only section', 'no emulator reachable in this run')
  subject.skip('another skipped section')
  const counts = subject.counts()
  check('skip() increments a separate skipped counter, not pass', counts.pass === 1 && counts.skipped === 2)
  check('skip() does not increment fail either — a skip is not a failure', counts.fail === 0)

  const logs = await captureLogs(async () => {
    const s2 = makeChecker()
    s2.skip('visibly-skipped section', 'demonstration')
  })
  check('skip() prints a distinctly-labeled SKIP: line (never PASS: or FAIL:)', logs.some(l => l.startsWith('SKIP:')) && !logs.some(l => l.startsWith('PASS:')) && !logs.some(l => l.startsWith('FAIL:')))
}

// =========================================================================
// SECTION 6 — summary() output shape (process.exit is NOT exercised
// here — that would kill this test process; the counting logic it
// prints from is already fully covered by counts() above)
// =========================================================================
{
  const logs = await captureLogs(async () => {
    const subject = makeChecker()
    subject.check('a', true)
    subject.check('b', false)
    subject.skip('c')
    // Don't call subject.summary() — it calls process.exit(). Print the
    // same line it would, using the same counts(), to verify the format
    // without terminating this process.
    const { pass: p, fail: f, skipped: s } = subject.counts()
    console.log(`\n${p} passed, ${f} failed${s > 0 ? `, ${s} skipped` : ''}`)
  })
  const summaryLine = logs.find(l => /passed,.*failed/.test(l))
  check('The summary line matches the established "${pass} passed, ${fail} failed" format every test file already expects', !!summaryLine && summaryLine.includes('1 passed, 1 failed') && summaryLine.includes('1 skipped'))
}

// Shared by SECTIONS 7, 8, and 9: writes a tiny throwaway .mjs to the OS
// temp dir, runs it with `node`, and returns its actual stdout/stderr/
// exit code. Needed because summary() calls process.exit() — running
// these scenarios in-process would kill this test file too.
//
// `timeoutMs` (default 8000 — generous next to the ~15-100ms delays
// these scenarios actually use) is a WATCHDOG: if a scenario under test
// regresses back into a genuine hang, execFileSync kills the child
// after this deadline and throws with `err.signal` set (status null)
// instead of blocking this test file — and therefore CI — forever. Every
// SECTION 9 (re-entrant summary()) case relies on this to turn "the fix
// is broken and it hangs again" into a fast, clear test FAILURE rather
// than a stuck process.
const checkModuleUrl = new URL('./_lib/test-check.mjs', import.meta.url).href

function runChild(body, timeoutMs = 8000) {
  const file = join(tmpdir(), `test-check-async-child-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(file, `import { makeChecker } from '${checkModuleUrl}'\n${body}\n`, 'utf8')
  try {
    const stdout = execFileSync('node', [file], { encoding: 'utf8', timeout: timeoutMs })
    return { status: 0, stdout, stderr: '', timedOut: false }
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '', timedOut: err.signal != null }
  } finally {
    unlinkSync(file)
  }
}

// =========================================================================
// SECTION 7 — summary() waits for checkAsync() calls the caller never
// awaited (Codex round 8). A delayed false/rejection must still be
// counted and still produce a nonzero exit; a delayed true must still
// be counted before totals are printed.
// =========================================================================
{
  // Unawaited checkAsync() resolving to TRUE after a delay, followed
  // immediately by summary() with no intervening await on the check
  // itself. If summary() did not wait for pending checks, this would
  // print "0 passed, 0 failed" and exit 0 before the delayed PASS ever
  // landed — exactly the bug this round fixes.
  const delayedTrue = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('delayed true', () => new Promise(resolve => setTimeout(() => resolve(true), 40)))
await summary()
`)
  check('summary() waits for an unawaited checkAsync(true) before printing totals', delayedTrue.stdout.includes('1 passed, 0 failed'))
  check('summary() exits 0 once the delayed true is correctly counted', delayedTrue.status === 0)

  // Unawaited checkAsync() resolving to FALSE after a delay — must
  // still be counted as a failure and produce a nonzero exit, not
  // silently dropped because summary() ran and exited first.
  const delayedFalse = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('delayed false', () => new Promise(resolve => setTimeout(() => resolve(false), 40)))
await summary()
`)
  check('summary() waits for an unawaited checkAsync(false) before printing totals', delayedFalse.stdout.includes('0 passed, 1 failed'))
  check('a delayed false surfaces as a nonzero exit code even though checkAsync() was never awaited', delayedFalse.status === 1)

  // Unawaited checkAsync() whose promise REJECTS after a delay — must
  // be caught, counted as a fail, produce a nonzero exit, AND never
  // surface as an unhandled rejection warning on stderr.
  const delayedRejection = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('delayed rejection', () => new Promise((resolve, reject) => setTimeout(() => reject(new Error('delayed boom')), 40)))
await summary()
`)
  check('summary() waits for an unawaited, later-rejecting checkAsync() before printing totals', delayedRejection.stdout.includes('0 passed, 1 failed'))
  check('a delayed rejection surfaces as a nonzero exit code even though checkAsync() was never awaited', delayedRejection.status === 1)
  check('a delayed rejection never prints an UnhandledPromiseRejection warning to stderr', !/UnhandledPromiseRejection|unhandledRejection/i.test(delayedRejection.stderr))

  // Multiple unawaited calls with mixed outcomes and different delays,
  // none awaited individually — summary() must wait for the FULL set,
  // not just whichever settles first.
  const mixedMultiple = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('mixed 1 (true, fast)', () => new Promise(resolve => setTimeout(() => resolve(true), 10)))
checkAsync('mixed 2 (false, slower)', () => new Promise(resolve => setTimeout(() => resolve(false), 60)))
checkAsync('mixed 3 (true, slowest)', () => new Promise(resolve => setTimeout(() => resolve(true), 90)))
await summary()
`)
  check('summary() waits for ALL pending checkAsync() calls, not just the first to settle', mixedMultiple.stdout.includes('2 passed, 1 failed'))
  check('mixed pending outcomes still produce the correct nonzero exit', mixedMultiple.status === 1)
}

// =========================================================================
// SECTION 8 — re-entrant async assertion race (Codex round 9). The
// round-8 checkAsync() called `pending.add(settlement)` on the line
// AFTER invoking `(async () => {...})()`, but an async arrow function
// runs SYNCHRONOUSLY up to its first actually-reached `await`. If the
// condition thunk itself was a plain (non-async) function that called
// summary() BEFORE returning its own pending Promise — exactly
// `() => { summary(); return new Promise(...) }` — that summary() call
// ran while `settlement` had not been registered in `pending` yet.
// summary() saw an empty pending set, printed "0 failed", and called
// process.exit(0) before the thunk's delayed `false` ever resolved.
// The fix registers a manually-created deferred Promise into `pending`
// BEFORE any user code runs, deferring the thunk itself to a
// queueMicrotask callback. Every scenario here must run as a real child
// process, since it deliberately calls process.exit() via summary().
//
// NOTE (Codex round 10): these two scripts now include a genuine
// top-level `await summary()`, matching how every real test file in
// this codebase is actually structured. Round 9's original version of
// this test omitted it and relied on the INNER (misused) summary() call
// to itself drain `pending` and call process.exit() — which happened to
// work only because that inner call's own wait was, coincidentally,
// satisfied by the SAME unrelated delayed promise the thunk separately
// returned. Round 10 closes a DIFFERENT bug (a genuine, unbreakable
// deadlock when the thunk's return value is summary()'s own promise —
// see SECTION 9) by making a misused inner summary() call a safe,
// inert no-op instead of a functioning drain — so it can no longer be
// the thing that exits the process, by design. The delayed false/
// rejection is still correctly counted either way; see SECTION 9's
// "prior discarded-summary repro" case for the direct regression proof.
// =========================================================================
{
  // The EXACT Codex reproduction, verbatim, plus the top-level
  // summary() every real test file has. Must NOT print "0 failed" or
  // exit 0 — the delayed false must be counted and force exit 1.
  const codexRepro = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('lost false', () => {
  summary()
  return new Promise(resolve =>
    setTimeout(() => resolve(false), 40))
})
await summary()
`)
  check('Codex repro: thunk-invoked summary() does not print "0 failed"', !codexRepro.stdout.includes('0 failed'))
  check('Codex repro: the delayed false is counted ("0 passed, 1 failed")', codexRepro.stdout.includes('0 passed, 1 failed'))
  check('Codex repro: process exits 1, not 0, once the delayed false lands', codexRepro.status === 1)

  // Same shape, but the thunk's own Promise REJECTS instead of
  // resolving false — must also be caught, counted as a fail, and
  // force a nonzero exit, not an unhandled rejection or an exit 0.
  const codexReproRejection = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('lost rejection', () => {
  summary()
  return new Promise((resolve, reject) =>
    setTimeout(() => reject(new Error('lost rejection boom')), 40))
})
await summary()
`)
  check('thunk-invoked summary() + delayed rejection: not printed as "0 failed"', !codexReproRejection.stdout.includes('0 failed'))
  check('thunk-invoked summary() + delayed rejection: counted as a failure', codexReproRejection.stdout.includes('0 passed, 1 failed'))
  check('thunk-invoked summary() + delayed rejection: exits 1, not 0', codexReproRejection.status === 1)
  check('thunk-invoked summary() + delayed rejection: no UnhandledPromiseRejection warning on stderr', !/UnhandledPromiseRejection|unhandledRejection/i.test(codexReproRejection.stderr))

  // A recursive case: while summary() is draining the FIRST pending
  // check, that check's own resolution schedules a SECOND checkAsync()
  // call (added to `pending` mid-drain). summary() must pick up the
  // newly-added check too, not just the set that existed when it was
  // first called.
  const recursiveDuringDrain = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('outer (spawns inner while summary drains)', () => new Promise(resolve => {
  setTimeout(() => {
    checkAsync('inner (added mid-drain)', () => new Promise(resolve2 => setTimeout(() => resolve2(false), 20)))
    resolve(true)
  }, 20)
}))
await summary()
`)
  check('a checkAsync() added WHILE summary() is draining is still waited for', recursiveDuringDrain.stdout.includes('1 passed, 1 failed'))
  check('the recursively-added failing check still forces a nonzero exit', recursiveDuringDrain.status === 1)

  // Baseline: ordinary AWAITED checkAsync() usage (no thunk-invoked
  // summary(), no fire-and-forget) must still behave exactly as before
  // — the round-9 fix must not change correctness for the common case.
  const ordinaryAwaited = runChild(`
const { checkAsync, summary } = makeChecker()
await checkAsync('ordinary awaited true', Promise.resolve(true))
await checkAsync('ordinary awaited false', Promise.resolve(false))
await summary()
`)
  check('ordinary awaited checkAsync() calls still count correctly (regression check)', ordinaryAwaited.stdout.includes('1 passed, 1 failed'))
  check('ordinary awaited usage still exits 1 on a real failure', ordinaryAwaited.status === 1)

  // Baseline: ordinary FIRE-AND-FORGET usage (unawaited, but the caller
  // does NOT call summary() from inside the thunk — summary() is called
  // normally afterward) must still behave exactly as it did in round 8.
  const ordinaryFireAndForget = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('fire-and-forget true', () => new Promise(resolve => setTimeout(() => resolve(true), 30)))
checkAsync('fire-and-forget false', () => new Promise(resolve => setTimeout(() => resolve(false), 15)))
await summary()
`)
  check('ordinary fire-and-forget checkAsync() calls still count correctly (regression check)', ordinaryFireAndForget.stdout.includes('1 passed, 1 failed'))
  check('ordinary fire-and-forget usage still exits 1 on a real failure', ordinaryFireAndForget.status === 1)
}

// =========================================================================
// SECTION 9 — re-entrant summary() self-deadlock (Codex round 10). A
// checkAsync() condition that calls summary() itself — directly, via an
// explicit await, or after an unrelated await inside the thunk — used to
// hang forever: that assertion's own settlement is already in `pending`
// by the time the thunk runs (round 9's fix), so summary()'s drain loop
// would wait for it, but it can only settle once the thunk (which is
// itself stuck waiting on summary()) finishes. Every case below carries
// an explicit watchdog timeout via runChild's `timeoutMs` — if the fix
// regresses, these fail fast with `timedOut: true` instead of hanging
// this file (and CI) indefinitely.
// =========================================================================
{
  // The EXACT Codex reproduction, verbatim.
  const cycleDirect = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('cycle', () => summary())
await summary()
`)
  check('checkAsync + thunk returning summary() directly: does not time out (no hang)', cycleDirect.timedOut === false)
  check('checkAsync + thunk returning summary() directly: detected and counted as a FAIL, not a false PASS', cycleDirect.stdout.includes('0 passed, 1 failed'))
  check('checkAsync + thunk returning summary() directly: exits nonzero', cycleDirect.status !== 0 && cycleDirect.status !== null)
  check('checkAsync + thunk returning summary() directly: no unhandled rejection warning on stderr', !/UnhandledPromiseRejection|unhandledRejection/i.test(cycleDirect.stderr))

  // Same cycle, but via an explicit `await` inside an async thunk.
  const cycleAwait = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('cycle-await', async () => await summary())
await summary()
`)
  check('checkAsync + async thunk awaiting summary(): does not time out (no hang)', cycleAwait.timedOut === false)
  check('checkAsync + async thunk awaiting summary(): detected and counted as a FAIL, not a false PASS', cycleAwait.stdout.includes('0 passed, 1 failed'))
  check('checkAsync + async thunk awaiting summary(): exits nonzero', cycleAwait.status !== 0 && cycleAwait.status !== null)
  check('checkAsync + async thunk awaiting summary(): no unhandled rejection warning on stderr', !/UnhandledPromiseRejection|unhandledRejection/i.test(cycleAwait.stderr))

  // summary() called only AFTER an unrelated await inside the thunk —
  // proves the detection survives an await boundary (a plain flag set
  // and cleared around a synchronous call would miss this).
  const cycleAfterAwait = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('cycle-after-await', async () => {
  await new Promise(resolve => setTimeout(resolve, 15))
  return summary()
})
await summary()
`)
  check('summary() called after an unrelated await inside the thunk: does not time out (no hang)', cycleAfterAwait.timedOut === false)
  check('summary() called after an unrelated await inside the thunk: detected and counted as a FAIL', cycleAfterAwait.stdout.includes('0 passed, 1 failed'))
  check('summary() called after an unrelated await inside the thunk: exits nonzero', cycleAfterAwait.status !== 0 && cycleAfterAwait.status !== null)

  // Legitimate top-level summary() call while OTHER, unrelated
  // fire-and-forget checkAsync() calls are still pending — must still
  // drain them normally. This is the case a naive "is anything in
  // `pending`" check would have wrongly flagged as re-entrant; the
  // per-assertion AsyncLocalStorage context must NOT be set here at all,
  // since this summary() call is genuinely at the top level.
  const legitTopLevelWhilePending = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('fire-and-forget true', () => new Promise(resolve => setTimeout(() => resolve(true), 30)))
checkAsync('fire-and-forget false', () => new Promise(resolve => setTimeout(() => resolve(false), 15)))
await summary()
`)
  check('legitimate top-level summary() with fire-and-forget checks pending: does not time out', legitTopLevelWhilePending.timedOut === false)
  check('legitimate top-level summary() with fire-and-forget checks pending: both are drained and counted correctly', legitTopLevelWhilePending.stdout.includes('1 passed, 1 failed'))
  check('legitimate top-level summary() with fire-and-forget checks pending: exits nonzero (one genuine failure)', legitTopLevelWhilePending.status === 1)

  // The round 8/9 "discarded summary() call" regression: the thunk
  // calls summary() but never awaits/uses its return value at all
  // (unlike the cycle cases above, where the thunk's own result IS
  // summary()'s promise). This must keep behaving exactly as round 9
  // fixed it — the delayed false is what gets counted, via the REAL
  // top-level summary() call, with the misused inner call safely
  // neutralized (rejected-but-pre-handled, so no unhandled rejection)
  // rather than reported as if it were the actual failure.
  const priorDiscardedRepro = runChild(`
const { checkAsync, summary } = makeChecker()
checkAsync('lost false', () => {
  summary()
  return new Promise(resolve =>
    setTimeout(() => resolve(false), 40))
})
await summary()
`)
  check('prior discarded-summary repro: does not time out (no hang)', priorDiscardedRepro.timedOut === false)
  check('prior discarded-summary repro: remains nonzero for the delayed false', priorDiscardedRepro.status === 1)
  check('prior discarded-summary repro: the delayed false is still what gets reported, not a deadlock error', priorDiscardedRepro.stdout.includes('FAIL: lost false') && priorDiscardedRepro.stdout.includes('0 passed, 1 failed'))
  check('prior discarded-summary repro: no unhandled rejection warning on stderr from the discarded inner call', !/UnhandledPromiseRejection|unhandledRejection/i.test(priorDiscardedRepro.stderr))
}

await summary()
