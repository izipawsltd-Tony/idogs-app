import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatMonitorSummary, runMonitorOnce } from './control-center-monitor-core.mjs'

// SIMULATION ONLY. Never contacts the website and never touches the real
// monitor state: uses synthetic probes in a throwaway directory. Every line
// is prefixed "[SIMULATED]". Each scenario checks its expected result and the
// script exits 1 if any scenario does not behave as specified, so the
// rehearsal is also an acceptance check for the runner logic.
const OK = { id: 'website', status: 'PASS', httpStatus: 200, latencyMs: 250, reason: 'HTML_REACHABLE' }
const HTTP_500 = { id: 'website', status: 'FAIL', httpStatus: 500, latencyMs: 120, reason: 'UNEXPECTED_HTTP_STATUS' }
const TIMEOUT = { id: 'website', status: 'UNKNOWN', httpStatus: null, latencyMs: 5000, reason: 'TIMEOUT' }
const SIGNUP_OK = { id: 'signup-page', status: 'PASS', httpStatus: 200, latencyMs: 300, reason: 'HTML_REACHABLE' }
const statusOf = check => check.status

// Each step: [minute, website check]. Expectations are checked after the last step.
const scenarios = [
  {
    name: 'two consecutive website errors open one incident',
    steps: [[0, HTTP_500], [10, HTTP_500]],
    expect: { incident: 'HTTP_FAILURE', outcome: 'WEBSITE_ERROR', events: ['OPENED'] },
  },
  {
    name: 'two consecutive successes confirm recovery',
    steps: [[0, HTTP_500], [10, HTTP_500], [20, OK], [30, OK]],
    expect: { incident: null, outcome: 'WEBSITE_OK', events: ['RESOLVED'] },
  },
  {
    name: 'a single success after an incident does not resolve it',
    steps: [[0, HTTP_500], [10, HTTP_500], [20, OK]],
    expect: { incident: 'HTTP_FAILURE', outcome: 'WEBSITE_OK', events: [] },
  },
  {
    name: 'a duplicate run 1 minute later is reported but not counted',
    steps: [[0, HTTP_500], [1, HTTP_500]],
    expect: { incident: null, outcome: 'WEBSITE_ERROR', events: ['DUPLICATE_IGNORED'], counted: false, stateMinute: 0 },
  },
  {
    name: 'duplicate passes cannot resolve an incident',
    steps: [[0, HTTP_500], [10, HTTP_500], [20, OK], [22, OK]],
    expect: { incident: 'HTTP_FAILURE', outcome: 'WEBSITE_OK', events: ['DUPLICATE_IGNORED'], counted: false, stateMinute: 20 },
  },
  {
    name: 'a gap over 30 minutes breaks the failure chain',
    steps: [[0, HTTP_500], [45, HTTP_500]],
    expect: { incident: null, outcome: 'WEBSITE_ERROR', events: [] },
  },
  {
    name: 'monitor could not check (timeout twice) is a monitoring gap, not a website error',
    steps: [[0, TIMEOUT], [10, TIMEOUT]],
    expect: { incident: 'OBSERVATION_GAP', outcome: 'MONITOR_COULD_NOT_CHECK', events: ['OPENED'], summaryLacks: /WEBSITE ERROR/ },
  },
  {
    name: 'a website error after a monitoring gap supersedes it',
    steps: [[0, TIMEOUT], [10, TIMEOUT], [20, HTTP_500], [30, HTTP_500]],
    expect: { incident: 'HTTP_FAILURE', outcome: 'WEBSITE_ERROR', events: ['SUPERSEDED', 'OPENED'], summaryLacks: /MONITOR COULD NOT CHECK/ },
  },
]

const start = Date.now() - 2 * 60 * 60000
let failures = 0
for (const scenario of scenarios) {
  const directory = await mkdtemp(join(tmpdir(), 'cc-monitor-rehearsal-'))
  try {
    let report
    for (const [minute, check] of scenario.steps) {
      const at = new Date(start + minute * 60000)
      ;({ report } = await runMonitorOnce({
        directory, now: () => at,
        probe: async () => ({ status: statusOf(check), checkedAt: at.toISOString(), checks: [check, SIGNUP_OK] }),
      }))
    }
    const saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))
    const summary = formatMonitorSummary(report)
    const { expect } = scenario
    const problems = []
    if ((report.incident?.kind ?? null) !== expect.incident) problems.push(`incident ${report.incident?.kind ?? 'none'}, expected ${expect.incident ?? 'none'}`)
    if (report.outcome !== expect.outcome) problems.push(`outcome ${report.outcome}, expected ${expect.outcome}`)
    const events = report.events.map(event => event.type).join(',')
    if (events !== expect.events.join(',')) problems.push(`events [${events}], expected [${expect.events.join(',')}]`)
    if ('counted' in expect && report.counted !== expect.counted) problems.push(`counted ${report.counted}, expected ${expect.counted}`)
    if ('stateMinute' in expect && saved.lastCheckedAt !== new Date(start + expect.stateMinute * 60000).toISOString()) problems.push('persisted state advanced on a duplicate')
    if (expect.summaryLacks && expect.summaryLacks.test(summary)) problems.push(`summary wrongly contains ${expect.summaryLacks}`)
    console.log(`[SIMULATED] Scenario: ${scenario.name} -> ${problems.length ? 'FAIL: ' + problems.join('; ') : 'PASS'}`)
    console.log(summary.split('\n').filter(Boolean).map(line => `[SIMULATED]   ${line}`).join('\n'))
    if (problems.length) failures++
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
console.log(`[SIMULATED] Rehearsal: ${scenarios.length - failures}/${scenarios.length} scenarios passed`)
if (failures) process.exitCode = 1
