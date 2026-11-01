# iDogs — Milestone Report 04: automation infrastructure live (P1), Preview E2E ready (P2, needs secret)
Date: 01 Nov 2026, ~20:15 Adelaide · Author: Claude · Control Issue: #69 (live dashboard comment)

## Delivered
| PR | Branch → Base | Head | CI evidence |
|---|---|---|---|
| #70 automation (Production line) | `claude/automation-20261101` → `claude/production-rc-20261101` (#68) | `9f7d40b` | iDogs CI run 41288272938 ✅ incl. `release-control` job ✅ (ran inside Actions, updated #69 logic), `auto-fix` correctly skipped; Agent branch guard ✅ |
| #72 automation (iOS line) | `claude/automation-ios-20261101` → `claude/phase2-integration-20261101` (#67) | `cc7a45f` | iDogs CI run 41288369324 ✅ incl. iOS simulator compile ✅, `release-control` ✅; Agent branch guard ✅ |

Components (details: `docs/automation/README.md`):
1. **Release-control reporter** → Owner's Issue #69. Issue description (Owner charter) is never edited; one dashboard comment is edited in place; short "State changed" comments only when state changes. Web and iOS/TestFlight tracked separately; TestFlight counts only if built from the current iOS PR head SHA. GITHUB_TOKEN only.
2. **Bounded auto-fix** on CI failure: `claude/*` + label `agent:claude`, not `agent:hold`; ≤2 consecutive, ≤6/day per branch, `--max-turns 25`, 30-min timeout, one agent per branch. Never edits `.github/**`, rules, `vercel.json`, billing APIs; never deploys.
3. **Agent branch guard**: fails a PR if a non-Claude commit lands on a `claude/*` branch (Owner override label) or an auto-fix touches protected paths.
4. **Preview E2E (Playwright, desktop + iPhone viewport)** on Vercel staging `deployment_status`; fail-closed URL check (`idogs-app-staging-*.vercel.app`), asserts bundle targets Firebase `idogs-app-staging`; optional read-only signed-in check with a dedicated staging QA account.
5. **`@claude` (Owner-only, comment must start with `@claude`)** — inert until on `master` (Gate G8).
6. **TestFlight** job now runs in GitHub Environment `testflight` (Gate G4 once reviewers configured).
7. Labels created: `release-control`, `agent:claude`, `agent:hold`, `agent:override`. Milestone reports live in `docs/release/claude/`.

## Verified vs not yet verified
- ✅ Reporter runs in Actions on both lines; correct "no state change" dedupe; unit tests 9/9.
- ✅ Preview E2E triggers on real staging deployments, validates URL, then stops: **`VERCEL_AUTOMATION_BYPASS_SECRET` not set** (runs 41288682968, 41288554891). Correctly skips non-staging project deployments.
- ⏳ Auto-fix not exercised end-to-end: no Anthropic secret yet (by design it no-ops).
- ⏳ `@claude` not active (needs master; G8).

## Incident (fixed)
The first push of the reporter (before switching to the Owner's #69) created duplicate Issue #71 via github-actions. Closed as duplicate (not deleted) with an explanation.

## Owner actions required (credentials / settings — Claude cannot do these)
1. **Vercel**: project `idogs-app-staging` → Settings → Deployment Protection → *Protection Bypass for Automation* → Generate → add as GitHub Actions secret `VERCEL_AUTOMATION_BYPASS_SECRET`. Activates Preview E2E.
2. **Anthropic**: create a dedicated API key (`idogs-github-actions`) with a monthly spend limit → GitHub secret `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`). Activates bounded auto-fix.
3. *(Optional)* dedicated staging QA user in Firebase `idogs-app-staging` → secrets `E2E_STAGING_EMAIL`, `E2E_STAGING_PASSWORD`.
4. **GitHub → Settings → Environments → `testflight`** → Required reviewers: Owner. (Makes G4 a click-to-approve.)
5. *(Recommended)* branch protection on `master` and the two release bases; required checks `Typecheck, tests, build` + `Agent branch guard`.
6. **G8 precondition**: check which branch is Vercel's Production Branch for project `idogs-app`. `master` is stale (20 Sep); do not merge to it until confirmed.

Unchanged pending gates: G3 (rules → staging), G4 (TestFlight), G5 (iPhone QA), G6 (Production), G7 (App Store).

## Next automatic actions
- Merge #70 into #68's branch and #72 into #67's branch after review (fast-forward of Claude-owned branches), so automation covers the release PRs directly.
- On secret availability: confirm first green Preview E2E, first bounded auto-fix dry run.
- Continue P0: iOS feature integration + App Store privacy/compliance checklist.
