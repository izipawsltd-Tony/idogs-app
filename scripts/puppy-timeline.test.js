import { describe, expect, it } from 'vitest'
import { toMillis, eventMillis, compareTimeline, normaliseOrder } from '../api/_lib/puppy-timeline.js'

const item = (id, entry) => ({ id, entry })
const ids = (items, order) => [...items].sort(compareTimeline(order)).map(i => i.id)

describe('toMillis normalisation', () => {
  it('handles Firestore Timestamp, serialized timestamp, Date, ISO, calendar date and epoch s/ms', () => {
    const ms = Date.UTC(2026, 9, 28, 12)
    expect(toMillis({ toMillis: () => ms })).toBe(ms)
    expect(toMillis({ _seconds: ms / 1000, _nanoseconds: 0 })).toBe(ms)
    expect(toMillis({ seconds: ms / 1000 })).toBe(ms)
    expect(toMillis(new Date(ms))).toBe(ms)
    expect(toMillis('2026-10-28T12:00:00Z')).toBe(ms)
    expect(toMillis('2026-10-28')).toBe(ms)
    expect(toMillis(ms / 1000)).toBe(ms)
    expect(toMillis(ms)).toBe(ms)
  })
  it('rejects missing and invalid values', () => {
    for (const v of [null, undefined, '', 'yesterday', '2026-02-31', '2026-13-01', NaN, -5, {}, { seconds: 'x' }]) expect(toMillis(v)).toBeNull()
  })
  it('calendar dates are time-zone neutral (midday UTC)', () => {
    expect(new Date(toMillis('2026-01-01')).getUTCHours()).toBe(12)
  })
  it('event time prefers the chosen date, falls back to posting time', () => {
    expect(eventMillis({ date: '2026-01-05', createdAt: '2026-10-01T00:00:00Z' })).toBe(Date.UTC(2026, 0, 5, 12))
    expect(eventMillis({ date: 'bad', createdAt: '2026-10-01T00:00:00Z' })).toBe(Date.UTC(2026, 9, 1))
    expect(eventMillis({})).toBeNull()
  })
})

describe('compareTimeline', () => {
  // Posted in this order (createdAt), but event dates are out of order — the reported bug.
  const items = [
    item('a', { date: '2026-10-20', createdAt: '2026-10-28T09:00:00Z' }), // posted last, older event
    item('b', { date: '2026-10-27', createdAt: '2026-10-21T09:00:00Z' }),
    item('c', { date: '2026-09-01', createdAt: '2026-10-25T09:00:00Z' }), // back-dated
    item('d', { date: '2026-10-27', createdAt: '2026-10-27T09:00:00Z' }), // same date as b, posted later
    item('e', { createdAt: { _seconds: Date.UTC(2026, 9, 10) / 1000 } }), // legacy: no date field
    item('f', {}),                                                          // no usable time at all
    item('g', { date: 'not-a-date' }),                                      // invalid, no fallback
  ]
  it('Newest first: by event date, same-date ties by later posting, undated last', () => {
    expect(ids(items, 'newest')).toEqual(['d', 'b', 'a', 'e', 'c', 'f', 'g'])
  })
  it('Oldest first: exact reverse for dated entries; undated still last', () => {
    expect(ids(items, 'oldest')).toEqual(['c', 'e', 'a', 'b', 'd', 'f', 'g'])
  })
  it('is deterministic regardless of input order', () => {
    const shuffled = [items[4], items[6], items[0], items[3], items[2], items[5], items[1]]
    expect(ids(shuffled, 'newest')).toEqual(ids(items, 'newest'))
    expect(ids(shuffled, 'oldest')).toEqual(ids(items, 'oldest'))
  })
  it('identical timestamps tie-break by id', () => {
    const same = [item('z', { date: '2026-10-01', createdAt: 1 }), item('m', { date: '2026-10-01', createdAt: 1 })]
    expect(ids(same, 'newest')).toEqual(['m', 'z'])
    expect(ids(same, 'oldest')).toEqual(['m', 'z'])
  })
  it('unknown order values fall back to newest', () => {
    expect(normaliseOrder('random')).toBe('newest')
    expect(normaliseOrder('oldest')).toBe('oldest')
  })
})
