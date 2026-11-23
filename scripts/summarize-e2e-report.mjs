#!/usr/bin/env node
// Turns a raw Playwright JSON report into an ALLOWLISTED summary: fixed enums and numbers only. No title,
// message, stack, URL, attachment, annotation or any other string from the report is ever copied out.
// STRICT: every field that decides PASS must be present with the exact expected type. A missing, mistyped or
// malformed field never counts as zero or empty: it yields a fixed BLOCKED summary (reason malformed_report).
// "pass" requires ALL of: exit code 0; stats.{expected,unexpected,flaky,skipped} non-negative integers;
// errors an array and empty; every suite/spec/test/result well formed; stats equal the tests actually found;
// no failed/flaky test; every mandatory (spec, project) pair present with >=1 passed test and none otherwise.
// Nothing is ever written to stdout/stderr by this script; any internal failure produces the fixed BLOCKED
// summary (and the wrapper also captures its streams privately).
//
// usage: summarize-e2e-report.mjs --raw <file> --exit <code> --out <file> [--specs a,b] [--projects x,y]
import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT_SPECS = ['auth-isolation-staging.spec.ts', 'documents-staging.spec.ts', 'preview-smoke.spec.ts', 'preview-context-sentinel.spec.ts']
const DEFAULT_PROJECTS = ['desktop', 'iphone']
const REASONS = new Set(['ok', 'invalid_exit_code', 'no_report', 'unparseable_report', 'malformed_report', 'top_level_errors', 'test_failures', 'flaky_tests', 'coverage_incomplete', 'nonzero_exit', 'internal_error'])

const argv = process.argv.slice(2)
const args = {}
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]
const outFile = args.out

function emit(result, reason, extra = {}) {
  const exitCode = /^-?\d+$/.test(String(args.exit ?? '')) ? Number(args.exit) : null
  const summary = { result, reason: REASONS.has(reason) ? reason : 'internal_error', exit_code: exitCode, ...extra }
  try { writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n') } catch { process.exit(2) }
  process.exit(result === 'pass' ? 0 : 1)
}
class Malformed extends Error {}
const bad = () => { throw new Malformed() }
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isCount = (v) => Number.isInteger(v) && v >= 0

function main() {
  if (!outFile) process.exit(2)
  const specs = (args.specs ? args.specs.split(',') : DEFAULT_SPECS).filter(Boolean)
  const projects = (args.projects ? args.projects.split(',') : DEFAULT_PROJECTS).filter(Boolean)
  if (!/^-?\d+$/.test(String(args.exit ?? ''))) return emit('blocked', 'invalid_exit_code')

  let raw = ''
  try { raw = readFileSync(args.raw, 'utf8') } catch { raw = '' }
  if (!raw.trim()) return emit('blocked', 'no_report')
  let report
  try { report = JSON.parse(raw) } catch { return emit('blocked', 'unparseable_report') }

  // ---- strict schema ----
  if (!isObj(report) || !isObj(report.stats) || !Array.isArray(report.errors) || !Array.isArray(report.suites)) return emit('blocked', 'malformed_report')
  const st = report.stats
  for (const k of ['expected', 'unexpected', 'flaky', 'skipped']) if (!isCount(st[k])) return emit('blocked', 'malformed_report')
  const stats = { expected: st.expected, unexpected: st.unexpected, flaky: st.flaky, skipped: st.skipped }

  const tally = new Map() // `${file}|${project}` -> { passed, other }
  let totalTests = 0
  const walk = (suite, depth) => {
    if (!isObj(suite) || depth > 20) bad()
    if (suite.specs !== undefined && !Array.isArray(suite.specs)) bad()
    if (suite.suites !== undefined && !Array.isArray(suite.suites)) bad()
    for (const sp of suite.specs || []) {
      if (!isObj(sp) || !Array.isArray(sp.tests)) bad()
      const fileRaw = typeof sp.file === 'string' ? sp.file : typeof suite.file === 'string' ? suite.file : bad()
      const file = fileRaw.split(/[\\/]/).pop()
      for (const t of sp.tests) {
        if (!isObj(t) || typeof t.projectName !== 'string' || typeof t.status !== 'string' || !Array.isArray(t.results)) bad()
        for (const r of t.results) if (!isObj(r) || typeof r.status !== 'string') bad()
        const key = `${file}|${t.projectName}`
        const cur = tally.get(key) || { passed: 0, other: 0 }
        const last = t.results[t.results.length - 1]
        if (t.status === 'expected' && last && last.status === 'passed') cur.passed++; else cur.other++
        tally.set(key, cur); totalTests++
      }
    }
    for (const s of suite.suites || []) walk(s, depth + 1)
  }
  try { for (const s of report.suites) walk(s, 0) } catch (e) { if (e instanceof Malformed) return emit('blocked', 'malformed_report'); throw e }
  if (totalTests !== stats.expected + stats.unexpected + stats.flaky + stats.skipped) return emit('blocked', 'malformed_report')

  // ---- verdict ----
  const coverage = []
  let covered = true
  for (const sp of specs) for (const pr of projects) {
    const c = tally.get(`${sp}|${pr}`) || { passed: 0, other: 0 }
    coverage.push({ spec: sp, project: pr, passed: c.passed, not_passed: c.other })
    if (c.passed < 1 || c.other > 0) covered = false
  }
  const out = (result, reason) => emit(result, reason, { stats, coverage })
  if (report.errors.length > 0) return out('fail', 'top_level_errors')
  if (stats.unexpected > 0) return out('fail', 'test_failures')
  if (stats.flaky > 0) return out('fail', 'flaky_tests')
  if (!covered) return out('fail', 'coverage_incomplete')
  if (Number(args.exit) !== 0) return out('fail', 'nonzero_exit')
  return out('pass', 'ok')
}

try { main() } catch { try { emit('blocked', 'internal_error') } catch { process.exit(2) } }
