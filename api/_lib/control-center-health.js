// Fixed public targets only. This checks the frontend HTTP surface, not Auth,
// Firestore, checkout or application correctness. No cookies or credentials.
const TARGETS = Object.freeze([
  Object.freeze({ id: 'website', url: 'https://idogs.com.au/' }),
  Object.freeze({ id: 'signup-page', url: 'https://idogs.com.au/signup' }),
])

export async function checkSiteHealth({ fetchImpl = fetch, timeoutMs = 5000, now = () => Date.now() } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error('Invalid probe timeout')
  const checkedAt = new Date(now()).toISOString()
  const checks = await Promise.all(TARGETS.map(async target => {
    const controller = new AbortController()
    const started = now()
    let timer
    try {
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('PROBE_TIMEOUT')) }, timeoutMs)
      })
      const request = Promise.resolve().then(() => fetchImpl(target.url, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'text/html', 'User-Agent': 'iDogs-Control-Center-Health/1.0' },
      })).then(response => {
        // Release the stream even if a transport finishes after our deadline.
        const cancel = response.body?.cancel()
        cancel?.catch(() => {})
        return response
      })
      const response = await Promise.race([request, expired])
      const challenged = response.headers.get('x-vercel-mitigated') === 'challenge'
      const html = (response.headers.get('content-type') || '').toLowerCase().includes('text/html')
      return {
        id: target.id,
        status: challenged || response.status === 401 || response.status === 403 ? 'UNKNOWN'
          : response.status === 200 && html ? 'PASS' : 'FAIL',
        httpStatus: response.status,
        latencyMs: Math.max(0, now() - started),
        reason: challenged ? 'CHALLENGE' : response.status === 401 || response.status === 403 ? 'ACCESS_BLOCKED'
          : response.status !== 200 ? 'UNEXPECTED_HTTP_STATUS' : !html ? 'UNEXPECTED_CONTENT_TYPE' : 'HTML_REACHABLE',
      }
    } catch {
      return { id: target.id, status: 'UNKNOWN', httpStatus: null, latencyMs: Math.max(0, now() - started), reason: controller.signal.aborted ? 'TIMEOUT' : 'TRANSPORT_ERROR' }
    } finally {
      clearTimeout(timer)
    }
  }))
  return {
    checkedAt,
    status: checks.some(check => check.status === 'FAIL') ? 'FAIL' : checks.every(check => check.status === 'PASS') ? 'PASS' : 'UNKNOWN',
    scope: 'Public HTML reachability only. Login, billing, data access and user journeys are not verified.',
    scheduled: false,
    checks,
  }
}

export function createSiteHealthHandler({ verifySuperAdmin, runCheck = checkSiteHealth }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Vary', 'Authorization')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (!await verifySuperAdmin(req, res)) return
    try {
      return res.status(200).json(await runCheck())
    } catch {
      return res.status(503).json({ error: 'Health check unavailable' })
    }
  }
}
