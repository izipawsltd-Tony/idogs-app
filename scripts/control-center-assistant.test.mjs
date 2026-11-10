import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAssistantProvider, createAssistantHandler } from '../api/_lib/control-center-assistant.js'

const env = { IDOGS_CONTROL_CENTER_AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'TEST_NOT_A_REAL_KEY' }
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const completion = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Review incomplete revenue evidence.' }] }
const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v }, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } })
const evidence = () => ({ generatedAt: new Date().toISOString(), facts: { totalUsers: 8 }, private: 'PRIVATE CUSTOMER' })

test('provider disabled by default, no outbound request or credential fallback', async () => {
  let calls = 0
  for (const configuration of [{}, { ANTHROPIC_API_KEY: 'test' }, { IDOGS_CONTROL_CENTER_AI_ENABLED: 'true' }]) {
    const provider = createAssistantProvider({ env: configuration, fetchImpl: async () => { calls++ } })
    assert.equal(provider.enabled(), false)
    await assert.rejects(provider.answer('question', {}), /Assistant unavailable/)
  }
  assert.equal(calls, 0)
})
test('fixed provider, no tools, bounded output and no redirects or automatic retries', async () => {
  let calls = 0
  const provider = createAssistantProvider({ env, fetchImpl: async (url, options) => {
    calls++
    assert.equal(url, 'https://api.anthropic.com/v1/messages')
    assert.equal(options.redirect, 'error')
    const request = JSON.parse(options.body)
    assert.equal(request.max_tokens, 600)
    assert.equal(request.tools, undefined)
    assert.equal(request.messages.length, 1)
    return reply(completion)
  } })
  assert.equal((await provider.answer('question', {})).answer, completion.content[0].text)
  assert.equal(calls, 1)
})
test('provider failures, tool requests and oversized responses are rejected', async () => {
  for (const response of [reply({ error: 'SECRET' }, 429), reply({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'delete_user' }] }), reply({ ...completion, content: [{ type: 'text', text: 'x'.repeat(70000) }] })]) {
    let calls = 0
    const provider = createAssistantProvider({ env, fetchImpl: async () => { calls++; return response } })
    await assert.rejects(provider.answer('question', {}), error => error.message === 'Assistant unavailable')
    assert.equal(calls, 1)
  }
})
test('usable text at the approved token ceiling is returned with an explicit incomplete flag', async () => {
  let calls = 0
  const provider = createAssistantProvider({ env, fetchImpl: async (_url, options) => {
    calls++
    assert.equal(JSON.parse(options.body).max_tokens, 600)
    return reply({ ...completion, stop_reason: 'max_tokens' })
  } })
  const result = await provider.answer('Three priorities with evidence', {})
  assert.equal(result.answer, completion.content[0].text)
  assert.equal(result.truncated, true)
  assert.equal(calls, 1)
})
test('timeout bounds transport and slow response body, including fetch ignoring abort', async () => {
  for (const fetchImpl of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const provider = createAssistantProvider({ env, timeoutMs: 10, fetchImpl })
    await assert.rejects(provider.answer('question', {}), /Assistant unavailable/)
  }
})
test('authorization, configuration and payload failures cause no operating reads or spend', async () => {
  const forbidden = () => { throw new Error('must not run') }
  let response = res()
  await createAssistantHandler({ verifySuperAdmin: async (_req, result) => { result.status(401).json({}); return null }, buildBrief: forbidden, provider: { enabled: forbidden }, budget: {} })({ method: 'POST', body: { question: 'hi' } }, response)
  assert.equal(response.code, 401)
  const handler = createAssistantHandler({ verifySuperAdmin: async () => ({ uid: 'admin' }), buildBrief: forbidden, provider: { enabled: () => true }, budget: {} })
  for (const body of [{ question: 'hi', evidence: {} }, { question: 'x'.repeat(2001) }, { question: ' ' }, [], null]) {
    response = res()
    await handler({ method: 'POST', body }, response)
    assert.equal(response.code, 400)
  }
})
test('only projected server evidence reaches provider; no question stored in audit', async () => {
  const calls = []
  const handler = createAssistantHandler({
    verifySuperAdmin: async () => ({ uid: 'admin' }), buildBrief: async () => evidence(),
    deploymentEnvironment: 'preview',
    provider: { enabled: () => true, answer: async (question, context) => {
      assert.equal(question, 'How is iDogs?')
      assert.equal(context.metrics.totalUsers, 8)
      assert.equal(context.deploymentEnvironment, 'preview')
      assert.doesNotMatch(JSON.stringify(context), /PRIVATE CUSTOMER/)
      return { answer: 'Review data gaps.' }
    } },
    budget: { reserve: async uid => { calls.push(uid); return { auditId: 'audit-1' } }, finish: async (...args) => { calls.push(args) } },
  })
  const response = res()
  await handler({ method: 'POST', body: { question: 'How is iDogs?' } }, response)
  assert.equal(response.code, 200)
  assert.equal(response.body.readOnly, true)
  assert.deepEqual(calls, ['admin', [{ auditId: 'audit-1' }, 'SUCCESS']])
})
test('exhausted budget and stale evidence prevent model calls', async () => {
  const forbidden = () => { throw new Error('must not run') }
  let response = res()
  const deps = { verifySuperAdmin: async () => ({ uid: 'admin' }), buildBrief: async () => evidence(), provider: { enabled: () => true, answer: forbidden }, budget: { reserve: async () => null } }
  await createAssistantHandler(deps)({ method: 'POST', body: { question: 'hi' } }, response)
  assert.equal(response.code, 429)
  response = res()
  await createAssistantHandler({ ...deps, buildBrief: async () => ({ generatedAt: '2020-01-01' }), budget: { reserve: forbidden } })({ method: 'POST', body: { question: 'hi' } }, response)
  assert.equal(response.code, 503)
})
test('provider failure records only safe diagnostics and does not refund or retry', async () => {
  const reports = [], audits = []
  let calls = 0
  const handler = createAssistantHandler({
    verifySuperAdmin: async () => ({ uid: 'PRIVATE_ADMIN' }), buildBrief: async () => evidence(),
    provider: { enabled: () => true, answer: async () => { calls++; throw new Error('SECRET provider body') } },
    budget: { reserve: async () => ({ auditId: 'audit-1' }), finish: async (...args) => audits.push(args) },
    report: event => reports.push(event),
  })
  const response = res()
  await handler({ method: 'POST', body: { question: 'PRIVATE QUESTION' } }, response)
  assert.equal(response.code, 503)
  assert.equal(calls, 1)
  assert.deepEqual(reports, [{ stage: 'PROVIDER', code: 'ASSISTANT_UNAVAILABLE' }])
  assert.deepEqual(audits, [[{ auditId: 'audit-1' }, 'UNAVAILABLE']])
  assert.doesNotMatch(JSON.stringify({ reports, body: response.body }), /SECRET|PRIVATE/)
})
