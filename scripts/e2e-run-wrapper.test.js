import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const CANARY = 'CANARY-SECRET-9f3a'
const ROOT = resolve('.')
let tmp, out, runnerTmp

const pass = (spec, project) => ({ file: spec, specs: [{ file: spec, tests: [{ projectName: project, status: 'expected', results: [{ status: 'passed' }] }] }] })
function report({ omit = [], failed = false, errors = [], skippedOne = false } = {}) {
  const specs = ['auth-isolation-staging.spec.ts', 'documents-staging.spec.ts', 'preview-smoke.spec.ts', 'preview-context-sentinel.spec.ts']
  const suites = []
  for (const s of specs) for (const p of ['desktop', 'iphone']) {
    if (omit.includes(`${s}|${p}`)) continue
    const x = pass(s, p)
    if (skippedOne && s === 'preview-smoke.spec.ts' && p === 'iphone') x.specs[0].tests[0] = { projectName: p, status: 'skipped', results: [{ status: 'skipped' }] }
    suites.push(x)
  }
  return { stats: { expected: 8, unexpected: failed ? 1 : 0, flaky: 0, skipped: 0 }, errors, suites }
}
function run(cmd) {
  const r = spawnSync('bash', ['scripts/run-credentialed-e2e.sh'], {
    env: { PATH: process.env.PATH, TRUSTED_DIR: ROOT, WORKDIR: ROOT, OUT_DIR: out, RUNNER_TEMP: runnerTmp, E2E_CMD: cmd }, encoding: 'utf8',
  })
  const summary = existsSync(join(out, 'summary.json')) ? readFileSync(join(out, 'summary.json'), 'utf8') : ''
  return { code: r.status, parent: r.stdout + r.stderr, summary }
}
const emit = (rep, code = 0) => `echo ${CANARY}-stdout; echo ${CANARY}-stderr >&2; cat > "$PLAYWRIGHT_JSON_OUTPUT_NAME" <<'J'\n${JSON.stringify(rep)}\nJ\nexit ${code}`

beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'wrap-test-')); out = join(tmp, 'out'); runnerTmp = join(tmp, 'rt'); spawnSync('mkdir', ['-p', runnerTmp]) })
afterEach(() => rmSync(tmp, { recursive: true, force: true }))
const noLeak = (r) => { expect(r.parent).not.toContain(CANARY); expect(r.summary).not.toContain(CANARY); expect(readdirSync(runnerTmp)).toEqual([]) }

describe('run-credentialed-e2e.sh + summarize-e2e-report.mjs', () => {
  it('complete passing run => pass, exit 0, canary in test stdout/stderr never reaches parent/summary, scratch removed', () => {
    const r = run(emit(report())); expect(r.code).toBe(0); expect(JSON.parse(r.summary).result).toBe('pass'); noLeak(r)
  })
  it('test failure (injected error text in report + stderr) => fail, nothing leaked', () => {
    const rep = report({ failed: true }); rep.suites[0].specs[0].tests[0].results[0] = { status: 'failed', error: { message: CANARY } }
    const r = run(emit(rep, 1)); expect(r.code).toBe(1); expect(JSON.parse(r.summary).reason).toBe('test_failures'); noLeak(r)
  })
  it('missing report => blocked', () => {
    const r = run(`echo ${CANARY} >&2; exit 0`); expect(r.code).toBe(1); expect(JSON.parse(r.summary)).toMatchObject({ result: 'blocked', reason: 'no_report' }); noLeak(r)
  })
  it('unparseable report (parser failure) => blocked, scratch still removed', () => {
    const r = run(`echo ${CANARY}; echo '{not json ${CANARY}' > "$PLAYWRIGHT_JSON_OUTPUT_NAME"; exit 0`)
    expect(r.code).toBe(1); expect(JSON.parse(r.summary).reason).toBe('unparseable_report'); noLeak(r)
  })
  it('malformed report => blocked', () => {
    const r = run(`echo '{"a":1}' > "$PLAYWRIGHT_JSON_OUTPUT_NAME"; exit 0`); expect(JSON.parse(r.summary).reason).toBe('malformed_report'); noLeak(r)
  })
  it('nonzero exit with an otherwise clean report => fail', () => {
    const r = run(emit(report(), 1)); expect(r.code).toBe(1); expect(JSON.parse(r.summary).reason).toBe('nonzero_exit'); noLeak(r)
  })
  it('top-level errors => fail', () => {
    const r = run(emit(report({ errors: [{ message: CANARY }] }))); expect(JSON.parse(r.summary).reason).toBe('top_level_errors'); noLeak(r)
  })
  it('REGRESSION (Codex P1): incomplete coverage (a mandatory spec/project missing) => not pass', () => {
    const r = run(emit(report({ omit: ['documents-staging.spec.ts|desktop'] })))
    expect(r.code).toBe(1); expect(JSON.parse(r.summary).result).toBe('fail'); expect(JSON.parse(r.summary).reason).toBe('coverage_incomplete'); noLeak(r)
  })
  it('a skipped mandatory scenario => not pass', () => {
    const r = run(emit(report({ skippedOne: true }))); expect(JSON.parse(r.summary).reason).toBe('coverage_incomplete'); noLeak(r)
  })
  it('summary contains only allowlisted keys', () => {
    const s = JSON.parse(run(emit(report())).summary)
    expect(Object.keys(s).sort()).toEqual(['coverage', 'exit_code', 'reason', 'result', 'stats'])
    expect(Object.keys(s.coverage[0]).sort()).toEqual(['not_passed', 'passed', 'project', 'spec'])
  })
  it('summarizer crash path still yields a fail-closed summary and cleans scratch', () => {
    const r = spawnSync('bash', ['scripts/run-credentialed-e2e.sh'], { env: { PATH: process.env.PATH, TRUSTED_DIR: '/nonexistent', WORKDIR: ROOT, OUT_DIR: out, RUNNER_TEMP: runnerTmp, E2E_CMD: `echo ${CANARY}; exit 0` }, encoding: 'utf8' })
    expect(r.status).not.toBe(0); expect(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).result).toBe('blocked'); expect(r.stdout + r.stderr).not.toContain(CANARY); expect(readdirSync(runnerTmp)).toEqual([])
  })
})
describe('runWithTeardown', () => {
  it('never prints the raw teardown error', async () => {
    const { runWithTeardown } = await import('../e2e/support/runWithTeardown.ts')
    const writes = []; const orig = process.stderr.write.bind(process.stderr); process.stderr.write = (s) => { writes.push(String(s)); return true }
    try { await expect(runWithTeardown(async () => { throw new Error('body') }, async () => { throw new Error(CANARY) })).rejects.toThrow('body') } finally { process.stderr.write = orig }
    expect(writes.join('')).not.toContain(CANARY); expect(writes.join('')).toMatch(/details withheld/)
  })
})
