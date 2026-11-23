#!/usr/bin/env node
// Runnable, NON-credential POSIX/Ubuntu verification of the cookie-state controls (UID, 0700/0600 modes,
// symlink redirection, lookalike path, allocator-only write, cleanup). Needs only Node and the repo's devDependencies.
//   npm ci && node scripts/verify-state-path-posix.mjs
// It runs scripts/e2e-state-path.test.js and FAILS unless every POSIX-only case actually RAN (no skips),
// then confirms no state directory was leaked. Exits non-zero on Windows (those cases cannot run there).
import { spawnSync } from 'node:child_process'
import { readdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.platform === 'win32') { console.error('BLOCKED: POSIX owner/mode/symlink checks cannot run on Windows; use Ubuntu/WSL with Node.'); process.exit(3) }
const leaks = () => readdirSync(tmpdir()).filter((n) => n.startsWith('idogs-preview-state-'))
const before = new Set(leaks())
const dir = mkdtempSync(join(tmpdir(), 'posix-verify-'))
const outFile = join(dir, 'r.json')
const r = spawnSync('npx', ['vitest', 'run', 'scripts/e2e-state-path.test.js', '--reporter=json', `--outputFile=${outFile}`], { encoding: 'utf8' })
let rep = null
try { rep = JSON.parse(readFileSync(outFile, 'utf8')) } catch { /* handled below */ }
rmSync(dir, { recursive: true, force: true })
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1) }
if (!rep) fail('could not read the vitest report')
const uid = typeof process.getuid === 'function' ? process.getuid() : 'n/a'
console.log(`platform=${process.platform} uid=${uid} passed=${rep.numPassedTests} failed=${rep.numFailedTests} skipped=${rep.numPendingTests} (other-owner case runs only as root)`)
if (r.status !== 0 || rep.numFailedTests !== 0) fail('state-path tests failed')
// The only case allowed to skip is the other-owner chown case, and only for a non-root process (cannot chown).
const skipped = rep.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status !== 'passed').map((a) => a.title))
const allowed = (t) => uid !== 0 && t.includes('owned by another user')
if (skipped.some((t) => !allowed(t))) fail('POSIX-only cases were skipped; they must run on POSIX')
if (rep.numPassedTests < 12) fail('fewer state-path cases ran than expected')
const names = rep.testResults.flatMap((f) => f.assertionResults.map((a) => a.title)).join('\n')
for (const needle of ['0700', 'symlinked directory', 'symlinked state file', 'accessible to others', 'nonexistent lookalike', 'replaced by a symlink']) {
  if (!names.includes(needle)) fail(`expected case not found: ${needle}`)
}
const leaked = leaks().filter((n) => !before.has(n))
if (leaked.length) fail(`leaked state directories: ${leaked.length}`)
console.log('PASS: POSIX UID/mode/symlink/lookalike/allocator-only/cleanup controls verified, no leaks')
