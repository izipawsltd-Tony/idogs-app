import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSiteHealth, createSiteHealthHandler } from '../api/_lib/control-center-health.js'

const reply = (status = 200, headers = { 'content-type': 'text/html' }) => ({ status, headers: new Headers(headers), body: { cancel: async () => {} } })
test('only canonical targets are probed without cookies and redirects are not followed', async () => {
  const calls = []
  const result = await checkSiteHealth({ fetchImpl: async (url, options) => { calls.push({ url, options }); return reply() } })
  assert.equal(result.status, 'PASS')
  assert.equal(result.scheduled, false)
  assert.deepEqual(calls.map(call => call.url), ['https://idogs.com.au/', 'https://idogs.com.au/signup'])
  for (const { options } of calls) {
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers.Cookie, undefined)
    assert.equal(options.headers.Authorization, undefined)
  }
})
test('redirects, server failures and non-HTML responses never pass', async () => {
  for (const response of [reply(302), reply(500), reply(200, { 'content-type': 'application/json' })]) {
    assert.equal((await checkSiteHealth({ fetchImpl: async () => response })).status, 'FAIL')
  }
})
test('blocked access and challenges are unknown rather than a claimed application outage', async () => {
  for (const response of [reply(401), reply(403), reply(200, { 'x-vercel-mitigated': 'challenge', 'content-type': 'text/html' })]) {
    assert.equal((await checkSiteHealth({ fetchImpl: async () => response })).status, 'UNKNOWN')
  }
})
test('hung transport is bounded and aborted even when fetch ignores cancellation', async () => {
  const signals = []
  const result = await checkSiteHealth({ timeoutMs: 10, fetchImpl: (_url, options) => { signals.push(options.signal); return new Promise(() => {}) } })
  assert.equal(result.status, 'UNKNOWN')
  assert.ok(result.checks.every(check => check.reason === 'TIMEOUT'))
  assert.ok(signals.every(signal => signal.aborted))
})
test('transport errors are sanitized and anonymous requests cannot probe', async () => {
  const result = await checkSiteHealth({ fetchImpl: async () => { throw new Error('SECRET') } })
  assert.doesNotMatch(JSON.stringify(result), /SECRET/)
  let calls = 0
  const res = { setHeader() {}, status(code) { this.code = code; return this }, json() {} }
  await createSiteHealthHandler({ verifySuperAdmin: async (_req, response) => { response.status(401).json({}); return null }, runCheck: async () => { calls++ } })({ method: 'GET' }, res)
  assert.equal(res.code, 401)
  assert.equal(calls, 0)
})
