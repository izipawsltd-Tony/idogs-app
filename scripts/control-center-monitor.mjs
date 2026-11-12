import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { checkSiteHealth } from '../api/_lib/control-center-health.js'
import { advanceMonitor, summarizeMonitor } from '../api/_lib/control-center-incidents.js'

// Designed for a scheduler outside the website's hosting runtime. State path
// is fixed; no user-provided filesystem paths or network targets are accepted.
const directory = resolve('.control-center-monitor')
const path = resolve(directory, 'state.json')
let previous = null
try {
  const raw = await readFile(path, 'utf8')
  if (raw.length > 16384) throw new Error('Monitor state too large')
  previous = JSON.parse(raw)
} catch (error) {
  // Missing first-run state is acceptable. Corruption is not a clean slate.
  if (error.code !== 'ENOENT') throw error
}
if (process.argv.includes('--status')) {
  const summary = summarizeMonitor(previous)
  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.status === 'HEALTHY' && !summary.incident ? 0 : 1)
}
const observation = await checkSiteHealth()
const result = advanceMonitor(previous, observation)
await mkdir(directory, { recursive: true })
// Commit the observation and incident transition together. A crash before the
// rename leaves the previous observation and incident state readable together.
await writeFile(resolve(directory, 'state.next.json'), JSON.stringify({ ...result.state, observation, events: result.events }, null, 2))
await rename(resolve(directory, 'state.next.json'), path)
console.log(JSON.stringify({ status: observation.status, checkedAt: observation.checkedAt, incident: result.state.incident, events: result.events }, null, 2))
// No emails, messages or production writes. The eventual scheduler owns
// notification routing; an active incident is a nonzero job result.
process.exitCode = result.state.incident ? 1 : 0
