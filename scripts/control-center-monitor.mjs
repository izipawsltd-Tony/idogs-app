import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { checkSiteHealth } from '../api/_lib/control-center-health.js'
import { advanceMonitor } from '../api/_lib/control-center-incidents.js'

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
const observation = await checkSiteHealth()
const result = advanceMonitor(previous, observation)
await mkdir(directory, { recursive: true })
await writeFile(resolve(directory, 'state.next.json'), JSON.stringify(result.state, null, 2))
await rename(resolve(directory, 'state.next.json'), path)
await writeFile(resolve(directory, 'latest.json'), JSON.stringify({ observation, events: result.events }, null, 2))
console.log(JSON.stringify({ status: observation.status, checkedAt: observation.checkedAt, incident: result.state.incident, events: result.events }, null, 2))
// No emails, messages or production writes. The eventual scheduler owns
// notification routing; an active incident is a nonzero job result.
process.exitCode = result.state.incident ? 1 : 0
