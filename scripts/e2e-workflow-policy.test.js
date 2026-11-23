import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const wf = readFileSync('.github/workflows/preview-e2e-auth.yml', 'utf8')
const steps = wf.split(/\n      - name: /).slice(1)
const step = (needle) => steps.find((s) => s.startsWith(needle)) ?? ''
const code = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

describe('preview-e2e-auth.yml policy (static)', () => {
  it('is manual-only and never pins trusted code to a mutable branch', () => {
    expect(code).toMatch(/on:\n {2}workflow_dispatch:/)
    expect(code).not.toMatch(/\n\s+(push|pull_request|deployment_status|schedule):/)
    expect(code).not.toMatch(/ref:\s*master/)
    expect((code.match(/ref: \$\{\{ github\.sha \}\}/g) || []).length).toBe(2)
  })
  it('the no-secret verify job is a preflight and never sees the Vercel token or E2E secrets', () => {
    const verifyJob = code.slice(code.indexOf('  verify:'), code.indexOf('  e2e:'))
    expect(verifyJob).toMatch(/MODE: preflight/)
    expect(verifyJob).not.toMatch(/secrets\./)
  })
  it('authoritative binding runs in bind mode twice, before and immediately before the credentialed step, and compares tuples', () => {
    const b1 = step('Authoritative binding #1'), b2 = step('Authoritative binding #2')
    for (const b of [b1, b2]) { expect(b).toMatch(/MODE: bind/); expect(b).toMatch(/VERCEL_READONLY_TOKEN: \$\{\{ secrets\.VERCEL_READONLY_TOKEN \}\}/); expect(b).not.toMatch(/E2E_STAGING|BYPASS/) }
    expect(b2).toMatch(/EXPECTED_TUPLE/)
    const order = steps.map((s) => s.split('\n')[0])
    expect(order.findIndex((n) => n.startsWith('Authoritative binding #2'))).toBe(order.findIndex((n) => n.startsWith('Run Playwright via trusted wrapper')) - 1)
  })
  it('E2E credentials appear only in the credentialed run step', () => {
    for (const s of steps) {
      const name = s.split('\n')[0]
      const hasCred = /secrets\.(E2E_STAGING|VERCEL_AUTOMATION)/.test(s)
      expect(hasCred).toBe(name.startsWith('Run Playwright via trusted wrapper'))
    }
  })
  it('only the allowlisted summary is uploaded', () => {
    expect(step('Upload allowlisted summary only')).toMatch(/e2e-summary\/summary\.json/)
    expect(code).not.toMatch(/playwright-report|test-results|trace/)
  })
})
