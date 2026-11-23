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
  const tests = suites.flatMap((x) => x.specs.flatMap((sp) => sp.tests))
  const count = (f) => tests.filter(f).length
  const stats = { expected: count((x) => x.status === 'expected'), unexpected: failed ? 1 : 0, flaky: 0, skipped: count((x) => x.status === 'skipped') }
  if (failed) { suites[0].specs[0].tests[0] = { projectName: 'desktop', status: 'unexpected', results: [{ status: 'failed' }] }; stats.expected--; }
  return { stats, errors, suites }
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
  it('nonzero exit with an otherwise clean report => blocked (process and report disagree)', () => {
    const r = run(emit(report(), 1)); expect(r.code).toBe(1); expect(JSON.parse(r.summary)).toMatchObject({ result: 'blocked', reason: 'inconsistent_report' }); noLeak(r)
  })
  it('top-level errors => fail with non-zero exit, blocked with exit 0', () => {
    const r = run(emit(report({ errors: [{ message: CANARY }] }), 1)); expect(JSON.parse(r.summary)).toMatchObject({ result: 'fail', reason: 'top_level_errors' }); noLeak(r)
    const z = run(emit(report({ errors: [{ message: CANARY }] }))); expect(JSON.parse(z.summary)).toMatchObject({ result: 'blocked', reason: 'inconsistent_report' }); noLeak(z)
  })
  it('REGRESSION (Codex P1): incomplete coverage (a mandatory spec/project missing) => not pass', () => {
    const r = run(emit(report({ omit: ['documents-staging.spec.ts|desktop'] })))
    expect(r.code).toBe(1); expect(JSON.parse(r.summary).result).toBe('fail'); expect(JSON.parse(r.summary).reason).toBe('coverage_incomplete'); noLeak(r)
  })
  it('a skipped mandatory scenario => fail (no skips)', () => {
    const r = run(emit(report({ skippedOne: true }))); expect(r.code).toBe(1); expect(JSON.parse(r.summary)).toMatchObject({ result: 'fail', reason: 'skipped_tests' }); noLeak(r)
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
const reportWith = (mut) => { const r = report(); mut(r); return r }
describe('strict schema (Codex round 2 regressions)', () => {
  const blocked = (rep, why = 'malformed_report') => { const r = run(emit(rep)); expect(r.code).toBe(1); expect(JSON.parse(r.summary)).toEqual({ result: 'blocked', reason: why, exit_code: 0 }); noLeak(r); expect(r.parent).toBe('') }
  it('stats:{} with errors:{message} is BLOCKED (never pass)', () => blocked(reportWith((r) => { r.stats = {}; r.errors = { message: CANARY } })))
  it('null nested suite is BLOCKED with a fixed summary and NO raw stderr from the summarizer', () => blocked(reportWith((r) => { r.suites[0].suites = [null] })))
  it('errors must be an array', () => { blocked(reportWith((r) => { r.errors = {} })); blocked(reportWith((r) => { delete r.errors })) })
  it('stats counts must be non-negative integers', () => { blocked(reportWith((r) => { r.stats.expected = '8' })); blocked(reportWith((r) => { r.stats.unexpected = -1 })); blocked(reportWith((r) => { r.stats.flaky = 1.5 })); blocked(reportWith((r) => { r.stats.skipped = null })) })
  it('stats must equal the tests actually present (no inflated/deflated counts)', () => blocked(reportWith((r) => { r.stats.expected += 5 }), 'inconsistent_report'))
  it('malformed spec/test/result shapes are BLOCKED', () => {
    blocked(reportWith((r) => { r.suites[0].specs[0].tests = {} }))
    blocked(reportWith((r) => { r.suites[0].specs[0].tests[0].results = null }))
    blocked(reportWith((r) => { r.suites[0].specs[0].tests[0].projectName = 5 }))
    blocked(reportWith((r) => { r.suites[0].specs[0].tests[0].results = [null] }))
    blocked(reportWith((r) => { r.suites[0].specs = 'x' }))
    blocked(reportWith((r) => { r.suites = {} }))
    blocked(reportWith((r) => { r.suites[0].specs[0] = null }))
  })
  it('a non-JSON-object report (array, string, number, null) is BLOCKED', () => {
    for (const v of ['[]', '"x"', '5', 'null']) { const r = run(`echo '${v}' > "$PLAYWRIGHT_JSON_OUTPUT_NAME"; exit 0`); expect(JSON.parse(r.summary).result).toBe('blocked'); noLeak(r) }
  })
  it('summarizer stdout/stderr never reach the parent even when it crashes on a hostile --out', () => {
    const r = spawnSync('bash', ['scripts/run-credentialed-e2e.sh'], { env: { PATH: process.env.PATH, TRUSTED_DIR: ROOT, WORKDIR: ROOT, OUT_DIR: out, RUNNER_TEMP: runnerTmp, E2E_CMD: emit(report()), SUMMARY_ARGS: '--bogus' }, encoding: 'utf8' })
    expect(r.stdout + r.stderr).not.toContain(CANARY); expect(readdirSync(runnerTmp)).toEqual([])
  })
})
// ---- Owner Gate R-1: fail-closed verdict contract v1 ----
const t_ = (status, ...results) => ({ projectName: 'desktop', status, results: results.map((s) => ({ status: s })) })
const withExtra = (test, statsPatch) => reportWith((r) => {
  r.suites.push({ file: 'extra.spec.ts', specs: [{ file: 'extra.spec.ts', tests: [test] }] })
  Object.assign(r.stats, statsPatch)
})
const verdict = (rep, code = 0) => { const r = run(emit(rep, code)); noLeak(r); return { code: r.code, ...JSON.parse(r.summary) } }

describe('verdict contract v1 (R-1 adversarial regressions)', () => {
  it('CODEX FIXTURE: 8 mandatory passes + non-mandatory unexpected failure booked as expected (9/0/0/0), exit 0 => blocked', () => {
    const v = verdict(withExtra(t_('unexpected', 'failed'), { expected: 9 }))
    expect(v).toMatchObject({ code: 1, result: 'blocked', reason: 'inconsistent_report' })
  })
  it('the same failure with honest stats => fail/test_failures (non-mandatory failures count)', () => {
    expect(verdict(withExtra(t_('unexpected', 'failed'), { unexpected: 1 }), 1)).toMatchObject({ result: 'fail', reason: 'test_failures' })
  })
  it('a detailed failure with exit 0 is never pass, even with honest stats', () => {
    expect(verdict(withExtra(t_('unexpected', 'failed'), { unexpected: 1 }), 0)).toMatchObject({ result: 'blocked', reason: 'inconsistent_report' })
  })
  it('flaky: hidden in expected => blocked; honest => fail/flaky_tests', () => {
    expect(verdict(withExtra(t_('flaky', 'failed', 'passed'), { expected: 9 }))).toMatchObject({ result: 'blocked', reason: 'inconsistent_report' })
    expect(verdict(withExtra(t_('flaky', 'failed', 'passed'), { flaky: 1 }))).toMatchObject({ result: 'fail', reason: 'flaky_tests' })
  })
  it('skip anywhere: hidden in expected => blocked; honest => fail/skipped_tests (NO SKIPS)', () => {
    expect(verdict(withExtra(t_('skipped'), { expected: 9 }))).toMatchObject({ result: 'blocked', reason: 'inconsistent_report' })
    expect(verdict(withExtra(t_('skipped', 'skipped'), { skipped: 1 }))).toMatchObject({ result: 'fail', reason: 'skipped_tests' })
  })
  it('unknown test.status or result.status => blocked/malformed', () => {
    expect(verdict(withExtra(t_('bogus', 'failed'), { expected: 9 }))).toMatchObject({ result: 'blocked', reason: 'malformed_report' })
    expect(verdict(withExtra(t_('expected', 'weird'), { expected: 9 }))).toMatchObject({ result: 'blocked', reason: 'malformed_report' })
    expect(verdict(withExtra(t_('Expected', 'passed'), { expected: 9 }))).toMatchObject({ result: 'blocked', reason: 'malformed_report' })
  })
  it('status contradicts own results => blocked/inconsistent', () => {
    for (const bad of [t_('expected', 'timedOut'), t_('expected', 'failed'), t_('expected', 'interrupted'), t_('expected'), t_('expected', 'failed', 'passed'),
      t_('unexpected', 'passed'), t_('unexpected'), t_('flaky', 'passed'), t_('flaky', 'passed', 'failed'), t_('skipped', 'passed')]) {
      expect(verdict(withExtra(bad, { [bad.status]: (bad.status === 'expected' ? 9 : 1) }))).toMatchObject({ result: 'blocked', reason: 'inconsistent_report' })
    }
  })
  it('a failure moved between buckets (booked as skipped or flaky) => blocked', () => {
    expect(verdict(withExtra(t_('unexpected', 'failed'), { skipped: 1 }))).toMatchObject({ result: 'blocked', reason: 'inconsistent_report' })
    expect(verdict(withExtra(t_('unexpected', 'failed'), { flaky: 1 }))).toMatchObject({ result: 'blocked', reason: 'inconsistent_report' })
  })
  it('empty run (no suites, all-zero stats) => blocked', () => {
    expect(verdict({ stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }, errors: [], suites: [] })).toMatchObject({ result: 'blocked', reason: 'inconsistent_report' })
  })
  it('a valid passing report still passes', () => {
    expect(verdict(report())).toMatchObject({ code: 0, result: 'pass', reason: 'ok' })
  })
  it('PROPERTY: any single mutation of a consistent passing report is never pass (deterministic seeded, 300 cases)', () => {
    let seed = 0x1d065
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    const mutations = [
      (r) => { r.stats[['expected', 'unexpected', 'flaky', 'skipped'][rnd(4)]] += 1 + rnd(3) },
      (r) => { r.stats.expected -= 1 },
      (r) => { const t = r.suites[rnd(r.suites.length)].specs[0].tests[0]; t.status = ['unexpected', 'flaky', 'skipped', 'bogus'][rnd(4)] },
      (r) => { const t = r.suites[rnd(r.suites.length)].specs[0].tests[0]; t.results[0].status = ['failed', 'timedOut', 'skipped', 'interrupted', 'x'][rnd(5)] },
      (r) => { const t = r.suites[rnd(r.suites.length)].specs[0].tests[0]; t.results = [] },
      (r) => { const t = r.suites[rnd(r.suites.length)].specs[0].tests[0]; t.results.unshift({ status: 'failed' }) },
      (r) => { r.suites.splice(rnd(r.suites.length), 1); r.stats.expected -= 1 },
      (r) => { r.suites.push({ file: 'x.spec.ts', specs: [{ file: 'x.spec.ts', tests: [t_(['unexpected', 'flaky', 'skipped'][rnd(3)], 'failed')] }] }); r.stats.expected += 1 },
      (r) => { r.errors.push({ message: 'x' }) },
      (r) => { r.suites[rnd(r.suites.length)].specs[0].tests[0].projectName = 'android' },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'prop-'))
    try {
      for (let i = 0; i < 300; i++) {
        const r = report(); mutations[i % mutations.length](r)
        const code = rnd(2) // also vary the process exit code
        writeFileSync(join(dir, 'r.json'), JSON.stringify(r))
        const s = spawnSync('node', ['scripts/summarize-e2e-report.mjs', '--raw', join(dir, 'r.json'), '--exit', String(code), '--out', join(dir, 's.json')], { encoding: 'utf8' })
        expect(s.stdout + s.stderr).toBe('')
        const res = JSON.parse(readFileSync(join(dir, 's.json'), 'utf8'))
        if (res.result === 'pass') throw new Error(`mutation ${i % mutations.length} (case ${i}, exit ${code}) produced pass`)
        expect(s.status).toBe(1)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
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
