# iDogs — Milestone Report 01: Handover & Diagnosis (Phase 1)
Date: 01 Nov 2026, 18:10 Adelaide · Author: Claude (Implementation Owner) · For: Owner + ChatGPT (Coordinator/QA)

## Completed
- Repo cloned and inspected: izipawsltd-Tony/idogs-app (default branch `master`).
- Read DEV-HANDOFF-IDOGS-20261030.md (on PR #65 branch) and PR #64/#65/#66 bodies, file lists, CI checks.
- Independently re-ran on PR #65 head `b0194970`: `vitest` 53 files / **497 tests PASS**, `tsc --noEmit` PASS, `vite build` PASS (Node 22).

## Branch / PR state
| PR | Head → Base | Head SHA | CI | Status |
|---|---|---|---|---|
| #64 | fix/onboarding-verified-continue-20261031 → feature/account-onboarding-recovery-20261031 | a69a3143 | Typecheck/tests/build + emulator PASS | Draft. Superseded by selective port in #65/#66 — do not merge whole branch. |
| #65 | integration/ios-onboarding-documents-20261031 → release/ios-app-store-20261025 | b0194970 | CI #1027/#1028 PASS; iOS Build #39 (unsigned simulator) PASS; phone→email emulator E2E PASS | Draft. iOS line. Contains Documents Edit + staging-only phone→email link + Plus A$7→A$0 UI fix. |
| #66 | release/production-onboarding-documents-plus-20261101 → feature/puppy-lifetime-updates-20261028 | 16ad48db | CI #1040 PASS | Draft, **merge conflict (dirty)**. Built from Production LIVE `870e1a20`. Base branch has 4 newer unreleased commits (68d319ff, b3da19cb, b6fedc50, b43218e2) incl. document-button mobile width and "link SMS to existing email account" in Settings. |

Divergence: iOS release line vs Production line — Production branch is 37 ahead / 188 behind iOS release. Handoff confirms whole-branch deploy of the iOS release to web would drop live puppy/media/Meta/buyer-finance behaviour. **Strategy: keep two lines; port only approved cross-platform changes selectively (as #65/#66 already do).**

## iOS architecture (audit, first pass)
- Capacitor 8.5.2 shell in `mobile/`, bundle `au.com.idogs.app`, App Store app ID 6823094602; native project generated in CI (`cap add ios`) — no committed Xcode project.
- Workflows: `mobile-ios-build.yml` (unsigned simulator), `mobile-ios-testflight.yml` (signed upload on dispatch or `[testflight]` commit; build number = run_number), `mobile-ios-store-readiness.yml` (GET-only ASC readback).
- App Store Connect: v1.0 PREPARE_FOR_SUBMISSION, build 92 selected (Owner PASS), build 93 valid/unselected. AU-only, free, 18+ (AU). releaseType AFTER_APPROVAL (auto-release on approval — flag before submission).
- Not yet verified: App Privacy labels/legal agreements final readback, reviewer demo login, Privacy Policy is still draft/not effective.

## Findings / bugs
1. **Phone → Email/Password migration is NOT production-ready.** `linkEmailPasswordToExistingPhoneAccount` is hard-gated to `idogs-app-staging` + `VITE_IDOGS_PHONE_ACCOUNT_LINK_QA=1`, reached via `/qa/phone-sign-in` routes. Core logic is sound (same-UID `linkWithCredential`, fails closed on email-in-use, no new user). Needed for production: a Settings-based flow for signed-in phone users (no `/qa/*` routes), profile email sync on verify (present in useAuth), re-auth handling (`requires-recent-login`), and staging proof on an account that actually has dogs + Plus (owner QA account was Free/0 dogs — Plus preservation NOT yet proven).
2. **Security (Firestore rules) — `documents` update not field-restricted.** `allow update` checks write access on the *existing* `dogId` only; a client can rewrite `dogId` to another user's dog (record injection into a victim's dog view). Proposed fix: on update require `request.resource.data.dogId == resource.data.dogId` and limit changed keys to `name` (+ any fields existing client code legitimately updates — to be confirmed). Rules deploy = Owner Gate.
3. Documents View → Edit → Delete: Edit (rename) implemented in #65/#66; Delete uses existing confirm. Needs mobile-width layout commit b3da19cb ported to both lines, plus a component test for the Edit modal.
4. PR #66 conflicts with its base; needs rebase-free resolution (new integration branch from current base, cherry-pick).

## Billing / Apple policy (item 6)
- Plus is a digital subscription → if sold inside the iOS app it must use Apple In-App Purchase (Guideline 3.1.1). App is AU-only, so the US-storefront external-link allowance does not apply.
- Current design (no checkout/upgrade link on iOS; users who subscribed on the web can use Plus in-app, per 3.1.3(b) multiplatform) is compliant **only if** the iOS UI shows no price-to-buy, upgrade CTA or steering text. The web A$0→A$7 promotion must stay web-only. Action: audit native Billing screen copy for steering text before submission. Adding StoreKit IAP later is a separate Owner product/financial decision.

## Remaining release blockers
B1 GitHub write access (see Owner Gate G1) · B2 production phone→email flow + Plus/dog preservation proof · B3 documents rule hardening · B4 PR #66 conflict · B5 native Billing anti-steering audit · B6 Privacy Policy effective version + App Privacy labels · B7 signed TestFlight build of integrated source · B8 physical iPhone QA.

## Owner Gates required now
- **G1 — GitHub push access (blocking all PR/CI/TestFlight work).** Pushes from this Claude session are refused. Install the Claude GitHub App for `izipawsltd-Tony/idogs-app`: https://github.com/apps/claude/installations/select_target (or reconnect GitHub in claude.ai → Settings → Connectors).
- **G2 — Agent coordination.** Handoff §10 lists two ACTIVE Codex automations on these same branches (hourly engineering/QA, and the Storage 7-day check on 02 Nov 16:00 Adelaide). Running both risks overwriting work. Decide: pause the hourly Codex engineering automation (Claude takes over), or assign file ownership. Claude will NOT touch the Storage 7-day job.
- G3 (later) — Firestore rules deploy to staging, then Production. G4 — TestFlight upload. G5 — physical iPhone QA. G6 — Production deploy / App Store submission.

## Next implementation actions (start immediately after G1)
1. New branch from #65 head: port b3da19cb + b6fedc50 equivalents, production Settings flow for phone→email link (feature-flagged), Edit modal tests.
2. Rules hardening + emulator test.
3. Resolve #66 via fresh branch from its base; selective cherry-picks; CI.
4. Synthetic staging fixture with dogs + Plus to prove UID/data/entitlement preservation.
5. Native Billing anti-steering audit; then `[testflight]` build request.
