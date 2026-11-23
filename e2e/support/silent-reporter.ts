import type { Reporter } from '@playwright/test/reporter'

// Credentialed runs write their raw JSON to a file on the runner and must put NOTHING in the job log.
// Playwright adds a default terminal reporter (list/dot) whenever no configured reporter "prints to
// stdio" — and that one prints failure messages and source excerpts. This reporter claims stdio and
// prints nothing, so no failure text, URL or value reaches the log.
export default class SilentReporter implements Reporter {
  printsToStdio() { return true }
}
