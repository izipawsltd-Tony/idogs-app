// Deterministic chronological ordering for puppy/QR Passport timelines.
// Owner QA (01 Nov 2026): the public timeline was paged by posting time
// (createdAt) while each card shows its event date, so back-dated or edited
// updates appeared out of order. Order by the event date instead.

/** Normalise Firestore Timestamp / Date / ISO / YYYY-MM-DD / epoch s|ms to epoch ms, or null. */
export function toMillis(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    return value < 1e12 ? value * 1000 : value // seconds vs milliseconds
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') { const ms = value.toMillis(); return Number.isFinite(ms) ? ms : null }
    const seconds = value.seconds ?? value._seconds
    if (typeof seconds === 'number') return seconds * 1000 + Math.floor((value.nanoseconds ?? value._nanoseconds ?? 0) / 1e6)
    return null
  }
  if (typeof value === 'string') {
    const s = value.trim()
    // A calendar date has no time zone: anchor it at UTC midday so it can never
    // shift to a neighbouring day for any viewer.
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (d) {
      const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], 12)
      const check = new Date(ms)
      return check.getUTCFullYear() === +d[1] && check.getUTCMonth() === +d[2] - 1 && check.getUTCDate() === +d[3] ? ms : null
    }
    const ms = Date.parse(s)
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

/** Event time: the chosen update date; falls back to when it was posted. */
export function eventMillis(entry) {
  return toMillis(entry?.date) ?? toMillis(entry?.createdAt)
}

/**
 * Comparator for { id, entry } items.
 * newest: latest event first · oldest: earliest event first.
 * Same event date → posting time in the same direction → id ascending.
 * Entries with no usable date at all always go last, by id.
 */
export function compareTimeline(order = 'newest') {
  const dir = order === 'oldest' ? 1 : -1
  return (a, b) => {
    const ea = eventMillis(a.entry), eb = eventMillis(b.entry)
    if (ea == null || eb == null) {
      if (ea == null && eb == null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      return ea == null ? 1 : -1
    }
    if (ea !== eb) return (ea - eb) * dir
    const ca = toMillis(a.entry?.createdAt) ?? 0, cb = toMillis(b.entry?.createdAt) ?? 0
    if (ca !== cb) return (ca - cb) * dir
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }
}

export const TIMELINE_ORDERS = ['newest', 'oldest']
export const normaliseOrder = order => (order === 'oldest' ? 'oldest' : 'newest')
