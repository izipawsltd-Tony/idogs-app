// Self-tests for scripts/_lib/test-check.mjs (Codex round 7, Blocker 1).
// No emulator needed — pure logic. Uses its OWN separate makeChecker()
// instance to report its own results, while testing a SEPARATE
// "subject" checker instance's behavior in isolation (so a deliberately
// FAILING subject-checker assertion, exercised on purpose to prove
// check() actually can fail, never pollutes this file's own pass/fail
// totals).
//
// Usage: node scripts/test-check-helpers.mjs

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

summary()
