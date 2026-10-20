# Owner-approved deletion request backend production deployment

Tony explicitly approved production deployment of exact backend SHA `c09f87f58808784334b8521c681dcbb95918f39e` in chat on 19 October 2026.

## Deployment verified

- URL: https://idogs.com.au
- Project: `prj_UsnGhC1BWtYnmF5rKMYBR9KWkbIo` (`idogs-app`).
- Team: `team_oZF1Z0BUEceb9fAXdmFV1Saz`.
- Production deployment: `dpl_7hZFrd8pMArQiiU9Fg9wGVDXurev`, READY, target production, exact approved Git SHA verified through Vercel metadata.
- idogs.com.au and www.idogs.com.au aliases verified on the new deployment. Metadata rechecked after live QA.
- Previous production baseline/rollback reference: `ee3a4089ca6feb0a650fcf01d9aa9816530067f0`, deployment `dpl_GVNRvUc9JMiW7V4DnKwVaV6F71dQ`.
- Candidate CI 39198485634 and emulator integration 39198485655 were rechecked SUCCESS before deployment. Exact additive diff: four server files, two tests, one credential-free emulator workflow and release notes; no existing production file changed.

## Live production smoke evidence

[Run 39204547050](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39204547050), job `117904425178`, SUCCESS. Fixture source `5e92ddcf318209b3efa1c9f6cbcff71fc6c581d8` is on the mobile development branch; it was not deployed to production. Summary logged at 2026-10-19T05:26:28Z.

Verified against https://idogs.com.au/api/account-deletion:

1. Unauthenticated GET returns application JSON 401 with the expected sign-in error.
2. Unauthenticated POST returns 401.
3. A unique `example.invalid` Firebase Auth fixture was created from the production public client configuration, with token audience and identity checks. No existing account login, verification email or SMS was requested. No server environment or service-account secret was retrieved.
4. Authenticated GET initially returned no request.
5. POST request returned requested; subsequent GET returned the same persisted timestamp with private/no-store caching.
6. Duplicate POST retained the same receipt.
7. Cancellation returned cancelled and a subsequent GET confirmed persistent cancellation.
8. Only the freshly created synthetic Auth identity was removed using its own token. Cancelled request/support audit records were intentionally retained. No Firestore documents were deleted and no permanent account-deletion processor was invoked.

Support-task atomicity/count was verified in the prior emulator suite. The live test did not separately inspect the private operator inbox or test the iPhone UI. Do not relabel this as physical iPhone regression or complete permanent account deletion.

## Observability and scope

Runtime error/fatal counts were queried for this production deployment in a 15-minute window after QA. Vercel returned no matching groups. This is a bounded observation, not a guarantee of no future errors. Drains configuration could not be verified because the connector's GET /v1/drains returned 404; no monitoring or access settings were changed.

Enabled: authenticated request/status/cancel, support task creation/cancellation, and read-only Super Admin inventory. Existing iOS builds using this API route can now reach the backend.

Still incomplete/disabled: permanent data cleanup, full provider/storage/backup retention inventory, verified race-safe write freeze and billing disposition. No Rules/Storage/CORS/env/Stripe/Resend configuration change, real-account/dog deletion, PR merge, App Review submission or public App Store release occurred. iOS TestFlight 1.0 (29) remains the latest verified signed delivery; this backend deployment does not require a new native binary.
