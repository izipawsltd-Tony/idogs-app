// CI-only server for the SMS → email → dog → password journey E2E
// (e2e/journey). Serves the emulator build in dist/ and runs the REAL
// api/*.js handlers in-process against the Firebase emulators. External
// services (Resend email, SMS, Stripe, Google config) are never contacted.
//
// Usage (inside `firebase emulators:exec --only auth,firestore`):
//   node scripts/e2e-journey-server.mjs   → http://127.0.0.1:4174
import './test-helpers/emulator-credentials.mjs'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Refusing to start outside the Firebase emulators')
}
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.JOURNEY_PORT || 4174)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

// Endpoints that would reach a real third party: answered locally.
const STUBS = {
  'auth-options': () => ({ providers: [], emailLink: true, phone: true, emailPassword: true, smsAustralia: 'allowed' }),
  'send-email': () => ({ ok: true, stubbed: true }),
  'send-sms': () => ({ ok: true, stubbed: true }),
  'welcome': () => ({ ok: true, stubbed: true }),
}
const NEVER_RUN = /stripe|checkout|billing|sms|scan|meta|resend|cron|reminder/i

function vercelRes(res) {
  res.status = code => { res.statusCode = code; return res }
  res.json = obj => { if (!res.headersSent) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return res }
  res.send = body => { res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); return res }
  return res
}

const apiLog = []
createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (url.pathname === '/__journey/api-log') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(apiLog)) }
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).split('/')[0]
      vercelRes(res)
      apiLog.push(`${req.method} ${name}`)
      if (STUBS[name]) return res.status(200).json(STUBS[name]())
      if (NEVER_RUN.test(name) || !/^[a-z0-9-]+$/.test(name)) return res.status(200).json({ stubbed: true })
      let handler
      try { handler = (await import(join(ROOT, 'api', `${name}.js`))).default } catch { return res.status(404).json({ error: 'not found' }) }
      const chunks = []
      for await (const c of req) chunks.push(c)
      const raw = Buffer.concat(chunks).toString('utf8')
      req.query = Object.fromEntries(url.searchParams)
      req.body = raw && (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : raw
      return await handler(req, res)
    }
    let file = normalize(join(DIST, decodeURIComponent(url.pathname)))
    if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end() }
    const isFile = await stat(file).then(s => s.isFile(), () => false)
    if (!isFile) file = join(DIST, 'index.html')
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream')
    res.end(await readFile(file))
  } catch (err) {
    console.error('journey-server', url.pathname, err)
    if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: 'journey server error' })) }
  }
}).listen(PORT, '127.0.0.1', () => console.log(`journey server on http://127.0.0.1:${PORT}`))
