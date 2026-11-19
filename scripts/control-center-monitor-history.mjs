// Acceptance report for an automatic monitoring window. Input (stdin): JSON
// array of runs { id, trigger, startedAt, outcome, counted } taken from each
// run's log line "outcome=... trigger=... counted=...". trigger is the run's
// starter (schedule, external-cron, manual, push).
//
// Only AUTOMATIC, COUNTED runs that OBSERVED the website are valid
// observations. Manual and push runs (started by a person or a code change)
// and duplicates (counted=false, under 5 minutes after the last counted
// observation) are listed but can never close a gap or make the 24-hour
// window pass. A missing counted flag is treated as not counted (fail closed).
// Read-only: no network access.
const VALID = new Set(['WEBSITE_OK', 'WEBSITE_ERROR'])
const AUTOMATIC = new Set(['schedule', 'external-cron'])
export function exclusionReason(run) {
  if (!AUTOMATIC.has(run.trigger)) return 'NOT_AUTOMATIC'
  if (run.counted !== true) return 'DUPLICATE_OR_UNCOUNTED'
  if (!VALID.has(run.outcome)) return 'WEBSITE_NOT_OBSERVED'
  return null
}
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
  const valid = inWindow.filter(run => exclusionReason(run) === null)
  const excluded = {}
  for (const run of inWindow) {
    const reason = exclusionReason(run)
    if (reason) excluded[reason] = (excluded[reason] || 0) + 1
  }
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
    validRule: 'Automatic (schedule or external-cron), counted (not a duplicate) and the website was observed (WEBSITE_OK or WEBSITE_ERROR).',
    expectedRuns: Math.floor((end - start) / (intervalMinutes * 60000)),
    actualRuns: inWindow.length,
    validObservations: valid.length,
    byOutcome,
    byTrigger: inWindow.reduce((acc, run) => ({ ...acc, [run.trigger || 'unknown']: (acc[run.trigger || 'unknown'] || 0) + 1 }), {}),
    excluded,
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
