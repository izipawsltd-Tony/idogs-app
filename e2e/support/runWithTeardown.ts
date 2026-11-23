/**
 * Run `body`, then ALWAYS run `teardown`. The test's own failure is never replaced by a teardown
 * failure (it is reported on stderr instead), but a teardown failure after a passing body fails the run.
 */
export async function runWithTeardown<T>(body: () => Promise<T>, teardown: () => Promise<void>): Promise<T> {
  let bodyFailed = false
  try {
    return await body()
  } catch (e) {
    bodyFailed = true
    throw e
  } finally {
    try {
      await teardown()
    } catch (te) {
      if (!bodyFailed) throw te
      process.stderr.write(`teardown also failed after the test failure: ${te instanceof Error ? te.message : 'unknown error'}\n`)
    }
  }
}
