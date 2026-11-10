import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBriefCache } from '../api/_lib/control-center-cache.js'

test('concurrent admin reads share one build and preserve source timestamp', async () => {
  let calls = 0, release
  let clock = Date.parse('2026-11-10T00:00:00Z')
  const build = createBriefCache(async () => { calls++; await new Promise(resolve => { release = resolve }); return { generatedAt: new Date(clock).toISOString() } }, { now: () => clock })
  const first = build(), second = build()
  assert.equal(calls, 1)
  release()
  const payload = await first
  assert.equal(await second, payload)
  clock += 30000
  assert.equal(await build(), payload)
  assert.equal(calls, 1)
  assert.equal(payload.generatedAt, '2026-11-10T00:00:00.000Z')
})
test('expired cache failure never returns stale fallback and next call retries', async () => {
  let clock = Date.parse('2026-11-10T00:00:00Z'), calls = 0
  const build = createBriefCache(async () => { calls++; if (calls === 2) throw new Error('unavailable'); return { generatedAt: new Date(clock).toISOString() } }, { now: () => clock })
  await build()
  clock += 60000
  await assert.rejects(build(), /unavailable/)
  assert.equal((await build()).generatedAt, new Date(clock).toISOString())
  assert.equal(calls, 3)
})
test('a slow build cannot receive a fresh additional minute of cache life', async () => {
  let clock = Date.parse('2026-11-10T00:00:00Z'), calls = 0
  const build = createBriefCache(async () => { calls++; const generatedAt = new Date(clock).toISOString(); clock += 61000; return { generatedAt } }, { now: () => clock })
  await build()
  await build()
  assert.equal(calls, 2)
})
test('future and invalid timestamps are rejected instead of cached', async () => {
  for (const generatedAt of ['invalid', '2026-11-11T00:00:00Z']) {
    const build = createBriefCache(async () => ({ generatedAt }), { now: () => Date.parse('2026-11-10T00:00:00Z') })
    await assert.rejects(build(), /Invalid brief timestamp/)
  }
})
