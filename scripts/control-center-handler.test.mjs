import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createControlCenterHandler } from '../api/_lib/control-center-handler.js'

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
}
test('anonymous callers cannot trigger operating reads', async () => {
  let reads = 0
  const handler = createControlCenterHandler({ verifySuperAdmin: async (_req, res) => { res.status(401).json({ error: 'Unauthorized' }); return null }, buildBrief: async () => { reads++ } })
  const res = response()
  await handler({ method: 'GET' }, res)
  assert.equal(res.code, 401)
  assert.equal(reads, 0)
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
})
test('write methods are rejected before authentication or data access', async () => {
  const fail = () => { throw new Error('must not run') }
  const res = response()
  await createControlCenterHandler({ verifySuperAdmin: fail, buildBrief: fail })({ method: 'POST' }, res)
  assert.equal(res.code, 405)
  assert.equal(res.headers.Allow, 'GET')
})
test('evidence view excludes private source data, default view preserves dashboard', async () => {
  const handler = createControlCenterHandler({ verifySuperAdmin: async () => ({ uid: 'admin' }), buildBrief: async () => ({ generatedAt: new Date().toISOString(), accounts: ['PRIVATE'], facts: { totalUsers: 4 } }) })
  const res = response()
  await handler({ method: 'GET', query: { view: 'evidence' } }, res)
  assert.equal(res.body.metrics.totalUsers, 4)
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE/)
  const dashboard = response()
  await handler({ method: 'GET' }, dashboard)
  assert.deepEqual(dashboard.body.accounts, ['PRIVATE'])
  assert.equal(dashboard.body.evidence.freshness, 'FRESH')
})
test('invalid view avoids expensive reads and failures do not leak provider errors', async () => {
  let reads = 0
  const handler = createControlCenterHandler({ verifySuperAdmin: async () => ({}), buildBrief: async () => { reads++; throw new Error('SECRET provider URL') } })
  const invalid = response()
  await handler({ method: 'GET', query: { view: ['evidence', 'raw'] } }, invalid)
  assert.equal(invalid.code, 400)
  assert.equal(reads, 0)
  const failed = response()
  await handler({ method: 'GET' }, failed)
  assert.equal(failed.code, 503)
  assert.doesNotMatch(JSON.stringify(failed.body), /SECRET/)
})
