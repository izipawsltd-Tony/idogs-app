import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createServer as createViteServer } from 'vite'
import { assertRecoveryQaRuntime, makeRecoveryQaService, makeRecoveryQaHandler } from '../api/_lib/account-recovery-qa.js'

assertRecoveryQaRuntime()
const projectId = 'demo-idogs-account-mobile'
const app = initializeApp({ projectId }), auth = getAuth(app), db = getFirestore(app)
for (const [uid, phoneNumber, email] of [['recovery-demo', '+61400000201', 'qa-owner@example.invalid'], ['recovery-incomplete-demo', '+61400000202', null]]) {
  try { await auth.getUser(uid) }
  catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    await auth.createUser({ uid, phoneNumber, ...(email ? { email, emailVerified: true, password: 'Synthetic-demo-only-123!' } : {}) })
  }
}
// Fixed fake code exists ONLY in this loopback demo project. Never expose a
// fake-code adapter or its inbox with real Firebase users or public deployment.
const service = makeRecoveryQaService({ auth, db, secret: randomBytes(32).toString('hex'), code: () => '123456', sms: { fake: true, async send() {} } })
const handler = makeRecoveryQaHandler(service)
process.env.VITE_ACCOUNT_RECOVERY_QA = '1'
process.env.VITE_FIREBASE_API_KEY = 'emulator-key'
process.env.VITE_FIREBASE_AUTH_DOMAIN = 'localhost'
process.env.VITE_FIREBASE_PROJECT_ID = projectId
process.env.VITE_FIREBASE_APP_ID = 'demo-account-recovery'
const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' })
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/api/')) return vite.middlewares(req, res)
  res.status = status => { res.statusCode = status; return res }
  res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res }
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:5193') return res.status(403).json({ error: 'Use the local QA page.' })
  if (req.url === '/api/auth-options' && req.method === 'GET') return res.status(200).json({ providers: [], phone: false })
  if (req.url !== '/api/account-recovery') return res.status(503).json({ error: 'Not part of this local QA.' })
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (Buffer.byteLength(text) > 2048) return res.status(413).json({ error: 'Request too large' })
  }
  req.body = text
  await handler(req, res)
})
await new Promise(resolve => server.listen(5193, '127.0.0.1', resolve))
console.log('Synthetic recovery QA: http://127.0.0.1:5193/forgot-login-email')
console.log('Fixtures and simulated code are documented in qa/ACCOUNT-RECOVERY-QA-20261031.md. No real SMS is sent.')
async function stop() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await vite.close(); await db.terminate(); process.exit(0) }
process.once('SIGINT', stop); process.once('SIGTERM', stop)
