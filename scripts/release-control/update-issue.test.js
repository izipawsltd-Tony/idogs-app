import { describe, expect, it } from 'vitest'
import { sanitize, summariseChecks, lineReadiness, fingerprint, renderBody, isMetaCheck, findDashboardComment } from './update-issue.mjs'

const pr = (over = {}) => ({ number: 67, found: true, title: 't', state: 'open', draft: true, headRef: 'claude/x', baseRef: 'b', headSha: 'abcdef1234', mergeable: 'clean', checks: { items: [], overall: 'success', failing: [] }, preview: { state: 'success', url: null }, ...over })
const gates = [{ id: 'G3', status: 'pending' }, { id: 'G3P', status: 'pending' }, { id: 'G4', status: 'pending' }, { id: 'G5', status: 'pending' }, { id: 'G6', status: 'pending' }, { id: 'G7', status: 'pending' }]

describe('release-control', () => {
  it('neutralises untrusted text (mentions, html, tables, links)', () => {
    const s = sanitize('@owner <img src=x> | [click](http://evil) `rm -rf`')
    expect(s).not.toMatch(/@owner|<|>|\||\[|`/)
    expect(s).toContain('@​owner')
    expect(sanitize('x'.repeat(500)).length).toBe(120)
  })
  it('latest re-run of a check supersedes the failed attempt', () => {
    const r = summariseChecks([
      { name: 'build', status: 'completed', conclusion: 'failure', started_at: '2026-11-01T01:00:00Z' },
      { name: 'build', status: 'completed', conclusion: 'success', started_at: '2026-11-01T02:00:00Z' },
      { name: 'e2e', status: 'in_progress', started_at: '2026-11-01T02:00:00Z' },
    ])
    expect(r.items.find(i => i.name === 'build').state).toBe('success')
    expect(r.overall).toBe('pending')
  })
  it('reports failing checks as blockers and does not claim readiness', () => {
    const r = lineReadiness({ kind: 'web', gates, prs: [pr({ checks: { items: [], overall: 'failure', failing: ['verify'] } })] })
    expect(r.ciGreen).toBe(false); expect(r.stage).toBe('BUILDING / FIXING')
    expect(r.blockers[0]).toContain('CI failing: verify')
  })
  it('web line waits on G3 when CI is green', () => {
    expect(lineReadiness({ kind: 'web', gates, prs: [pr()] }).stage).toContain('G3')
  })
  it('iOS line tracks TestFlight separately from web', () => {
    expect(lineReadiness({ kind: 'ios', gates, prs: [pr()], testflight: { latest: null } }).stage).toContain('G4')
    const tf = { latest: { buildNumber: 101, state: 'success' } }
    expect(lineReadiness({ kind: 'ios', gates, prs: [pr()], testflight: tf }).stage).toContain('awaiting iPhone QA (G5)')
  })
  it('fingerprint changes only when state changes', () => {
    const m = s => ({ gates, lines: { web: { prs: [pr({ checks: { items: [], overall: s, failing: [] } })], readiness: { stage: s, blockers: [] } } } })
    expect(fingerprint(m('success'))).toBe(fingerprint(m('success')))
    expect(fingerprint(m('success'))).not.toBe(fingerprint(m('failure')))
  })
  it('renders gates and never includes a token-like value', () => {
    const body = renderBody({ repo: 'o/r', fingerprint: 'abc', generatedAt: 'now', event: '', milestones: ['m.md'], milestonesDir: 'docs', reportsRef: 'main', gates: [{ id: 'G4', name: 'TestFlight', status: 'pending', note: 'n' }], lines: { ios: { label: 'iOS', prs: [pr()], testflight: { latest: null }, readiness: { stage: 's', blockers: [] } } } })
    expect(body.startsWith('<!-- release-control:dashboard -->')).toBe(true); expect(body).toContain('release-control:fingerprint:abc'); expect(body).toContain('| G4 |')
    expect(body).not.toMatch(/gh[ps]_[A-Za-z0-9]{20,}/)
  })
  it('ignores automation meta-jobs when judging CI', () => {
    expect(isMetaCheck('release-control / Update release-control issue')).toBe(true)
    expect(isMetaCheck('auto-fix / Claude auto-fix (bounded)')).toBe(true)
    expect(isMetaCheck('Typecheck, tests, build')).toBe(false)
  })
  it('only edits a dashboard comment written by a trusted author', () => {
    const c = [
      { id: 1, user: { login: 'stranger' }, body: '<!-- release-control:dashboard --> fake' },
      { id: 2, user: { login: 'github-actions[bot]' }, body: '<!-- release-control:dashboard --> real' },
      { id: 3, user: { login: 'github-actions[bot]' }, body: 'no marker' },
    ]
    expect(findDashboardComment(c, ['github-actions[bot]']).id).toBe(2)
    expect(findDashboardComment([c[0]], ['github-actions[bot]'])).toBeNull()
  })
})
