import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceMonitor } from '../api/_lib/control-center-incidents.js'

const now = new Date('2026-11-10T12:00:00Z')
const observation = (status, minute) => ({ status, checkedAt: `2026-11-10T11:${String(minute).padStart(2, '0')}:00Z` })
const advance = (previous, status, minute) => advanceMonitor(previous, observation(status, minute), { now })
test('requires repeated failure, deduplicates an ongoing incident and requires repeated recovery', () => {
  let result = advance(null, 'FAIL', 1)
  assert.equal(result.events.length, 0)
  result = advance(result.state, 'FAIL', 2)
  assert.equal(result.events[0].type, 'OPENED')
  const id = result.state.incident.id
  result = advance(result.state, 'FAIL', 3)
  assert.equal(result.events.length, 0)
  assert.equal(result.state.incident.id, id)
  result = advance(result.state, 'PASS', 4)
  assert.equal(result.events.length, 0)
  result = advance(result.state, 'PASS', 5)
  assert.equal(result.events[0].type, 'RESOLVED')
  assert.equal(result.state.incident, null)
})
test('network uncertainty produces an observation gap, never a claimed application outage or recovery', () => {
  let result = advance(null, 'UNKNOWN', 1)
  result = advance(result.state, 'UNKNOWN', 2)
  assert.equal(result.events[0].kind, 'OBSERVATION_GAP')
  result = advance(result.state, 'FAIL', 3)
  assert.equal(result.events.length, 0)
  result = advance(result.state, 'FAIL', 4)
  assert.deepEqual(result.events.map(event => event.type), ['SUPERSEDED', 'OPENED'])
  assert.equal(result.state.incident.kind, 'HTTP_FAILURE')
})
test('replayed, out-of-order and future observations cannot modify state', () => {
  const previous = advance(null, 'FAIL', 2).state
  for (const input of [observation('PASS', 1), observation('PASS', 2), { status: 'PASS', checkedAt: 'invalid' }, { status: 'PASS', checkedAt: '2026-11-11T00:00:00Z' }]) {
    assert.throws(() => advanceMonitor(previous, input, { now }), /Invalid or replayed/)
  }
  assert.throws(() => advanceMonitor({ ...previous, streak: -1 }, observation('PASS', 3), { now }), /Invalid monitor state/)
  assert.throws(() => advanceMonitor({ ...previous, lastCheckedAt: 'invalid' }, observation('PASS', 3), { now }), /Invalid monitor state/)
})

test('a missed monitoring window breaks failure and recovery streaks', () => {
  let result = advance(null, 'FAIL', 1)
  result = advance(result.state, 'FAIL', 32)
  assert.equal(result.state.incident, null)
  result = advance(result.state, 'FAIL', 33)
  assert.equal(result.state.incident.kind, 'HTTP_FAILURE')

  const later = new Date('2026-11-10T13:00:00Z')
  result = advance(result.state, 'PASS', 34)
  result = advanceMonitor(result.state, { status: 'PASS', checkedAt: '2026-11-10T12:05:00Z' }, { now: later })
  assert.equal(result.state.incident.kind, 'HTTP_FAILURE')
  result = advanceMonitor(result.state, { status: 'PASS', checkedAt: '2026-11-10T12:20:00Z' }, { now: later })
  assert.equal(result.events[0].type, 'RESOLVED')
})
