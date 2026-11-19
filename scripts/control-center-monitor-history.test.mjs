import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exclusionReason, summarizeRunHistory } from './control-center-monitor-history.mjs'

const base = Date.UTC(2026, 10, 20, 0, 0)
const iso = minute => new Date(base + minute * 60000).toISOString()
const window = { from: iso(0), to: iso(1440) }
const run = (minute, overrides = {}) => ({ id: `r${minute}`, trigger: 'external-cron', startedAt: iso(minute), outcome: 'WEBSITE_OK', counted: true, ...overrides })
const every = (minutes, count, overrides = {}) => Array.from({ length: count }, (_, i) => run(i * minutes, overrides))

test('24 hours of automatic counted 10-minute runs pass with a 10-minute max gap', () => {
  const report = summarizeRunHistory(every(10, 145), window)
  assert.equal(report.expectedRuns, 144)
  assert.equal(report.validObservations, 145)
  assert.equal(report.maxGapMinutes, 10)
  assert.equal(report.pass, true)
})

test('the schedule backup counts as automatic', () => {
  assert.equal(summarizeRunHistory(every(10, 145, { trigger: 'schedule' }), window).pass, true)
})

test('manual runs cannot make the 24-hour window pass', () => {
  // Every 10 minutes, but all started by hand.
  const manualOnly = summarizeRunHistory(every(10, 145, { trigger: 'manual' }), window)
  assert.equal(manualOnly.pass, false)
  assert.equal(manualOnly.validObservations, 0)
  assert.equal(manualOnly.excluded.NOT_AUTOMATIC, 145)
  // Automatic runs every 60 minutes with manual runs filling the gaps.
  const automatic = every(60, 25)
  const fillers = every(10, 145, { trigger: 'manual' }).filter(item => Date.parse(item.startedAt) % 3600000 !== 0)
  const mixed = summarizeRunHistory([...automatic, ...fillers], window)
  assert.equal(mixed.pass, false)
  assert.equal(mixed.maxGapMinutes, 60)
  assert.equal(mixed.validObservations, 25)
  // Push runs (code changes) are not automatic either.
  assert.equal(summarizeRunHistory(every(10, 145, { trigger: 'push' }), window).pass, false)
})

test('duplicate runs cannot make the 24-hour window pass', () => {
  // Automatic every 60 minutes, gaps filled by runs logged as duplicates.
  const automatic = every(60, 25)
  const duplicates = every(10, 145, { counted: false }).filter(item => Date.parse(item.startedAt) % 3600000 !== 0)
  const report = summarizeRunHistory([...automatic, ...duplicates], window)
  assert.equal(report.pass, false)
  assert.equal(report.maxGapMinutes, 60)
  assert.equal(report.excluded.DUPLICATE_OR_UNCOUNTED, duplicates.length)
  // A run with no counted flag (for example an older log line) is not counted.
  assert.equal(summarizeRunHistory(every(10, 145, { counted: undefined }), window).pass, false)
})

test('runs that did not observe the website do not close gaps', () => {
  const runs = every(10, 145).map(item => (Date.parse(item.startedAt) - base) / 60000 >= 500 && (Date.parse(item.startedAt) - base) / 60000 <= 550 ? { ...item, outcome: 'MONITOR_COULD_NOT_CHECK' } : item)
  const report = summarizeRunHistory([...runs, run(525, { outcome: 'RUNNER_ERROR', id: 'err' })], window)
  assert.equal(report.pass, false)
  assert.equal(report.maxGapMinutes, 70)
  assert.deepEqual(report.gapsOver30Minutes, [{ from: iso(490), to: iso(560), minutes: 70 }])
  assert.equal(report.excluded.WEBSITE_NOT_OBSERVED, 7)
})

test('a window shorter than 24 hours never passes, and silent edges count as gaps', () => {
  assert.equal(summarizeRunHistory(every(10, 10), { from: iso(0), to: iso(90) }).pass, false)
  assert.equal(summarizeRunHistory(every(10, 100), window).maxGapMinutes, 450)
})

test('exclusion reasons', () => {
  assert.equal(exclusionReason(run(0)), null)
  assert.equal(exclusionReason(run(0, { trigger: 'manual' })), 'NOT_AUTOMATIC')
  assert.equal(exclusionReason(run(0, { counted: false })), 'DUPLICATE_OR_UNCOUNTED')
  assert.equal(exclusionReason(run(0, { outcome: 'RUNNER_ERROR' })), 'WEBSITE_NOT_OBSERVED')
})
