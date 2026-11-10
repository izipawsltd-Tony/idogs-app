// Per-function-instance cache, not a shared historical store. Authentication
// must happen before callers access this function. Source timestamps are kept.
export function createBriefCache(buildBrief, { now = () => Date.now(), ttlMs = 60000 } = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 60000) throw new Error('Invalid brief cache TTL')
  let cached = null
  let expiresAt = 0
  let inFlight = null
  return async () => {
    const time = now()
    if (cached && time < expiresAt && time >= Date.parse(cached.generatedAt)) return cached
    if (inFlight) return inFlight
    inFlight = (async () => {
      const payload = await buildBrief()
      const generated = Date.parse(payload?.generatedAt)
      const completed = now()
      if (!Number.isFinite(generated) || generated > completed) throw new Error('Invalid brief timestamp')
      cached = payload
      expiresAt = Math.min(completed + ttlMs, generated + ttlMs)
      return payload
    })()
    try { return await inFlight }
    finally { inFlight = null }
  }
}
