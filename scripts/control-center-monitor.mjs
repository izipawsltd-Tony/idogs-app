import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { checkSiteHealth } from '../api/_lib/control-center-health.js'
import { EXIT, formatMonitorSummary, readMonitorStatus, runMonitorOnce } from './control-center-monitor-core.mjs'

// Designed for a scheduler outside the website's hosting runtime. State path
// is fixed; no user-provided filesystem paths or network targets are accepted.
// Exit codes: 0 = healthy, 3 = an incident is open (or status is not healthy),
// 1 = the runner itself failed (invalid state, unexpected error).
const directory = resolve('.control-center-monitor')

try {
  if (process.argv.includes('--status')) {
    const { summary, exitCode } = await readMonitorStatus({ directory })
    console.log(JSON.stringify(summary, null, 2))
    process.exitCode = exitCode
  } else {
    const { report, exitCode } = await runMonitorOnce({
      directory,
      probe: () => checkSiteHealth(),
      quarantineInvalidState: process.argv.includes('--quarantine-invalid-state'),
    })
    console.log(JSON.stringify(report, null, 2))
    const summary = formatMonitorSummary(report)
    console.log(summary)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
    // Runner-provided output file only (no user-supplied path): lets the
    // workflow log the two failure cases separately without parsing JSON.
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `outcome=${report.outcome}\nincident=${report.incident?.kind ?? 'NONE'}\n`)
    }
    // No emails, messages or production writes. The scheduler owns
    // notification routing; an active incident is a distinct nonzero result.
    process.exitCode = exitCode
  }
} catch (error) {
  console.error(`Control Center monitor failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exitCode = EXIT.ERROR
}
