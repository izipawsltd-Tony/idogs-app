#!/usr/bin/env node
// Turns a raw Playwright JSON report into an ALLOWLISTED summary: fixed enums and numbers only. No title,
// message, stack, URL, attachment, annotation or any other string from the report is ever copied out.
// "pass" requires ALL of: exit code 0, a parseable well-formed report, no top-level errors, no failed or
// flaky test, and every mandatory (spec, project) pair present with at least one passed test and none skipped.
//
// usage: summarize-e2e-report.mjs --raw <file> --exit <code> --out <file> [--specs a.spec.ts,b.spec.ts] [--projects desktop,iphone]
import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT_SPECS = ['auth-isolation-staging.spec.ts', 'documents-staging.spec.ts', 'preview-smoke.spec.ts', 'preview-context-sentinel.spec.ts']
const DEFAULT_PROJECTS = ['desktop', 'iphone']

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []))
const specs = (args.specs ? args.specs.split(',') : DEFAULT_SPECS).filter(Boolean)
const projects = (args.projects ? args.projects.split(',') : DEFAULT_PROJECTS).filter(Boolean)

function write(summary) {
  writeFileSync(args.out, JSON.stringify(summary, null, 2) + '\n')
  process.exit(summary.result === 'pass' ? 0 : 1)
}
const base = (result, reason, extra = {}) => ({ result, reason, exit_code: Number.isInteger(+args.exit) ? +args.exit : null, ...extra })

if (!args.out) { process.stderr.write('missing --out\n'); process.exit(2) }
if (!Number.isInteger(+args.exit) || args.exit === undefined || args.exit === '') write(base('blocked', 'invalid_exit_code'))

let raw
try { raw = readFileSync(args.raw, 'utf8') } catch { raw = '' }
if (!raw.trim()) write(base('blocked', 'no_report'))

let report
try { report = JSON.parse(raw) } catch { write(base('blocked', 'unparseable_report')) }
if (!report || typeof report !== 'object' || !report.stats || !Array.isArray(report.suites)) write(base('blocked', 'malformed_report'))

const n = (v) => (Number.isFinite(v) ? v : 0)
const stats = { expected: n(report.stats.expected), unexpected: n(report.stats.unexpected), flaky: n(report.stats.flaky), skipped: n(report.stats.skipped) }

// tally[spec|project] = { passed, other }
const tally = new Map()
const walk = (suite) => {
  for (const sp of suite.specs || []) {
    const file = String(sp.file || suite.file || '').split(/[\\/]/).pop()
    for (const t of sp.tests || []) {
      const key = `${file}|${t.projectName}`
      const cur = tally.get(key) || { passed: 0, other: 0 }
      const results = Array.isArray(t.results) ? t.results : []
      const last = results[results.length - 1]
      if (t.status === 'expected' && last && last.status === 'passed') cur.passed++; else cur.other++
      tally.set(key, cur)
    }
  }
  for (const s of suite.suites || []) walk(s)
}
for (const s of report.suites) walk(s)

const coverage = []
let covered = true
for (const sp of specs) for (const pr of projects) {
  const c = tally.get(`${sp}|${pr}`) || { passed: 0, other: 0 }
  coverage.push({ spec: sp, project: pr, passed: c.passed, not_passed: c.other })
  if (c.passed < 1 || c.other > 0) covered = false
}

const out = (result, reason) => write(base(result, reason, { stats, coverage }))
if (Array.isArray(report.errors) && report.errors.length > 0) out('fail', 'top_level_errors')
if (stats.unexpected > 0) out('fail', 'test_failures')
if (stats.flaky > 0) out('fail', 'flaky_tests')
if (!covered) out('fail', 'coverage_incomplete')
if (+args.exit !== 0) out('fail', 'nonzero_exit')
out('pass', 'ok')
