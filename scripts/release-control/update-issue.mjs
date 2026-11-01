#!/usr/bin/env node
// Release-control reporter: rebuilds the "iDOGS — BUILD & RELEASE CONTROL"
// GitHub Issue from GitHub's own structured data (PRs, check runs, commit
// statuses, workflow runs) plus .github/release-control.json, and posts a
// short comment only when the readiness state actually changes.
//
// Security model
// - Needs only GITHUB_TOKEN with issues:write (+ read on PRs/checks/actions).
// - Never reads Issue/PR comment bodies and never executes anything from
//   GitHub content. Free-text fields (PR titles, branch names) are treated as
//   untrusted and neutralised before rendering (no @mentions, no HTML, no links).
// - Never prints or renders secrets; the token is only sent to api.github.com.
//
// Usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/release-control/update-issue.mjs [--dry-run]
//        RC_EVENT="free text describing the trigger" (optional, sanitised)

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export const ISSUE_LABEL = 'release-control'
const API = 'https://api.github.com'

export function sanitize(value, max = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, c => (c === '<' ? '‹' : '›'))
    .replace(/[`|\[\]]/g, '')
    .replace(/@/g, '@​')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const ICON = { success: '✅', failure: '❌', cancelled: '⚪', skipped: '⏭️', pending: '🟡', in_progress: '🟡', queued: '🟡', neutral: '⚪', timed_out: '❌', action_required: '🟠', error: '❌', approved: '✅', blocked: '⛔', unknown: '❔' }
export const icon = s => ICON[s] || '❔'

// Automation jobs describe the pipeline itself; they are not product CI.
export const isMetaCheck = name => /^(release-control|auto-fix)\b|Update release-control issue|Claude auto-fix|^Preview E2E \(staging\)$/.test(String(name))

export function summariseChecks(checkRuns) {
  // Latest run per name wins (re-runs supersede earlier attempts).
  const latest = new Map()
  for (const run of checkRuns) {
    const prev = latest.get(run.name)
    if (!prev || new Date(run.started_at || 0) >= new Date(prev.started_at || 0)) latest.set(run.name, run)
  }
  const items = [...latest.values()].map(r => ({
    name: sanitize(r.name, 80),
    state: r.status === 'completed' ? (r.conclusion || 'neutral') : r.status,
    url: r.html_url,
  })).sort((a, b) => a.name.localeCompare(b.name))
  const failing = items.filter(i => ['failure', 'timed_out', 'action_required', 'error'].includes(i.state))
  const running = items.filter(i => ['queued', 'in_progress', 'pending'].includes(i.state))
  const overall = failing.length ? 'failure' : running.length ? 'pending' : items.length ? 'success' : 'unknown'
  return { items, overall, failing: failing.map(f => f.name) }
}

export function lineReadiness({ prs, gates, testflight, kind }) {
  const blockers = []
  for (const pr of prs) {
    if (!pr.found) { blockers.push(`PR #${pr.number} not found`); continue }
    if (pr.state !== 'open') blockers.push(`PR #${pr.number} is ${pr.state}`)
    if (pr.checks.overall === 'failure') blockers.push(`PR #${pr.number} CI failing: ${pr.checks.failing.join(', ')}`)
    if (pr.checks.overall === 'pending') blockers.push(`PR #${pr.number} CI running`)
    if (pr.mergeable === 'dirty') blockers.push(`PR #${pr.number} has merge conflicts`)
    if (pr.preview && pr.preview.state !== 'success') blockers.push(`PR #${pr.number} Preview ${pr.preview.state}`)
  }
  const gateIds = kind === 'ios' ? ['G4', 'G5', 'G7'] : ['G3', 'G3P', 'G6']
  const pendingGates = gates.filter(g => gateIds.includes(g.id) && g.status !== 'approved').map(g => g.id)
  const ciGreen = prs.length > 0 && prs.every(p => p.found && p.checks.overall === 'success')
  let stage
  if (!ciGreen) stage = 'BUILDING / FIXING'
  else if (kind === 'ios') {
    const tf = testflight?.latest
    if (!tf) stage = 'CI GREEN — awaiting TestFlight (G4)'
    else if (tf.state !== 'success') stage = `TestFlight build ${tf.buildNumber}: ${tf.state}`
    else if (pendingGates.includes('G5')) stage = `TestFlight build ${tf.buildNumber} uploaded — awaiting iPhone QA (G5)`
    else stage = 'iPhone QA PASS — awaiting App Store submission approval (G7)'
  } else {
    stage = pendingGates.includes('G3') ? 'CI GREEN — awaiting staging rules deploy + Staging QA (G3)'
      : pendingGates.includes('G6') ? 'Staging QA — awaiting Production approval (G6)' : 'Approved for Production'
  }
  return { stage, blockers, pendingGates, ciGreen }
}

export function fingerprint(model) {
  const parts = []
  for (const [key, line] of Object.entries(model.lines)) {
    parts.push(key, line.readiness.stage, ...line.readiness.blockers)
    for (const pr of line.prs) parts.push(pr.number, pr.headSha, pr.checks.overall, pr.preview?.state || '')
    if (line.testflight?.latest) parts.push(line.testflight.latest.buildNumber, line.testflight.latest.state)
  }
  for (const g of model.gates) parts.push(g.id, g.status)
  let h = 2166136261
  for (const ch of parts.join('|')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return h.toString(16)
}

export function renderBody(model) {
  const out = []
  out.push(`<!-- release-control:dashboard -->`, `<!-- release-control:fingerprint:${model.fingerprint} -->`)
  out.push('## 📊 Live build & release status (auto-generated)', '')
  out.push('_This comment is edited in place by `scripts/release-control/update-issue.mjs` (GitHub Actions + Claude) from GitHub data only. The issue description is the Owner charter and is never modified by automation. Comments are read by humans and are never executed automatically._', '')
  out.push(`**Last update:** ${model.generatedAt} UTC${model.event ? ` · trigger: ${model.event}` : ''}`, '')
  out.push('| Line | Stage | Open blockers |', '|---|---|---|')
  for (const line of Object.values(model.lines)) {
    out.push(`| ${line.label} | ${line.readiness.stage} | ${line.readiness.blockers.length ? line.readiness.blockers.map(b => sanitize(b, 140)).join('<br>') : '—'} |`)
  }
  out.push('')
  for (const line of Object.values(model.lines)) {
    out.push(`## ${line.label}`, '')
    for (const pr of line.prs) {
      if (!pr.found) { out.push(`- PR #${pr.number}: not found`, ''); continue }
      out.push(`### PR #${pr.number} — ${pr.title}`)
      out.push(`- ${pr.draft ? 'Draft' : 'Ready'} · \`${pr.headRef}\` → \`${pr.baseRef}\` · head \`${pr.headSha.slice(0, 7)}\` · mergeable: ${pr.mergeable}`)
      out.push(`- CI overall: ${icon(pr.checks.overall)} ${pr.checks.overall}`)
      for (const c of pr.checks.items) out.push(`  - ${icon(c.state)} ${c.name}${c.url ? ` — [log](${c.url})` : ''}`)
      if (pr.preview) out.push(`- Staging Preview: ${icon(pr.preview.state)} ${pr.preview.state}${pr.preview.url ? ` — ${pr.preview.url}` : ''} (Vercel-protected)`)
      if (pr.e2e) out.push(`- Preview E2E: ${icon(pr.e2e.state)} ${pr.e2e.state}${pr.e2e.url ? ` — [run](${pr.e2e.url})` : ''}`)
      out.push('')
    }
    if (line.testflight) {
      const tf = line.testflight.latest
      const any = line.testflight.lastAny
      out.push(`**TestFlight (current candidate):** ${tf ? `${icon(tf.state)} build ${tf.buildNumber} (${tf.state}) from \`${tf.headSha.slice(0, 7)}\` — [run](${tf.url})` : 'no signed build from the current candidate yet'}`)
      if (any && (!tf || any.url !== tf.url)) out.push(`<br>Last TestFlight workflow run overall: build ${any.buildNumber} (${any.state}) from \`${any.headSha.slice(0, 7)}\` on \`${any.branch}\` — [run](${any.url})`)
      out.push('')
    }
  }
  out.push('## Owner Gates', '', '| Gate | Description | Status | Note |', '|---|---|---|---|')
  for (const g of model.gates) out.push(`| ${g.id} | ${sanitize(g.name, 100)} | ${icon(g.status)} ${g.status} | ${sanitize(g.note, 120)} |`)
  out.push('', 'Gate status lives in `.github/release-control.json` and changes only by a reviewed commit after the Owner approves in writing.', '')
  if (model.milestones.length) {
    out.push('## Milestone reports', '')
    for (const m of model.milestones) out.push(`- [${m}](https://github.com/${model.repo}/blob/${model.reportsRef}/${model.milestonesDir}/${m})`)
    out.push('')
  }
  out.push('## Safety rails', '- Automation never deploys Production, changes Production Firebase rules, touches Stripe Live or real customer data, or submits to the App Store.', '- Auto-fix acts only on `claude/*` branches with an open PR labelled `agent:claude`, max 2 consecutive attempts per branch and 6 per day.', '- See `docs/automation/README.md`.')
  return out.join('\n')
}

async function gh(path, { token, method = 'GET', body } = {}) {
  if (process.env.RC_TRANSPORT === 'gh') {
    // Local operator mode: use the authenticated gh CLI (no token handled here).
    const args = ['api', '-X', method, '-H', 'Accept: application/vnd.github+json', path.replace(/^\//, '')]
    if (body) args.push('--input', '-')
    try {
      const out = execFileSync('gh', args, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      return out.trim() ? JSON.parse(out) : null
    } catch (err) {
      if (/HTTP 404/.test(String(err.stderr))) return null
      throw new Error(`gh api ${method} ${path} failed`)
    }
  }
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'idogs-release-control' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API ${method} ${path} → ${res.status}`)
  return res.status === 204 ? null : res.json()
}

async function collectPr(repo, number, previewContext, token) {
  const pr = await gh(`/repos/${repo}/pulls/${number}`, { token })
  if (!pr) return { number, found: false }
  const sha = pr.head.sha
  const runs = (await gh(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`, { token }))?.check_runs || []
  const statuses = (await gh(`/repos/${repo}/commits/${sha}/statuses?per_page=100`, { token })) || []
  const preview = statuses.find(s => s.context === previewContext)
  let previewUrl = null
  const deployments = (await gh(`/repos/${repo}/deployments?sha=${sha}&per_page=10`, { token })) || []
  for (const d of deployments) {
    if (!String(d.environment).includes('idogs-app-staging')) continue
    const st = (await gh(`/repos/${repo}/deployments/${d.id}/statuses?per_page=1`, { token }))?.[0]
    if (st?.environment_url && /^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(st.environment_url)) { previewUrl = st.environment_url; break }
  }
  const e2eRun = runs.filter(r => r.name === 'Preview E2E (staging)').sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0]
  return {
    number, found: true, title: sanitize(pr.title), state: pr.state, draft: pr.draft,
    headRef: sanitize(pr.head.ref, 80), baseRef: sanitize(pr.base.ref, 80), headSha: sha,
    mergeable: pr.mergeable_state || 'unknown',
    checks: summariseChecks(runs.filter(r => !isMetaCheck(r.name))),
    preview: preview ? { state: preview.state, url: previewUrl } : null,
    e2e: e2eRun ? { state: e2eRun.status === 'completed' ? e2eRun.conclusion : e2eRun.status, url: e2eRun.html_url } : null,
  }
}

async function collectTestflight(repo, workflowFile, candidateShas, token) {
  if (!/^[\w.-]+\.ya?ml$/.test(workflowFile)) throw new Error('bad workflow file')
  const runs = (await gh(`/repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=20`, { token }))?.workflow_runs || []
  const shape = run => run && ({ buildNumber: run.run_number, state: run.status === 'completed' ? run.conclusion : run.status, headSha: run.head_sha, branch: sanitize(run.head_branch, 80), url: run.html_url })
  // Only a build made from the current iOS candidate counts toward readiness.
  return { latest: shape(runs.find(r => candidateShas.includes(r.head_sha))) || null, lastAny: shape(runs[0]) || null }
}

export async function findControlIssue(repo, config, token) {
  const owner = repo.split('/')[0]
  if (config.issueNumber) {
    const issue = await gh(`/repos/${repo}/issues/${Number(config.issueNumber)}`, { token })
    // Only accept the configured issue if the repository owner opened it or it
    // carries the release-control label (labels need triage rights).
    if (issue && !issue.pull_request && issue.state === 'open' &&
        (issue.user?.login === owner || (issue.labels || []).some(l => l.name === ISSUE_LABEL))) return issue
    throw new Error(`Configured control issue #${config.issueNumber} is missing, closed or not trusted`)
  }
  const issues = (await gh(`/repos/${repo}/issues?state=open&labels=${ISSUE_LABEL}&per_page=50`, { token })) || []
  return issues.find(i => !i.pull_request && i.title === config.issueTitle) || null
}

export function findDashboardComment(comments, trustedAuthors) {
  const mine = comments.filter(c => trustedAuthors.includes(c.user?.login) && String(c.body || '').startsWith('<!-- release-control:dashboard -->'))
  return mine[mine.length - 1] || null
}

export async function main({ argv = process.argv.slice(2), env = process.env, root = process.cwd() } = {}) {
  const dryRun = argv.includes('--dry-run')
  const token = env.GITHUB_TOKEN || (env.RC_TRANSPORT === 'gh' ? 'gh-cli' : '')
  const repo = env.GITHUB_REPOSITORY
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required')
  const config = JSON.parse(readFileSync(join(root, '.github/release-control.json'), 'utf8'))
  const model = { repo, gates: config.gates, lines: {}, generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16), event: env.RC_EVENT ? sanitize(env.RC_EVENT, 160) : '', milestonesDir: config.milestonesDir, reportsRef: sanitize(env.RC_REPORTS_REF || 'claude/automation-20261101', 80) }
  const dir = join(root, config.milestonesDir)
  model.milestones = existsSync(dir) ? readdirSync(dir).filter(f => /^[\w.-]+\.md$/.test(f)).sort() : []
  for (const [key, line] of Object.entries(config.lines)) {
    const prs = []
    for (const n of line.pullRequests) prs.push(await collectPr(repo, n, line.previewContext, token))
    const testflight = line.testflightWorkflowFile ? await collectTestflight(repo, line.testflightWorkflowFile, prs.filter(p => p.found).map(p => p.headSha), token) : null
    model.lines[key] = { label: line.label, prs, testflight, readiness: lineReadiness({ prs, gates: config.gates, testflight, kind: key }) }
  }
  model.fingerprint = fingerprint(model)
  const body = renderBody(model)
  if (dryRun) { process.stdout.write(body + '\n'); return { changed: null } }
  let issue = await findControlIssue(repo, config, token)
  if (!issue) {
    issue = await gh(`/repos/${repo}/issues`, { token, method: 'POST', body: { title: config.issueTitle, body: 'Build & release control. Live status is maintained in the comments below.', labels: [ISSUE_LABEL] } })
    console.log(`Created control issue #${issue.number}`)
  }
  const comments = []
  for (let page = 1; page <= 10; page++) {
    const batch = (await gh(`/repos/${repo}/issues/${issue.number}/comments?per_page=100&page=${page}`, { token })) || []
    comments.push(...batch)
    if (batch.length < 100) break
  }
  const dashboard = findDashboardComment(comments, config.trustedDashboardAuthors || ['github-actions[bot]'])
  const previous = dashboard && /release-control:fingerprint:([0-9a-f]+)/.exec(dashboard.body)?.[1]
  if (previous === model.fingerprint) { console.log(`Issue #${issue.number}: no state change`); return { changed: false, issue: issue.number } }
  let updated = false
  if (dashboard) {
    try { await gh(`/repos/${repo}/issues/comments/${dashboard.id}`, { token, method: 'PATCH', body: { body } }); updated = true } catch { updated = false }
  }
  if (!updated) await gh(`/repos/${repo}/issues/${issue.number}/comments`, { token, method: 'POST', body: { body } })
  if (previous) {
    const lines = Object.values(model.lines).map(l => `- **${l.label}:** ${l.readiness.stage}${l.readiness.blockers.length ? ` — blockers: ${l.readiness.blockers.map(b => sanitize(b, 140)).join('; ')}` : ''}`)
    await gh(`/repos/${repo}/issues/${issue.number}/comments`, { token, method: 'POST', body: { body: [`State changed${model.event ? ` (${model.event})` : ''}:`, ...lines].join('\n') } })
  }
  console.log(`Issue #${issue.number}: dashboard ${updated ? 'updated' : 'posted'} (state ${previous || 'none'} → ${model.fingerprint})`)
  return { changed: true, issue: issue.number }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`release-control failed: ${err.message}`); process.exit(1) })
}
