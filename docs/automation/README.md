# iDogs — 98% AUTO build, QA and release control

GitHub is the single source of truth. Claude (lead developer) writes code, tests and progress to GitHub; ChatGPT (coordinator / independent QA) reads the same Issue, PRs, commits, CI and Vercel results with its own GitHub connection; the Owner acts only at gates.

```
 Claude session / @claude ──push──▶ claude/* branch ──▶ PR (label agent:claude)
                                         │
                       ┌─────────────────┼──────────────────────────┐
                       ▼                 ▼                          ▼
                 iDogs CI          Agent branch guard        Vercel Preview (staging)
        (typecheck, tests, build,  (ownership + protected     │ deployment_status
         emulators, iOS compile)    paths for auto-fixes)     ▼
                 │        │                              Preview E2E (Playwright)
        failure  │        └─────────┐                         │
                 ▼                  ▼                         ▼
        Claude auto-fix ──push──▶  release-control ◀──────────┘
        (bounded retries)          updates Issue "iDOGS — BUILD & RELEASE CONTROL"
```

## Components

| File | Trigger | What it does | Credentials |
|---|---|---|---|
| `.github/workflows/ci.yml` (jobs `release-control`, `auto-fix`) | `pull_request` on `claude/*` | After CI: refresh control Issue; on failure call auto-fix | `GITHUB_TOKEN` only (+ Anthropic for auto-fix) |
| `.github/workflows/release-control.yml` | called by CI / Preview E2E, or manual | Rebuilds the control Issue from GitHub data; comments only when state changes | `GITHUB_TOKEN` (issues:write) |
| `scripts/release-control/update-issue.mjs` | — | Reporter logic; unit-tested (`scripts/release-control/update-issue.test.js`) | — |
| `.github/release-control.json` | — | Tracked PRs per line (Web, iOS), Owner Gate statuses | — |
| `.github/workflows/claude-autofix.yml` | called by CI on failure | Bounded Build → Test → Fix loop on the same branch | `ANTHROPIC_API_KEY` **or** `CLAUDE_CODE_OAUTH_TOKEN` |
| `.github/workflows/agent-guard.yml` | `pull_request` on `claude/*` | Fails if another agent pushed to a Claude branch, or an auto-fix touched protected paths | none |
| `.github/workflows/preview-e2e.yml` + `e2e/` + `playwright.config.ts` | Vercel `deployment_status` (staging Preview) | Playwright smoke (desktop + iPhone viewport), asserts bundle targets `idogs-app-staging`, then refreshes Issue | `VERCEL_AUTOMATION_BYPASS_SECRET` (+ optional QA account) |
| `.github/workflows/claude.yml` | `@claude` comment by the repo **OWNER** | Hands a task to Claude from GitHub | Anthropic secret. **Inert until merged to `master` (Gate G8).** |
| `.github/workflows/mobile-ios-testflight.yml` (iOS line) | manual / `[testflight]` commit | Signed build + TestFlight upload, now behind GitHub Environment `testflight` | existing Apple + Vercel secrets |

Web readiness and iOS/TestFlight readiness are tracked as separate lines in the Issue. A TestFlight build counts only if it was built from the current iOS PR head SHA.

## Credentials the Owner must add (least privilege)

Add in **GitHub → Settings → Secrets and variables → Actions**. Never paste values into chat, Issues, commits or logs.

| Secret | Required for | How to create | Scope / least privilege |
|---|---|---|---|
| `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`) | auto-fix, `@claude` | Anthropic Console → API keys (dedicated key named `idogs-github-actions`) | Set a **monthly spend limit** on the workspace; rotate if exposed |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Preview E2E | Vercel → project **idogs-app-staging** → Settings → Deployment Protection → *Protection Bypass for Automation* → generate | Only bypasses protection for that staging project's Previews |
| `E2E_STAGING_EMAIL`, `E2E_STAGING_PASSWORD` (optional) | signed-in read-only E2E | Create a **dedicated QA user in Firebase `idogs-app-staging`** (no real customer, no real card) | Staging only; the test refuses to sign in unless the bundle targets `idogs-app-staging` |

No new secret is needed for the control Issue (uses the built-in `GITHUB_TOKEN`). Existing Apple/Vercel production secrets are used only by the gated TestFlight workflow.

## Owner settings to apply (cannot be done by an agent)

1. **Environment `testflight`** (Settings → Environments → New): add yourself as *Required reviewer*. Every TestFlight upload then waits for your click — this is Gate G4.
2. **Labels**: `agent:claude` (auto-fix allowed), `agent:hold` (pause automation on a PR), `agent:override` (accept a non-Claude commit on a `claude/*` branch), `release-control` (marks the control Issue). Claude creates these.
3. **Branch protection (recommended, not changed by automation)**: protect `master` and the release bases (`release/ios-app-store-20261025`, `feature/puppy-lifetime-updates-20261028`) with *Require a pull request* + required checks `Typecheck, tests, build`, `Agent branch guard`.
4. **Gate G8 before merging anything to `master`**: `master` is stale (last commit 20 Sep 2026). Confirm in Vercel → project idogs-app → Settings → Git which branch is the *Production Branch*. If it is `master`, a merge would deploy old code to idogs.com.au — change it or disable auto-deploy first.

## Bounds and spending

- Auto-fix runs only when: branch `claude/*`, PR from this repo, label `agent:claude`, no `agent:hold`, an Anthropic secret exists.
- Max **2 consecutive** auto-fix commits at a branch head (`Auto-Fix-Attempt:` trailer), max **6 per branch per UTC day**, `--max-turns 25`, 30-minute job timeout, one agent per branch (`concurrency: idogs-agent-<branch>`).
- `@claude`: OWNER only, `--max-turns 30`, 30-minute timeout.
- Preview E2E: one run per deployed SHA (older runs cancelled).

**Estimated operating cost** (estimates — verify against your bills):
- GitHub Actions: this repository is public → standard Linux and macOS runner minutes are free.
- Vercel: unchanged (Previews already build on every push).
- Anthropic: roughly a few US dollars per auto-fix or `@claude` run depending on model and turns; worst case is bounded by 6 auto-fixes per branch per day. Set a monthly limit (e.g. US$100) in the Anthropic Console; when it is hit, runs fail safely and the Issue shows the failure.

## Security rules enforced

- Secrets only in Actions Secrets; scripts never print them; the bypass secret is sent only to `https://idogs-app-staging-*.vercel.app` (validated, fail-closed).
- Issue/PR text, logs and comments are untrusted: the reporter never reads comment bodies; free text is neutralised (no mentions, HTML or links); auto-fix is told to treat logs as data.
- Automation never deploys Production, changes Production Firebase rules, touches Stripe Live or real customer data, or submits to the App Store. Auto-fix may not touch `.github/**`, `firestore.rules`, `storage.rules`, `vercel.json` or billing APIs (enforced by Agent branch guard).
- Branch protection and security checks are never disabled by automation.

## Identity note

Interactive Claude sessions reach GitHub through the Owner's connected account, so their commits/comments show as `izipawsltd-Tony`; Actions runs show as `github-actions[bot]` / `claude[bot]`. Claude's commits always carry a `Claude-Session:` trailer, and `@claude` triggers require the comment to *start* with `@claude`, so automated status comments can never trigger an agent run.

## Branch ownership between agents

- Claude works only on `claude/*` branches. Other agents (e.g. Codex) must use their own prefixes and never push to `claude/*`.
- The guard fails a PR if a new head commit on a `claude/*` branch lacks a Claude trailer (`Claude-Session:` or `Auto-Fix-Attempt:`). The Owner can accept it with `agent:override`.
- One auto-fix per branch at a time (GitHub concurrency group).

## Failure recovery

| Symptom | Action |
|---|---|
| Issue not updating | Actions → *Release control report* → Run workflow (manual). Check the job log; the reporter fails loudly on API errors. |
| Auto-fix loops or makes a bad change | Add label `agent:hold` to the PR (stops auto-fix immediately on the next CI), revert the commit, comment what went wrong. |
| "Auto-fix stopped: retry budget reached" | A human or interactive Claude session takes over; the budget resets after a non-auto-fix commit or the next UTC day. |
| Preview E2E fails at the first test | Bypass secret missing/rotated, or Preview not targeting staging — fix the secret; the suite refuses to proceed against a non-staging bundle by design. |
| Agent branch guard fails | Someone else pushed to a Claude branch. Coordinate; either revert or add `agent:override`. |
| Anthropic spend limit hit | Runs fail; raise the limit or wait; nothing else is affected. |

## How to resume automation (new session, new agent, or after a pause)

1. Read the open Issue **iDOGS — BUILD & RELEASE CONTROL** (current stage, blockers, gates, links).
2. Read the latest report in `docs/release/claude/` and `.github/release-control.json`.
3. Check out the tracked PR branches (`claude/*`); never reset or force-push them.
4. Remove `agent:hold` if it was set; push a commit (or run the CI workflow) to restart the loop.
5. To track a new PR, add its number under the right line in `.github/release-control.json` (reviewed commit).
6. Gate status changes only by a reviewed commit to `.github/release-control.json` after the Owner approves in writing.
