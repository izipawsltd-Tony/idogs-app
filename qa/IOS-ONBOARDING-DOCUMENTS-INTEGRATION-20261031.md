# iDogs iOS release integration — owner-gated checklist

Date: 2026-10-31. Source: current iOS branch `release/ios-app-store-20261025`. This note alone does not change runtime behavior, Firebase, Stripe, TestFlight, or Production.

## Verified QA (isolated local emulator only)
- Account onboarding: link existing phone UID to verified email, reset/confirm password and re-login; owner-confirmed PASS.
- Existing synthetic Ruby demo and `plus` plan markers persisted; owner-confirmed PASS. This does not validate live Stripe.
- Signed-out public QR shows `Ruby is enjoying the garden` and does not expose `Private breeder note`; owner-confirmed PASS.
- CI #973 and onboarding emulator #4 passed on PR #64 commit `a69a3143a5aaad442d23eea750e79f3fad96e713`.

## Integration constraints
- iOS release and onboarding fix branches are substantially diverged: relative to iOS release, onboarding is ahead 55 / behind 188. **Do not merge the entire onboarding branch.**
- Existing iOS release `src/hooks/useAuth.tsx` already reloads verified email and force-refreshes its ID token; this must not be regressed. Additional profile sync behavior from QA requires deliberate design review.
- QA-only inbox, password reset form, synthetic UID, emulator URLs and Firebase flags MUST NOT be enabled in real customers' builds.
- Primary sign-in: email + password. Existing phone users must retain UID/dogs/QR/subscription and finish safe email/password setup. Password reset email deliverability and iOS universal links require real staging QA before release.
- Never enable `IDOGS_ACCOUNT_ONBOARDING_GATE` on Production by this integration, change live Firestore Rules, send real SMS, or submit to App Store without separate owner approval.
- Preserve previously accepted iOS/TestFlight changes and deletion lifecycle gates in PR #62.

## Documents — owner-accepted, not yet released
- Owner explicitly marked Documents action order **View → Edit → Delete** as QA PASS in separate workspace. Include it in the next Production release.
- Direct repo check on 2026-10-31: `src/pages/DocumentsPage.tsx` in both iOS release and onboarding branches currently shows **View** followed by **Remove from list**, not the accepted three-action layout. The validated Documents edit must be recovered from its original workspace/commit and integrated, not assumed present.
- After integration verify action semantics: View opens existing file; Edit saves changes without replacing/deleting record; Delete requires confirmation and respects access control. Check mobile layout and tests.

## Required work before TestFlight candidate
1. Recover exact owner-accepted Documents change and its QA evidence, identify source commit/path.
2. Prepare selective onboarding integration into this release-based branch, preferably isolated commits and no changes to Production config.
3. Review security boundary / Firebase Auth rules/API integration; test same-UID migration and password reset in staging with explicit email delivery checks.
4. Run typecheck, unit/integration tests, emulator, mobile smoke tests and full iOS build/TestFlight checks.
5. Only after all checks pass, request owner to QA the candidate on iPhone. Keep deployment/submission as explicit Owner Gates.

Status: PLAN / NOT iOS-QA-READY. No merges of PR #62 or PR #64, no Production deployment.
