import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXIT, formatMonitorSummary, readMonitorStatus, runMonitorOnce } from './control-center-monitor-core.mjs'

const at = minute => new Date(Date.UTC(2026, 10, 13, 12, 0) + minute * 60000)
const observation = (status, minute) => ({ status, checkedAt: at(minute).toISOString(), checks: [] })
async function withDir(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'cc-monitor-'))
  try { return await fn(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}
// Simulates the scheduled runner: each call is a fresh process that only sees
// the persisted state directory (as restored from the CI cache).
const run = (directory, status, minute, options = {}) => runMonitorOnce({
  directory, probe: async () => observation(status, minute), now: () => at(minute), ...options,
})

test('first run with no state persists one observation and reports healthy', () => withDir(async directory => {
  const { report, exitCode } = await run(directory, 'PASS', 0)
  assert.equal(exitCode, EXIT.HEALTHY)
  assert.deepEqual(report.events, [])
  const saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))
  assert.equal(saved.lastCheckedAt, at(0).toISOString())
  assert.equal(saved.condition, 'HEALTHY')
  assert.deepEqual(await readdir(directory), ['state.json'])
}))

test('persisted state opens one incident, deduplicates repeats and resolves after recovery', () => withDir(async directory => {
  await run(directory, 'FAIL', 0)
  const opened = await run(directory, 'FAIL', 10)
  assert.equal(opened.exitCode, EXIT.INCIDENT)
  assert.deepEqual(opened.report.events.map(event => event.type), ['OPENED'])
  const id = opened.report.incident.id
  const repeat = await run(directory, 'FAIL', 20)
  assert.deepEqual(repeat.report.events, [])
  assert.equal(repeat.report.incident.id, id)
  assert.equal((await run(directory, 'PASS', 30)).exitCode, EXIT.INCIDENT)
  const resolved = await run(directory, 'PASS', 40)
  assert.deepEqual(resolved.report.events.map(event => event.type), ['RESOLVED'])
  assert.equal(resolved.exitCode, EXIT.HEALTHY)
}))

test('a scheduler gap longer than 30 minutes breaks the streak instead of opening an incident', () => withDir(async directory => {
  await run(directory, 'FAIL', 0)
  const afterGap = await run(directory, 'FAIL', 45)
  assert.equal(afterGap.report.incident, null)
  assert.equal(afterGap.exitCode, EXIT.HEALTHY)
  const status = await readMonitorStatus({ directory, now: at(90) })
  assert.equal(status.summary.status, 'STALE')
  assert.equal(status.exitCode, EXIT.INCIDENT)
}))

test('an open incident survives an observation gap and is not silently resolved', () => withDir(async directory => {
  await run(directory, 'FAIL', 0)
  await run(directory, 'FAIL', 10)
  const single = await run(directory, 'PASS', 60)
  assert.equal(single.report.incident.kind, 'HTTP_FAILURE')
  const resolved = await run(directory, 'PASS', 70)
  assert.equal(resolved.report.events[0].type, 'RESOLVED')
}))

test('a replayed observation is rejected and leaves persisted state unchanged', () => withDir(async directory => {
  await run(directory, 'FAIL', 10)
  const before = await readFile(join(directory, 'state.json'), 'utf8')
  await assert.rejects(run(directory, 'PASS', 10), /Invalid or replayed/)
  assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), before)
}))

test('corrupt state blocks the strict runner but the unattended runner quarantines it visibly', () => withDir(async directory => {
  await writeFile(join(directory, 'state.json'), '{not json')
  await assert.rejects(run(directory, 'PASS', 0), /Invalid monitor state/)
  await assert.rejects(readMonitorStatus({ directory }), /Invalid monitor state/)
  const recovered = await run(directory, 'PASS', 0, { quarantineInvalidState: true })
  assert.deepEqual(recovered.report.events.map(event => event.type), ['STATE_RESET'])
  assert.equal(recovered.report.events[0].reason, 'INVALID')
  const files = await readdir(directory)
  assert.equal(files.length, 2)
  const quarantined = files.find(name => /^state\.invalid-.*\.json$/.test(name))
  assert.ok(quarantined && files.includes('state.json'))
  assert.equal(await readFile(join(directory, quarantined), 'utf8'), '{not json')
  assert.equal((await run(directory, 'PASS', 10)).exitCode, EXIT.HEALTHY)
}))

test('structurally invalid and oversized state are quarantined, not trusted', () => withDir(async directory => {
  await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 2, lastCheckedAt: at(0).toISOString(), condition: 'HEALTHY', streak: 1, incident: null }))
  const invalid = await run(directory, 'PASS', 5, { quarantineInvalidState: true })
  assert.equal(invalid.report.events[0].reason, 'INVALID')
  await writeFile(join(directory, 'state.json'), 'x'.repeat(20000))
  const large = await run(directory, 'PASS', 10, { quarantineInvalidState: true })
  assert.equal(large.report.events[0].reason, 'TOO_LARGE')
}))

test('job summary contains aggregate status only', () => {
  const text = formatMonitorSummary({ status: 'FAIL', checkedAt: at(0).toISOString(), incident: { kind: 'HTTP_FAILURE', openedAt: at(0).toISOString() }, events: [{ type: 'OPENED', kind: 'HTTP_FAILURE' }] })
  assert.match(text, /\*\*FAIL\*\*/)
  assert.match(text, /HTTP_FAILURE since/)
  assert.match(text, /OPENED HTTP_FAILURE/)
  assert.match(text, /Login, checkout and data access are not verified/)
})
