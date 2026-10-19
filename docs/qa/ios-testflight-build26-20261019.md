# iOS 1.0 (26): account deletion request boundary

Runtime SHA: `d9947561765a4a639e86865adc4af3badf4eb454`.

Implemented: Settings request/status/cancel UI with password reauthentication and explicit confirmation; server-scoped, idempotent transactional requests; five-minute auth_time validation and revoked-token rejection; read-only Super Admin operator queue and conservative dog ownership classification. Removed the old destructive deleteAccount/deleteUserData helpers. No mandatory 30-day delay. Passwords are cleared and never included in the application API request.

This is a request lifecycle, **not completed permanent account deletion**. The inventory screen explicitly marks its inventory incomplete. No processor, deletion cron, Storage cleanup, billing cancellation/refund or Auth deletion is enabled. Production native calls still require deployment of `/api/account-deletion` on idogs.com.au; until then failures are shown honestly. Do not advertise this candidate as App Store-ready deletion.

## Verification

- Local: 139 Vitest tests; 9 server safety tests; 4 native environment guards; TypeScript/Vite build; JS syntax and whitespace checks PASS.
- New tests cover confirmation, stale auth_time despite refreshed iat, revoked tokens, cross-account target injection, duplicate requests, cancellation after processing, idempotent cancellation, resubmission rate limit, status data minimization, transferred/pending/legacy ownership classification, unavailable API, failed reauthentication, credential clearing and no credential transmission to API.
- Server datastore behavior is tested with a transactional fake. Real Firestore durability and authenticated Preview E2E were **not** verified. No real dog/account was deleted or transferred, and no paid provider API was called.
- [TestFlight run 39190149042](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39190149042) SUCCESS; job 117860958332.
- Upload log: 2026-10-19T02:34:21.0855860Z `UPLOAD SUCCEEDED with no errors`.
- Assignment log: 2026-10-19T02:36:28.3886620Z `Internal tester assignment PASS for build 26 (1 tester(s))`; workflow polls VALID then verifies tester relationship.
- IPA artifact 12160101373, digest `sha256:3a836f88055d3de2a53e7cdca0caeb9d9fdb3690b905659f84f061e80ddeda83`.
- CI runs 39190149170 and 39190152301 SUCCESS. Unsigned simulator/ARM64 run 39190149135 SUCCESS.
- Vercel team `team_oZF1Z0BUEceb9fAXdmFV1Saz`, staging project `prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o`, exact-SHA Preview `dpl_GGrqfp1YBfc1ZtVgYR7xix6iw6ou` READY, target null (Preview). URL: https://idogs-app-staging-1ymsi9zrr-izipawsltd-tonys-projects.vercel.app
- Protected Preview fetch was blocked by Vercel Authentication: connector returned deployment_authentication_required after its temporary share link was rejected. No authenticated local Vercel CLI was available. No protection configuration was changed or fake E2E PASS recorded.

## Remaining gates and engineering

Owner approved revised behavior in chat on 19 October. Do not ask for that policy approval again. Before permanent processing, finish provider/records/media/QR/backups inventory, recheck current ownership at execution, verify race-safe write freeze across direct Firestore clients and Admin-SDK mutations, then test partial cleanup/retry and Auth failure paths. Existing storage.rules is explicitly emulator-only and is not evidence of live Storage policy. Do not deploy it as live policy.

Separate owner approval is still required for production deployment, public submission/release and PR merge. Firebase Rules/Storage/Stripe live changes remain outside this delivered candidate. Public policy claims, StoreKit/billing disposition, App Store metadata/screenshots/reviewer access and branch integration remain unresolved. No Build 26 physical iPhone regression was performed by the agent.
