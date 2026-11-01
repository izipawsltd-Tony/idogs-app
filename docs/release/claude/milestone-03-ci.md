# iDogs — Milestone Report 03: pushed, CI green, 2 real bugs fixed
Date: 01 Nov 2026, ~19:30 Adelaide · Author: Claude · For: Owner + ChatGPT

## G1 — RESOLVED
Push access verified with a real push. Branches live on GitHub; Draft PRs opened (no merges, no deploys).

| PR | Branch → Base | Head SHA | CI (push) |
|---|---|---|---|
| [#67](https://github.com/izipawsltd-Tony/idogs-app/pull/67) iOS line | `claude/phase2-integration-20261101` → `integration/ios-onboarding-documents-20261031` | `124f37d` | Run 41286858500 — Typecheck/tests/build ✅ · Phone-to-email emulator E2E + Rules emulator (21/21) ✅ · Unsigned iOS Simulator compile ✅ |
| [#68](https://github.com/izipawsltd-Tony/idogs-app/pull/68) Production line | `claude/production-rc-20261101` → `feature/puppy-lifetime-updates-20261028` | `c20c8c5` | Run 41286856813 — Typecheck/tests/build ✅ · Email/password link emulator E2E ✅ · Rules emulator (21/21) ✅ |

Vercel Preview builds: READY for both heads (staging project + Preview scope). See "Staging QA" below.

## Bugs found by CI / functional testing and fixed
1. **Email & password sign-in failed for customers who already added a verified email** (Firebase rejects linking a credential for an address the account already owns: `auth/email-already-in-use`, proven in emulator). Fix: such accounts get `updatePassword()` on the same UID; accounts with no email still use `linkWithCredential`. Emulator E2E now proves: SMS-only → email+password; SMS+verified email → password added, verification kept; email owned by another account → rejected; UID, dogs, documents, QR flag, Plus/Stripe refs unchanged; no extra users.
2. **Production Documents page: rename appeared to do nothing.** Edit saved `documents.name` but the list displayed only `documents.title`. Fix: display name → title → type label (same as Dog Detail). A behavioural test fails without the fix and passes with it.
3. Rules emulator test harness mis-scored successful writes (repo's `checkAsync` needs a truthy result). Fixed; rules themselves were correct.

## Documents View → Edit → Delete — functional evidence (both lines)
`src/pages/DocumentsActions.test.ts` (8 tests): button order View → Edit → Delete; View requests a short-lived signed URL with the user's token for the exact file path; Edit persists the trimmed name and updates the list; Edit failure keeps the old name and shows an error; result not applied after an account switch; title-only uploads rename correctly; Delete confirms, deletes and removes the row; cancelled Delete does nothing. Firestore permissions for these writes proven separately by the rules emulator test.

## Unit test totals (CI)
iOS line: 505 tests · Production line: 535 tests — all pass.

## Staging QA — BLOCKED on access (not a code issue)
Vercel Previews are behind **Vercel Deployment Protection** (redirect to vercel.com login). Claude did not sign in to Vercel or the app. No staging data was read or written.

## Not yet done (honest status)
- Hardened Firestore rules NOT deployed anywhere (staging or Production). There is no CI path to deploy rules; it needs Firebase credentials → Owner Gate G3.
- No browser/staging functional QA yet; local + CI evidence only. **This is not Production QA PASS.**
- No TestFlight build requested yet (G4).

## Owner Gates now required
- **G3 — deploy hardened rules to STAGING only.** From the PR #68 branch, the exact command is `firebase deploy --only firestore:rules --project idogs-app-staging`. Reply "G3 approved" and say who runs it (Owner, or Claude via a Firebase staging deploy secret added to GitHub Actions).
- **Staging QA access.** Either (a) Owner opens the Preview links signed into Vercel and runs the 6-step QA script below, or (b) Owner creates a Vercel *Protection Bypass for Automation* secret for the staging project so Claude can run Preview QA itself.
- **G4 — TestFlight upload** of PR #67 head `124f37d` (builds against the Production Firebase/API; front-end-only changes vs build 92). Reply "G4 approved" to dispatch `mobile-ios-testflight.yml`.

## Staging QA script (6 steps, staging test account only)
1. Settings → "Email & password sign-in" on an SMS-signup **test** account → add email + password → sign out → sign in with email/password → same dogs/documents/plan.
2. Repeat on a test account that already has a verified email (password only).
3. Try an email that belongs to another test account → expect the "not merged" message.
4. Documents: View opens file; Edit renames and new name shows; Delete asks and removes.
5. Billing: A$7 crossed out → A$0 shown (web).
6. Dog Detail → Documents tab: same View/Edit/Delete on a phone-width screen.

## Next automatic actions
Address review comments on #67/#68 · on G4: dispatch TestFlight, verify processing in App Store Connect (GET-only readiness workflow) · prepare physical-iPhone QA checklist · continue App Store privacy/compliance packet.
