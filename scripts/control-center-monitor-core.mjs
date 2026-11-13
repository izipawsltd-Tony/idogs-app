import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { advanceMonitor, summarizeMonitor } from '../api/_lib/control-center-incidents.js'

// Shared by the local Windows runner and the scheduled GitHub Actions runner.
// State lives in one fixed file under `directory`; callers choose only the
// directory (a fixed constant in both runners), never a user-supplied path.
export const EXIT = Object.freeze({ HEALTHY: 0, ERROR: 1, INCIDENT: 3 })
const MAX_STATE_BYTES = 16384

async function loadState(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { state: null }
    throw error
  }
  try {
    if (raw.length > MAX_STATE_BYTES) throw new Error('Monitor state too large')
    const state = JSON.parse(raw)
    summarizeMonitor(state, new Date(Date.parse(state?.lastCheckedAt) || 0)) // structural validation only
    return { state }
  } catch (error) {
    return { state: null, invalid: error.message === 'Monitor state too large' ? 'TOO_LARGE' : 'INVALID' }
  }
}

export async function readMonitorStatus({ directory, now = new Date() }) {
  const path = resolve(directory, 'state.json')
  const { state, invalid } = await loadState(path)
  if (invalid) throw new Error('Invalid monitor state')
  const summary = summarizeMonitor(state, now)
  return { summary, exitCode: summary.status === 'HEALTHY' && !summary.incident ? EXIT.HEALTHY : EXIT.INCIDENT }
}

// One observation per call. `quarantineInvalidState` is for unattended
// runners: a corrupt state file is moved aside (kept for diagnosis) and a
// STATE_RESET event is published, instead of blocking every later run. The
// local runner keeps the stricter default (corruption is not a clean slate).
export async function runMonitorOnce({ directory, probe, now = () => new Date(), quarantineInvalidState = false }) {
  const path = resolve(directory, 'state.json')
  await mkdir(directory, { recursive: true })
  const loaded = await loadState(path)
  const events = []
  if (loaded.invalid) {
    if (!quarantineInvalidState) throw new Error('Invalid monitor state')
    const stamp = now().toISOString().replace(/[:.]/g, '-')
    await rename(path, resolve(directory, `state.invalid-${stamp}.json`))
    events.push({ type: 'STATE_RESET', reason: loaded.invalid, at: now().toISOString() })
  }
  const observation = await probe()
  const result = advanceMonitor(loaded.state, observation, { now: now() })
  events.push(...result.events)
  // Commit the observation and incident transition together. A crash before
  // the rename leaves the previous observation and incident state readable.
  const next = resolve(directory, 'state.next.json')
  await writeFile(next, JSON.stringify({ ...result.state, observation, events }, null, 2))
  await rename(next, path)
  return {
    report: { status: observation.status, checkedAt: observation.checkedAt, incident: result.state.incident, events },
    exitCode: result.state.incident ? EXIT.INCIDENT : EXIT.HEALTHY,
  }
}

// Plain-text Markdown for a CI job summary. Aggregate status only: no
// response bodies, headers, cookies or credentials are ever included.
export function formatMonitorSummary(report) {
  const lines = [
    '## iDogs public website monitor',
    '',
    `- Observation: **${report.status}** at ${report.checkedAt}`,
    `- Open incident: ${report.incident ? `${report.incident.kind} since ${report.incident.openedAt}` : 'none'}`,
    `- Events this run: ${report.events.length ? report.events.map(event => event.type + (event.kind ? ` ${event.kind}` : '')).join(', ') : 'none'}`,
    '',
    'Scope: public HTML reachability of the homepage and signup page only. Login, checkout and data access are not verified.',
  ]
  return lines.join('\n') + '\n'
}
