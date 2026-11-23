#!/usr/bin/env node
// Turns a raw Playwright JSON report into an ALLOWLISTED summary: fixed enums and numbers only. No title,
// message, stack, URL, attachment, annotation or any other string from the report is ever copied out.
//
// FAIL-CLOSED VERDICT CONTRACT v1 (Owner Gate R-1, Issue #103). "pass" ONLY if ALL hold:
//  A. Shape: object; stats.{expected,unexpected,flaky,skipped} non-negative integers; errors an array;
//     suites/specs/tests/results well formed.                                          else blocked/malformed_report
//  B. Closed vocabularies: test.status in {expected,unexpected,flaky,skipped};
//     result.status in {passed,failed,timedOut,skipped,interrupted}.                   else blocked/malformed_report
//  C. Each test's outcome is derived from ITS OWN results and must agree with its status:
//       expected   = >=1 result, every result passed
//       unexpected = >=1 result, last result not passed
//       flaky      = >=2 results, last passed, at least one earlier not passed
//       skipped    = no results, or every result skipped                              else blocked/inconsistent_report
//  D. Every aggregate bucket equals the count of detailed tests in that bucket; >=1 test. else blocked/inconsistent_report
//  E. Whole report (not only mandatory tests): no top-level error, no unexpected, no flaky, NO SKIPS.
//  F. Every mandatory (spec, project) has >=1 test and all its tests are expected.     else fail/coverage_incomplete
//  G. Process agreement: a report with an error or unexpected test requires a non-zero exit; a report with no
//     error and no unexpected test requires exit 0. Disagreement                       => blocked/inconsistent_report
// Details decide; the aggregate is only a consistency check. Nothing is written to stdout/stderr; any internal
// failure yields the fixed blocked/internal_error summary (the wrapper also captures this script's streams).
//
//  H. Coverage is FIXED: the mandatory matrix is the constants below (4 specs x desktop, iphone) and cannot be
//     replaced or narrowed by any argument. Only --raw, --exit and --out are accepted; any other argument, a
//     repeated option, a missing value or a stray token => blocked/invalid_arguments. No caller-supplied string
//     (spec, project or argument value) is ever copied into the summary; coverage uses only the fixed constants.
//
// usage: summarize-e2e-report.mjs --raw <file> --exit <code> --out <file>
import { readFileSync, writeFileSync } from 'node:fs'

const MANDATORY_SPECS = Object.freeze(['auth-isolation-staging.spec.ts', 'documents-staging.spec.ts', 'preview-smoke.spec.ts', 'preview-context-sentinel.spec.ts'])
const MANDATORY_PROJECTS = Object.freeze(['desktop', 'iphone'])
const ALLOWED_ARGS = new Set(['raw', 'exit', 'out'])
const BUCKETS = ['expected', 'unexpected', 'flaky', 'skipped']
const TEST_STATUS = new Set(BUCKETS)
const RESULT_STATUS = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted'])
const REASONS = new Set(['ok', 'invalid_arguments', 'invalid_exit_code', 'no_report', 'unparseable_report', 'malformed_report', 'inconsistent_report', 'top_level_errors', 'test_failures', 'flaky_tests', 'skipped_tests', 'coverage_incomplete', 'internal_error'])

// Strict parser: exactly --name value pairs from the allowlist, each option at most once.
// Returns null when the argument vector is not exactly that shape.
function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (typeof flag !== 'string' || !flag.startsWith('--')) return null
    const name = flag.slice(2)
    if (!ALLOWED_ARGS.has(name) || Object.prototype.hasOwnProperty.call(parsed, name)) return null
    if (value === undefined || value.startsWith('--')) return null
    parsed[name] = value
  }
  return parsed
}

const argv = process.argv.slice(2)
const parsedArgs = parseArgs(argv)
const args = parsedArgs ?? {}
// When the argument vector is rejected we still publish a BLOCKED summary to the --out path, if one was given.
const outFile = parsedArgs ? parsedArgs.out : (argv.indexOf('--out') >= 0 ? argv[argv.indexOf('--out') + 1] : undefined)

function emit(result, reason, extra = {}) {
  const exitCode = /^-?\d+$/.test(String(args.exit ?? '')) ? Number(args.exit) : null
  const summary = { result, reason: REASONS.has(reason) ? reason : 'internal_error', exit_code: exitCode, ...extra }
  try { writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n') } catch { process.exit(2) }
  process.exit(result === 'pass' ? 0 : 1)
}
class Reject extends Error { constructor(reason) { super(reason); this.reason = reason } }
const malformed = () => { throw new Reject('malformed_report') }
const inconsistent = () => { throw new Reject('inconsistent_report') }
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isCount = (v) => Number.isInteger(v) && v >= 0

// C. outcome from the test's own results; must equal its declared status.
function classify(t) {
  const rs = t.results.map((r) => r.status)
  const last = rs[rs.length - 1]
  let derived
  if (rs.length === 0 || rs.every((s) => s === 'skipped')) derived = 'skipped'
  else if (rs.every((s) => s === 'passed')) derived = 'expected'
  else if (last !== 'passed') derived = 'unexpected'
  else derived = 'flaky' // >=2 results, last passed, some earlier not passed
  if (derived !== t.status) inconsistent()
  return derived
}

function main() {
  if (!outFile) process.exit(2)
  if (parsedArgs === null) return emit('blocked', 'invalid_arguments')
  // H. the mandatory matrix is fixed; it is never taken from the command line.
  const specs = MANDATORY_SPECS
  const projects = MANDATORY_PROJECTS
  if (!/^-?\d+$/.test(String(args.exit ?? ''))) return emit('blocked', 'invalid_exit_code')
  const exitCode = Number(args.exit)

  let raw = ''
  try { raw = readFileSync(args.raw, 'utf8') } catch { raw = '' }
  if (!raw.trim()) return emit('blocked', 'no_report')
  let report
  try { report = JSON.parse(raw) } catch { return emit('blocked', 'unparseable_report') }

  // A. shape
  if (!isObj(report) || !isObj(report.stats) || !Array.isArray(report.errors) || !Array.isArray(report.suites)) return emit('blocked', 'malformed_report')
  for (const k of BUCKETS) if (!isCount(report.stats[k])) return emit('blocked', 'malformed_report')
  const stats = { expected: report.stats.expected, unexpected: report.stats.unexpected, flaky: report.stats.flaky, skipped: report.stats.skipped }

  const detail = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  const tally = new Map() // `${file}|${project}` -> { passed, other }
  const walk = (suite, depth) => {
    if (!isObj(suite) || depth > 20) malformed()
    if (suite.specs !== undefined && !Array.isArray(suite.specs)) malformed()
    if (suite.suites !== undefined && !Array.isArray(suite.suites)) malformed()
    for (const sp of suite.specs || []) {
      if (!isObj(sp) || !Array.isArray(sp.tests)) malformed()
      const fileRaw = typeof sp.file === 'string' ? sp.file : typeof suite.file === 'string' ? suite.file : malformed()
      const file = fileRaw.split(/[\\/]/).pop()
      for (const t of sp.tests) {
        // A + B. shape and closed vocabularies
        if (!isObj(t) || typeof t.projectName !== 'string' || !TEST_STATUS.has(t.status) || !Array.isArray(t.results)) malformed()
        for (const r of t.results) if (!isObj(r) || !RESULT_STATUS.has(r.status)) malformed()
        const outcome = classify(t) // C
        detail[outcome]++
        const key = `${file}|${t.projectName}`
        const cur = tally.get(key) || { passed: 0, other: 0 }
        if (outcome === 'expected') cur.passed++; else cur.other++
        tally.set(key, cur)
      }
    }
    for (const s of suite.suites || []) walk(s, depth + 1)
  }
  try { for (const s of report.suites) walk(s, 0) } catch (e) { if (e instanceof Reject) return emit('blocked', e.reason); throw e }

  // D. every bucket reconciles; at least one test
  for (const k of BUCKETS) if (stats[k] !== detail[k]) return emit('blocked', 'inconsistent_report')
  const total = BUCKETS.reduce((n, k) => n + detail[k], 0)
  if (total < 1) return emit('blocked', 'inconsistent_report')

  const coverage = []
  let covered = true
  for (const sp of specs) for (const pr of projects) {
    const c = tally.get(`${sp}|${pr}`) || { passed: 0, other: 0 }
    coverage.push({ spec: sp, project: pr, passed: c.passed, not_passed: c.other })
    if (c.passed < 1 || c.other > 0) covered = false
  }
  const out = (result, reason) => emit(result, reason, { stats: detail, coverage })

  // G. process agreement
  const hardFailure = report.errors.length > 0 || detail.unexpected > 0
  if (hardFailure && exitCode === 0) return out('blocked', 'inconsistent_report')
  if (!hardFailure && exitCode !== 0) return out('blocked', 'inconsistent_report')

  // E. whole-report outcome (no skips)
  if (report.errors.length > 0) return out('fail', 'top_level_errors')
  if (detail.unexpected > 0) return out('fail', 'test_failures')
  if (detail.flaky > 0) return out('fail', 'flaky_tests')
  if (detail.skipped > 0) return out('fail', 'skipped_tests')
  // F. mandatory coverage
  if (!covered) return out('fail', 'coverage_incomplete')
  return out('pass', 'ok')
}

try { main() } catch { try { emit('blocked', 'internal_error') } catch { process.exit(2) } }
