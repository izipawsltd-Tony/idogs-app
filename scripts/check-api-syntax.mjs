import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : path.endsWith('.js') ? [path] : []
  }).sort()
}
const paths = files('api')
let failures = 0
for (const path of paths) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
  if (result.status !== 0) {
    failures++
    process.stderr.write(result.stderr || `Syntax check failed: ${path}\n`)
  }
}
console.log(JSON.stringify({ apiModules: paths.length, syntaxFailures: failures }))
if (failures) process.exitCode = 1
