# iDogs — Milestone Report 02: Phase 2 fixes (local, push-blocked)
Date: 01 Nov 2026, ~18:30 Adelaide · Author: Claude · For: Owner + ChatGPT

## Status
- **G1 still NOT effective.** Owner approval received in chat, but two real push attempts (18:08, 18:28) returned HTTP 403: Claude GitHub App not installed on `izipawsltd-Tony/idogs-app`. All work below is committed **locally** and backed up as patches in this Project (`claude/patches/*.patch`). Nothing has been pushed, deployed or changed on any cloud environment.

## Completed

### Security — Firestore Rules (HIGH)
- Found: `documents`, `vaccineRecords`, `wormingRecords`, `healthTests`, `activityNotes` allowed an owner to update **any field**, including `dogId`/`tenantId`. An attacker could move a record onto another user's dog — e.g. a **fake vaccination appearing on a victim's public QR passport**. Present on both the iOS line and the Production line (so likely in live rules).
- Fix: `documents` client updates limited to `name/title/notes/source`; other dog-scoped records can't change `dogId/tenantId/createdBy`. All existing client edit flows (vaccine/health/note edits, document rename, manual upload metadata, QR sharing via API) still allowed.
- Test: `scripts/test-documents-rules-emulator.mjs` (20 allow/deny cases) + CI job on both lines. Emulator can't run in Claude's sandbox (download host blocked) → **runs in CI after push**.
- Deploying rules to staging/Production = Owner Gate G3.

### Documents View → Edit → Delete
- Dog Detail Documents tab (iOS line): Edit moved from a small text link to a button between View and Delete; action rows wrap within mobile width on both Documents views.
- Production line: same behaviour (merged with existing unreleased commits).

### Phone → Email/Password account linking (Production-safe)
- Root cause found: Production web lets customers **sign up/sign in by SMS only**; the iOS app only supports email/password. Existing VerifyEmailPage adds a verified email but **no password credential**, so SMS customers could never sign into the iPhone app.
- New Settings card **"Email & password sign-in"** (`src/lib/emailPasswordLink.ts`, `EmailPasswordSettings.tsx`): adds a password credential to the **same Firebase UID** via `linkWithCredential`. Never creates/switches/merges accounts; email owned by another UID is rejected with a clear no-merge message; an existing verified email is kept (password only added); session-change and re-auth handled; kill switch `VITE_IDOGS_EMAIL_PASSWORD_LINK=0`.
- Tests: 10 unit + 5 component tests; emulator E2E `scripts/test-email-password-link-emulator.mjs` proving UID, dogs, documents, QR flag, Plus/Stripe references unchanged, collision rejected, no extra users (runs in CI).
- iOS login screen now tells SMS customers exactly how to get in (no external link, no purchase steering).

### PR #66 conflict
- New branch `claude/production-rc-20261101` = PR #66 head + merge (not rebase) of `feature/puppy-lifetime-updates-20261028` (4 unreleased owner commits). One conflict (identical Edit button) resolved.

### Apple billing compliance (source audit)
- Native fences verified: no prices, checkout, A$0 offer, Manage subscription, invoices or upgrade links when running in the app (BillingPage, AppLayout, DogNew, DogDetail, Litters, Landing). Web-purchased Plus usable in-app (3.1.3(b) pattern). PASS at source level; screen-level check on TestFlight.

## Local verification
| Branch | Local SHA | tsc | Unit tests | Build |
|---|---|---|---|---|
| `claude/phase2-integration-20261101` (iOS line, from PR #65 `b0194970`) | `ef585ae` | PASS | 497/497 | PASS |
| `claude/production-rc-20261101` (Production line, from PR #66 `16ad48db`) | `30dd993` | PASS | 526/526 | PASS |
CI, emulator jobs and unsigned iOS simulator build: **pending push**.

## Remaining release blockers
B1 GitHub push (G1) · B2 CI + emulator proof on pushed SHAs · B3 staging rules deploy + Preview QA (G3) · B4 staging QA of email/password link on a real SMS test account with dogs + Plus · B5 port email-link card to iOS line if owner wants it in-app · B6 Privacy Policy effective version + App Privacy labels · B7 TestFlight build (G4) · B8 physical iPhone QA (G5).

## Owner Gates
- **G1 (blocking):** install Claude GitHub App on `izipawsltd-Tony/idogs-app` → https://github.com/apps/claude/installations/select_target (or reconnect at https://claude.ai/customize/connectors?auth_start=github&auth_start_force=1).
- G3: approve deploying hardened `firestore.rules` to **staging** (`idogs-app-staging`) for QA; Production rules later, separately.
- G2 note: Codex hourly automation status unconfirmed — Claude is using only new `claude/*` branches, so no shared-branch overwrite risk.

## Next actions (automatic after G1)
Push both branches → open draft PRs → CI/emulator/iOS simulator → fix failures → Preview deploy → request G3 → staging QA → TestFlight request (G4).
