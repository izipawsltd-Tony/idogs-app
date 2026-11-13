import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatMonitorSummary, runMonitorOnce } from './control-center-monitor-core.mjs'

// SIMULATION ONLY. Never contacts the website and never touches the real
// monitor state: uses fake probes in a throwaway directory so the log shows
// what each failure case looks like. Every line is prefixed "[SIMULATED]".
const scenarios = [
  ['website error (HTTP 500 twice)', 'FAIL', { id: 'website', status: 'FAIL', httpStatus: 500, latencyMs: 120, reason: 'UNEXPECTED_HTTP_STATUS' }],
  ['monitor could not check (timeout twice)', 'UNKNOWN', { id: 'website', status: 'UNKNOWN', httpStatus: null, latencyMs: 5000, reason: 'TIMEOUT' }],
]
const start = Date.now() - 60 * 60000
for (const [name, status, check] of scenarios) {
  const directory = await mkdtemp(join(tmpdir(), 'cc-monitor-rehearsal-'))
  try {
    let report
    for (const minute of [0, 10]) {
      const at = new Date(start + minute * 60000)
      ;({ report } = await runMonitorOnce({
        directory, now: () => at,
        probe: async () => ({ status, checkedAt: at.toISOString(), checks: [check, { id: 'signup-page', status: 'PASS', httpStatus: 200, latencyMs: 300, reason: 'HTML_REACHABLE' }] }),
      }))
    }
    console.log(`[SIMULATED] Scenario: ${name}`)
    console.log(formatMonitorSummary(report).split('\n').map(line => `[SIMULATED] ${line}`).join('\n'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
