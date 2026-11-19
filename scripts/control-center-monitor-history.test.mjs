import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeRunHistory } from './control-center-monitor-history.mjs'

const base = Date.UTC(2026, 10, 20, 0, 0)
const iso = minute => new Date(base + minute * 60000).toISOString()
const runsEvery = (minutes, count, outcome = 'WEBSITE_OK') => Array.from({ length: count }, (_, i) => ({ id: i, event: 'workflow_dispatch', startedAt: iso(i * minutes), outcome }))

test('24 hours of 10-minute runs pass with a 10-minute max gap', () => {
  const report = summarizeRunHistory(runsEvery(10, 145), { from: iso(0), to: iso(1440) })
  assert.equal(report.expectedRuns, 144)
  assert.equal(report.actualRuns, 145)
  assert.equal(report.maxGapMinutes, 10)
  assert.equal(report.pass, true)
})

test('a missing hour fails and is listed; runner errors are not valid observations', () => {
  const runs = runsEvery(10, 145).filter(run => run.id < 50 || run.id > 55)
  runs.push({ id: 'x', event: 'schedule', startedAt: iso(525), outcome: 'RUNNER_ERROR' })
  const report = summarizeRunHistory(runs, { from: iso(0), to: iso(1440) })
  assert.equal(report.pass, false)
  assert.equal(report.maxGapMinutes, 70)
  assert.deepEqual(report.gapsOver30Minutes, [{ from: iso(490), to: iso(560), minutes: 70 }])
  assert.equal(report.byOutcome.RUNNER_ERROR, 1)
  assert.equal(report.byEvent.schedule, 1)
})

test('a window shorter than 24 hours never passes, and silent edges count as gaps', () => {
  assert.equal(summarizeRunHistory(runsEvery(10, 10), { from: iso(0), to: iso(90) }).pass, false)
  const edge = summarizeRunHistory(runsEvery(10, 100), { from: iso(0), to: iso(1440) })
  assert.equal(edge.maxGapMinutes, 450)
})
