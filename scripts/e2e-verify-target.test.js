import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Drives scripts/verify-e2e-target.sh with a fake `gh` that serves JSON fixtures (no network, no credentials).
const SHA = 'a'.repeat(40)
const URL_OK = 'https://idogs-app-staging-abc123-izipawsltd-tonys-projects.vercel.app'
const DASH = (id) => `https://vercel.com/izipawsltd-tonys-projects/idogs-app-staging/${id}`
const BOT = { login: 'vercel[bot]' }

const base = () => ({
  compare: { files: [{ filename: 'e2e/x.ts' }, { filename: 'src/a.tsx' }] },
  deployments: [{ id: 11, environment: 'Preview – idogs-app-staging', creator: BOT, sha: SHA, task: 'deploy', created_at: '2026-11-23T04:15:16Z' }],
  depStatuses: [{ state: 'success', creator: BOT, created_at: '2026-11-23T04:15:16Z', environment_url: URL_OK }],
  commitStatuses: [
    { context: 'Vercel – idogs-app-staging', state: 'success', creator: BOT, created_at: '2026-11-23T04:15:15Z', target_url: DASH('DPL1') },
    { context: 'Vercel – idogs-app-staging', state: 'pending', creator: BOT, created_at: '2026-11-23T04:11:50Z', target_url: DASH('DPL1') },
    { context: 'Vercel – idogs-app', state: 'success', creator: BOT, created_at: '2026-11-23T04:11:52Z', target_url: 'https://vercel.com/izipawsltd-tonys-projects/idogs-app/OTHER' },
  ],
  runs: { workflow_runs: [{ path: '.github/workflows/ci.yml', event: 'push', head_sha: SHA, conclusion: 'success', name: 'iDogs CI' }] },
})

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'verify-target-test-'))
  writeFileSync(join(dir, 'gh'), `#!/usr/bin/env bash
# fake gh: gh api <endpoint>
ep="$2"
case "$ep" in
  *compare/*) cat "$FIX/compare.json" ;;
  *deployments/*/statuses*) cat "$FIX/depStatuses.json" ;;
  *deployments\\?*) cat "$FIX/deployments.json" ;;
  *commits/*/statuses*) cat "$FIX/commitStatuses.json" ;;
  *actions/runs*) cat "$FIX/runs.json" ;;
  *) echo "unexpected endpoint $ep" >&2; exit 2 ;;
esac
`)
  chmodSync(join(dir, 'gh'), 0o755)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function run(fx, env = {}) {
  for (const [k, v] of Object.entries(fx)) writeFileSync(join(dir, `${k}.json`), JSON.stringify(v))
  const r = spawnSync('bash', ['scripts/verify-e2e-target.sh'], {
    env: { PATH: `${dir}:${process.env.PATH}`, FIX: dir, GH_TOKEN: 'x', REPO: 'o/r', PROD_BASELINE: '04f0f60eedb9e6fb07273d89c190c9d770ff3e9b', SHA, PREVIEW_URL: URL_OK, APPROVED_SHA: SHA, ...env },
    encoding: 'utf8',
  })
  return { code: r.status, out: r.stdout + r.stderr }
}

describe('verify-e2e-target.sh', () => {
  it('accepts a consistent tuple and prints a stable TUPLE_ID', () => {
    const a = run(base()); const b = run(base())
    expect(a.code).toBe(0)
    expect(a.out).toMatch(/TUPLE_ID=[0-9a-f]{16}/)
    expect(a.out).toBe(b.out)
  })

  it('REGRESSION (Codex P1): two incompatible records — URL from the bot deployment, dashboard id from an unrelated, much later status — fail closed', () => {
    const fx = base()
    fx.commitStatuses = [
      { context: 'Vercel – idogs-app-staging', state: 'success', creator: BOT, created_at: '2026-11-23T09:00:00Z', target_url: DASH('UNRELATED') },
    ]
    const r = run(fx)
    expect(r.code).toBe(1); expect(r.out).toMatch(/not bound to each other/)
  })

  it('rejects commit statuses that carry two different dashboard ids', () => {
    const fx = base(); fx.commitStatuses[1].target_url = DASH('DPL2')
    expect(run(fx).out).toMatch(/one valid dashboard deployment id/)
  })

  it('rejects a commit status not posted by the Vercel integration', () => {
    const fx = base(); fx.commitStatuses[0].creator = { login: 'someone' }
    expect(run(fx).out).toMatch(/not posted by the Vercel integration/)
  })

  it('rejects a dashboard link for another project or team', () => {
    const fx = base(); fx.commitStatuses.forEach((c, i) => { if (i < 2) c.target_url = 'https://vercel.com/izipawsltd-tonys-projects/idogs-app/DPL1' })
    expect(run(fx).code).toBe(1)
    const fx2 = base(); fx2.commitStatuses.forEach((c, i) => { if (i < 2) c.target_url = 'https://vercel.com/evil-team/idogs-app-staging/DPL1' })
    expect(run(fx2).code).toBe(1)
  })

  it('rejects zero or several staging Preview deployments for the SHA', () => {
    const none = base(); none.deployments = []
    expect(run(none).out).toMatch(/exactly one bot-created/)
    const two = base(); two.deployments.push({ ...two.deployments[0], id: 12 })
    expect(run(two).out).toMatch(/exactly one bot-created/)
  })

  it('rejects a deployment not created by the bot, wrong environment or wrong SHA', () => {
    const a = base(); a.deployments[0].creator = { login: 'attacker' }; expect(run(a).code).toBe(1)
    const b = base(); b.deployments[0].environment = 'Preview – idogs-app'; expect(run(b).code).toBe(1)
    const c = base(); c.deployments[0].sha = 'b'.repeat(40); expect(run(c).code).toBe(1)
  })

  it('rejects a deployment that is not READY (latest status not success) or has a different URL', () => {
    const a = base(); a.depStatuses = [{ ...a.depStatuses[0], state: 'failure' }]; expect(run(a).out).toMatch(/not success/)
    const b = base(); b.depStatuses[0].environment_url = 'https://idogs-app-staging-zzz-izipawsltd-tonys-projects.vercel.app'
    expect(run(b).out).toMatch(/does not match the deployment/)
  })

  it('rejects a deployment status posted by someone else', () => {
    const a = base(); a.depStatuses[0].creator = { login: 'someone' }; expect(run(a).out).toMatch(/not posted by the Vercel integration/)
  })

  it('verifies CI by workflow identity, not display name', () => {
    const fake = base(); fake.runs.workflow_runs = [{ path: '.github/workflows/other.yml', event: 'push', head_sha: SHA, conclusion: 'success', name: 'iDogs CI' }]
    expect(run(fake).out).toMatch(/ci\.yml/)
    const wrongSha = base(); wrongSha.runs.workflow_runs[0].head_sha = 'b'.repeat(40); expect(run(wrongSha).code).toBe(1)
    const wrongEvent = base(); wrongEvent.runs.workflow_runs[0].event = 'workflow_dispatch'; expect(run(wrongEvent).code).toBe(1)
    const failed = base(); failed.runs.workflow_runs[0].conclusion = 'failure'; expect(run(failed).code).toBe(1)
  })

  it('rejects changed dependency manifests, an unapproved SHA, a bad URL and missing inputs', () => {
    const d = base(); d.compare.files.push({ filename: 'package-lock.json' }); expect(run(d).out).toMatch(/dependency files differ/)
    expect(run(base(), { APPROVED_SHA: 'b'.repeat(40) }).out).toMatch(/not the reviewed SHA/)
    expect(run(base(), { PREVIEW_URL: 'https://idogs-app-abc.vercel.app' }).out).toMatch(/not an idogs-app-staging Preview/)
    expect(run(base(), { APPROVED_SHA: '' }).out).toMatch(/missing required input/)
    expect(run(base(), { SHA: 'short' }).code).toBe(1)
  })

  it('fails closed when GitHub cannot be read', () => {
    const r = spawnSync('bash', ['scripts/verify-e2e-target.sh'], {
      env: { PATH: `${dir}:${process.env.PATH}`, FIX: '/nonexistent', GH_TOKEN: 'x', REPO: 'o/r', PROD_BASELINE: 'p', SHA, PREVIEW_URL: URL_OK, APPROVED_SHA: SHA }, encoding: 'utf8',
    })
    expect(r.status).not.toBe(0)
  })
})
