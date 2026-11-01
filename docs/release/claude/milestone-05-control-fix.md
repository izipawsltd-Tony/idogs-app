# iDogs — Milestone Report 05: control-issue regression fixed; iOS release checklist
Date: 01 Nov 2026, ~20:45 Adelaide · Author: Claude · Responds to: Coordinator review on #69 (comment 6555629292)

## 1. Duplicate control issue (#71, #73) — root cause and fix
- **Root cause:** #73 was opened 09:20:47Z by Preview E2E run 41288455340. Vercel's `deployment_status` for the first automation commit `db5f1c8` executes *that commit's* workflow/script, which still had a create-issue fallback. The later fix could not affect a deployment of the older commit.
- **Fix (commits `6895382` web line / `11b8d61` iOS line):** issue creation and title search removed entirely. `.github/release-control.json` `issueNumber: 69` is mandatory. A missing, closed or untrusted #69 → error and **zero writes**. Writers edit one dashboard comment (oldest trusted; Actions prefers its own), so concurrent runs converge. The Actions `concurrency: idogs-release-control` group still serialises writers.
- **Regression test:** `scripts/release-control/update-issue.integration.test.js` against an in-memory fake GitHub API covers four cases. Repeated invocations: 0 issue creations, exactly 1 dashboard on #69. 6 concurrent invocations: 0 creations, 1 dashboard. #69 closed: fails closed, 0 writes. Config without a number or an untrusted issue: fails closed, 0 writes. Reporter tests 15/15; full suite 550 tests.
- **Real-event verification:** CI runs 41289984867, 41289988799, 41290256055 on the new heads → `Issue #69: no state change`. No issue created since the fix (GitHub API check, 09:40Z onward). #71 and #73 closed (not deleted).
- **Residual exposure (disclosed):** only an explicit redeploy of the two superseded commits (`db5f1c8`, `154d57a`) could run the old code. Nothing triggers that automatically.

## 2. CI on new heads
| PR | Head | iDogs CI | Agent guard | Preview E2E |
|---|---|---|---|---|
| #70 (web automation) | `6895382` | ✅ (push + PR) | ✅ | stops at missing bypass secret (expected) |
| #72 (iOS automation) | `11b8d61` | ✅ (push + PR) incl. iOS simulator compile | ✅ | pending Vercel event |

## 3. iOS release checklist (new)
`docs/release/claude/ios-release-checklist.md` consolidates the existing read-only ASC evidence and lists the remaining gaps. It includes:
- the physical-iPhone QA script for G5 (13 steps);
- App Privacy labels and effective policy (Owner/legal);
- account-deletion fulfilment risk under Guideline 5.1.1(v);
- the AFTER_APPROVAL release-mode decision.

Verified at source level: no social sign-in, so Sign in with Apple is N/A. No Meta/ads code on the iOS line, so no tracking declaration is needed.

## 4. Waiting on
- **Coordinator review** of #70/#72 before integrating #70 → #68 and #72 → #67 (as instructed: "once reviewed").
- Owner secrets/settings: `VERCEL_AUTOMATION_BYPASS_SECRET`, Anthropic key with spend limit, Environment `testflight` reviewer.
- Gates G3, G4, G5, G6, G7, G8 unchanged — none approved.
