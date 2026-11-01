// Integration regression (coordinator review, Milestone 04): repeated and
// concurrent reporter invocations must ALWAYS update the dashboard comment on
// the fixed control issue #69 and NEVER create a new Issue.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main, _setTransport } from './update-issue.mjs'

const REPO = 'izipawsltd-Tony/idogs-app'
const realConfig = JSON.parse(readFileSync(new URL('../../.github/release-control.json', import.meta.url), 'utf8'))

function fakeGitHub({ issueState = 'open', checksConclusion = () => 'success' } = {}) {
  const gh = { issues: { 69: { number: 69, state: issueState, user: { login: 'izipawsltd-Tony' }, labels: [{ name: 'release-control' }] } }, comments: [], writes: [], nextId: 1000 }
  gh.transport = async (path, { method = 'GET', body } = {}) => {
    await new Promise(r => setTimeout(r, Math.random() * 5)) // interleave concurrent callers
    if (method !== 'GET') gh.writes.push({ method, path })
    let m
    if (method === 'POST' && /\/issues$/.test(path)) throw new Error('TEST FAIL: attempted to create an Issue')
    if ((m = /\/issues\/(\d+)$/.exec(path)) && method === 'GET') return gh.issues[m[1]] || null
    if ((m = /\/issues\/(\d+)\/comments\?/.exec(path)) && method === 'GET') return m[1] === '69' ? gh.comments.filter(c => c.issue === 69) : []
    if ((m = /\/issues\/(\d+)\/comments$/.exec(path)) && method === 'POST') {
      const c = { id: gh.nextId++, issue: Number(m[1]), user: { login: 'github-actions[bot]' }, body: body.body }
      gh.comments.push(c); return c
    }
    if ((m = /\/issues\/comments\/(\d+)$/.exec(path)) && method === 'PATCH') {
      const c = gh.comments.find(x => x.id === Number(m[1]))
      if (!c || c.user.login !== 'github-actions[bot]') throw new Error('403')
      c.body = body.body; return c
    }
    if ((m = /\/pulls\/(\d+)$/.exec(path))) return { title: `PR ${m[1]}`, state: 'open', draft: true, head: { sha: `sha${m[1]}000000`, ref: 'claude/x' }, base: { ref: 'base' }, mergeable_state: 'clean' }
    if (/\/check-runs\?/.test(path)) return { check_runs: [{ name: 'Typecheck, tests, build', status: 'completed', conclusion: checksConclusion(), started_at: '2026-11-01T00:00:00Z', html_url: 'https://github.com/x' }] }
    if (/\/statuses\?/.test(path)) return [{ context: 'Vercel – idogs-app-staging', state: 'success' }]
    if (/\/deployments\?/.test(path)) return []
    if (/\/actions\/workflows\/.+\/runs\?/.test(path)) return { workflow_runs: [] }
    throw new Error(`unexpected ${method} ${path}`)
  }
  return gh
}

function rootWith(config) {
  const dir = mkdtempSync(join(tmpdir(), 'rc-'))
  mkdirSync(join(dir, '.github'), { recursive: true })
  writeFileSync(join(dir, '.github/release-control.json'), JSON.stringify(config))
  return dir
}
const env = { GITHUB_TOKEN: 'test-token', GITHUB_REPOSITORY: REPO, GITHUB_ACTIONS: 'true' }
const run = (root) => main({ argv: [], env, root })
const issueCreates = gh => gh.writes.filter(w => w.method === 'POST' && /\/issues$/.test(w.path)).length
const dashboards = gh => gh.comments.filter(c => c.body.startsWith('<!-- release-control:dashboard -->'))

afterEach(() => _setTransport(null))

describe('release-control against fixed issue #69', () => {
  it('uses the committed config: fixed issue #69', () => { expect(realConfig.issueNumber).toBe(69) })

  it('repeated invocations edit ONE dashboard on #69 and never create an Issue', async () => {
    let state = 'success'
    const gh = fakeGitHub({ checksConclusion: () => state }); _setTransport(gh.transport)
    const root = rootWith(realConfig)
    expect((await run(root)).issue).toBe(69)
    expect((await run(root)).changed).toBe(false) // unchanged state → no write
    state = 'failure'; await run(root)
    state = 'success'; await run(root)
    expect(issueCreates(gh)).toBe(0)
    expect(dashboards(gh)).toHaveLength(1)
    expect(gh.writes.every(w => w.path.includes('/issues/69/') || /\/issues\/comments\/\d+$/.test(w.path))).toBe(true)
    expect(gh.comments.filter(c => c.body.startsWith('State changed'))).toHaveLength(2)
  })

  it('concurrent invocations converge on the same dashboard comment', async () => {
    let state = 'success'
    const gh = fakeGitHub({ checksConclusion: () => state }); _setTransport(gh.transport)
    const root = rootWith(realConfig)
    await run(root) // dashboard exists
    state = 'failure'
    await Promise.all(Array.from({ length: 6 }, () => run(root)))
    expect(issueCreates(gh)).toBe(0)
    expect(dashboards(gh)).toHaveLength(1)
  })

  it('fails closed (no writes) when #69 is closed', async () => {
    const gh = fakeGitHub({ issueState: 'closed' }); _setTransport(gh.transport)
    await expect(run(rootWith(realConfig))).rejects.toThrow(/refusing to create another/)
    expect(gh.writes).toHaveLength(0)
  })

  it('fails closed when the config has no fixed issue number', async () => {
    const gh = fakeGitHub(); _setTransport(gh.transport)
    const { issueNumber, ...noNumber } = realConfig
    await expect(run(rootWith(noNumber))).rejects.toThrow(/fixed issueNumber/)
    expect(gh.writes).toHaveLength(0)
  })

  it('refuses an issue that is neither Owner-opened nor labelled', async () => {
    const gh = fakeGitHub(); gh.issues[69].user.login = 'stranger'; gh.issues[69].labels = []; _setTransport(gh.transport)
    await expect(run(rootWith(realConfig))).rejects.toThrow(/not trusted/)
    expect(gh.writes).toHaveLength(0)
  })
})
