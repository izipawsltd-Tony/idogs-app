# Account-auth checkpoint — 31 October 2026

Branch: `feature/account-onboarding-recovery-20261031` (separate worktree).
Base: `b43218e22a76d488a8ea2f47d4cd7b1d39f3e14e`.
This checkpoint is NOT the whole new workflow and is NOT deployed.

## Implemented scope: Settings mobile replacement

- Both first-time linking and replacement explicitly reauthenticate the current UID through its verified email/password before requesting a new-number OTP.
- New-number verification uses `PhoneAuthProvider.verifyPhoneNumber` followed by `updatePhoneNumber` on the existing user. It does not call sign-in/create-user, delete/merge users, or unlink the old number first.
- Rejects UID changes across asynchronous steps. Pending code is bounded to the UID/new number and five-minute lifetime; resend spacing remains 60 seconds.
- Wrong password, wrong code, expired local challenge, other-account number and cancellation do not remove the old number. Password is cleared after each request and never stored outside component memory.
- Settings explains email as the main login. Existing phone-login entry is intentionally retained until the completion/migration path is ready.

## Verified results

| Scope | Result and limits |
| --- | --- |
| TypeScript | `tsc --noEmit` exit 0 |
| Regression suite | 62 files / 516 tests PASS. Initial restricted run could not open localhost for eight pre-existing media tests; rerun with localhost permitted passed all tests. |
| Settings component | Nine tests including link/change, primary-password failure, account switch, conflicting phone, wrong OTP retry, expiry and unverified email. Included in 516 above. |
| Firebase Auth + Firestore emulator | Four integration tests PASS using demo-idogs-account-mobile only. Browser SDK implementation, actual emulator phone credentials and Admin readback: same UID, old number no longer mapped, new number mapped, unchanged synthetic profile/subscription marker/dog ownership; number conflict and wrong OTP leave current mapping intact; Auth user count remains two. |
| Build | Vite build PASS; existing large-chunk warning remains. |
| Real SMS/iPhone/staging browser | NOT tested for this new Settings change. No real SMS sent. |
| Backend management readiness and recovery | NOT implemented or PASS. See owner-gate proposal. |

Emulator script uses Admin Firestore fixtures; the local emulator permits access for fixture setup. It does NOT test production Firestore rules or Stripe's remote subscription state. No Stripe mutation exists in this change. Firebase enforces its recent-login constraints; this checkpoint alone is not proof that every direct API path enforces the new primary-method policy.

## Reproduce

Install dependencies into an isolated checkout with `npm ci`. Run normal typecheck/tests/build.

For the integration test (no cloud credentials needed): set `GCLOUD_PROJECT=demo-idogs-account-mobile`, then run:

```
firebase emulators:exec --config qa/account-auth-emulators.json --project demo-idogs-account-mobile --only auth,firestore "node --test scripts/test-account-mobile-emulator.mjs"
```

The script refuses cloud/non-loopback emulator configuration. The committed GitHub workflow runs the same synthetic integration on this feature branch and relevant PR changes. Do not use production configuration to run it.

## Continuation and gate

Read `qa/ACCOUNT-AUTH-OWNER-GATE-20261031.md` before implementing recovery. Owner requested configuration inspection and server solution/cost review first. Pending decision is server-owned OTP recovery on existing Firebase Auth, QA/emulator/fake SMS only. No Identity Platform upgrade, production config change, real-message spend or deployment is authorized by that proposal.

Next development: same-UID resumable phone onboarding, verified email + proven password before management, trusted API/Firestore/Storage enforcement, legacy OTP migration, then approved recovery. Preserve public QR and existing data. Full workflow PASS requires separate tests for each of those scopes and real-device validation.

Production and the owner's existing stable QA URL are unchanged by this checkpoint. Do not represent the stable QA link as showing these new changes.
