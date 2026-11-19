// Acceptance report for an automatic monitoring window. Input (stdin): JSON
// array of runs { id, event, startedAt, outcome } where outcome is the value
// the workflow logged (WEBSITE_OK, WEBSITE_ERROR, MONITOR_COULD_NOT_CHECK or
// RUNNER_ERROR). A valid observation is a run that observed the website
// (WEBSITE_OK or WEBSITE_ERROR). Read-only: no network access.
const VALID = new Set(['WEBSITE_OK', 'WEBSITE_ERROR'])
const MAX_GAP_MINUTES = 30

export function summarizeRunHistory(runs, { from, to, intervalMinutes = 10 }) {
  const start = Date.parse(from), end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Invalid window')
  const inWindow = runs
    .map(run => ({ ...run, at: Date.parse(run.startedAt) }))
    .filter(run => Number.isFinite(run.at) && run.at >= start && run.at <= end)
    .sort((a, b) => a.at - b.at)
  const byOutcome = {}
  for (const run of inWindow) byOutcome[run.outcome || 'UNKNOWN'] = (byOutcome[run.outcome || 'UNKNOWN'] || 0) + 1
  const valid = inWindow.filter(run => VALID.has(run.outcome))
  // Window edges count as gaps too: a silent first or last stretch is a gap.
  const points = [start, ...valid.map(run => run.at), end]
  let maxGapMs = 0, gaps = []
  for (let i = 1; i < points.length; i++) {
    const gap = points[i] - points[i - 1]
    maxGapMs = Math.max(maxGapMs, gap)
    if (gap > MAX_GAP_MINUTES * 60000) gaps.push({ from: new Date(points[i - 1]).toISOString(), to: new Date(points[i]).toISOString(), minutes: Math.round(gap / 60000) })
  }
  const hours = (end - start) / 3600000
  return {
    window: { from: new Date(start).toISOString(), to: new Date(end).toISOString(), hours: Math.round(hours * 100) / 100 },
    expectedRuns: Math.floor((end - start) / (intervalMinutes * 60000)),
    actualRuns: inWindow.length,
    validObservations: valid.length,
    byOutcome,
    byEvent: inWindow.reduce((acc, run) => ({ ...acc, [run.event]: (acc[run.event] || 0) + 1 }), {}),
    maxGapMinutes: Math.round(maxGapMs / 60000),
    gapsOver30Minutes: gaps,
    pass: hours >= 24 && maxGapMs <= MAX_GAP_MINUTES * 60000,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, to] = process.argv.slice(2)
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  console.log(JSON.stringify(summarizeRunHistory(JSON.parse(input), { from, to }), null, 2))
}
