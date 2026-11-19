import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker, { dispatchMonitor, dispatchRequest } from './worker.mjs'

const TOKEN = 'github_pat_' + 'x'.repeat(40)

test('dispatches only the fixed monitor workflow on master, marked as the external clock', () => {
  const { url, init } = dispatchRequest(TOKEN)
  assert.equal(url, 'https://api.github.com/repos/izipawsltd-Tony/idogs-app/actions/workflows/control-center-monitor.yml/dispatches')
  assert.equal(init.method, 'POST')
  assert.deepEqual(JSON.parse(init.body), { ref: 'master', inputs: { trigger: 'external-cron' } })
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
})

test('success and failure are logged without the token', async () => {
  const at = () => new Date('2026-11-20T00:00:00Z')
  const ok = await dispatchMonitor({ GITHUB_DISPATCH_TOKEN: TOKEN }, { fetchImpl: async () => ({ status: 204 }), now: at })
  assert.deepEqual(ok, { ok: true, line: '2026-11-20T00:00:00.000Z dispatch OK HTTP 204' })
  const denied = await dispatchMonitor({ GITHUB_DISPATCH_TOKEN: TOKEN }, { fetchImpl: async () => ({ status: 403 }), now: at })
  assert.equal(denied.ok, false)
  assert.match(denied.line, /FAILED HTTP 403/)
  const network = await dispatchMonitor({ GITHUB_DISPATCH_TOKEN: TOKEN }, { fetchImpl: async () => { throw new Error('network down') }, now: at })
  assert.match(network.line, /FAILED network down/)
  for (const result of [ok, denied, network]) assert.doesNotMatch(result.line, /github_pat_/)
})

test('missing secret fails closed and the worker has no public HTTP surface', async () => {
  const missing = await dispatchMonitor({}, { fetchImpl: async () => { throw new Error('must not be called') } })
  assert.match(missing.line, /GITHUB_DISPATCH_TOKEN is not set/)
  assert.equal((await worker.fetch()).status, 404)
})
