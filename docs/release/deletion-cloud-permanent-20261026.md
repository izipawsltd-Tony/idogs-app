# Isolated cloud permanent-deletion QA — PASS

Verified 26 October 2026, Australia/Adelaide. Source c5853550ef9c1ddab7801409914c72f3182f4a1b on release/ios-app-store-20261025, PR #62. This is operator-driven isolated cloud QA, not a Production release or a signed iPhone build.

## Reproducible evidence

- Cloud workflow 40236043661, job 121297726106: success, `isolated_cloud_permanent_deletion_pass`, `cleanupVerified: true`.
- The same job ran 25 scope/provider/provisioning mock checks and 38 actual Auth/Firestore/Storage emulator integration tests, all passing before creating any cloud fixtures.
- Both iDogs CI runs 40236047155 and 40236043605 and processor regression workflow 40236043730 passed on this exact source. TestFlight 40236043865 was skipped; no new signed build is asserted.
- Provisioning run 40193735052 attempt 3 verified named database idogs-deletion-qa and bucket idogs-app-staging-deletion-qa in idogs-app-staging, Singapore, with client-deny Rules, private uniform bucket access, versioning disabled, soft delete zero, default resources unchanged. Attempt 2 stopped at a transient Rules 403 after database creation; retry verified and reused that database.

## Actual cloud behavior

A fresh random run ID bound one disposable Firebase Auth user, profile, dog, vaccination, worming, document, linked file and owned orphan file. Stripe fixtures used the dedicated Test key, exact iDogs account, nonce-owned customer/product/subscription, two-day trial and no payment method. No real customer record, Live Stripe transaction, email or SMS was used.

The harness invoked the app's request business logic and shared processor through a separate fixed-project, fixed-database, fixed-bucket scope. Transactions reject foreign document writes, Auth mutations bind UID/email/creation time, and media deletion is restricted to manifest paths. The existing public route continues to construct the strict emulator-only wrapper; an environment flag cannot enable this QA path.

The processor stopped renewal and independently read back Stripe `cancel_at_period_end=true`, froze Auth, deleted a real file and was deliberately interrupted. The profile remained and no completed receipt was produced. A new worker instance rediscovered and verified billing ownership, resumed the saved plan and finished. This exposed and fixed a real retry defect: the old code skipped provider discovery when subscription IDs were persisted, losing an adapter's in-memory ownership binding. Rediscovery now also rejects a changed subscription set.

Independent reads, before cleanup, verified:

- all five graph records removed; bounded non-control database inventory contained no fixture UID/email;
- both live files absent, exact recorded generations returned 404, version inventories empty;
- soft-deleted listing returned the documented disabled-soft-delete 400; its message identified soft delete, and bucket metadata was rechecked at zero. This is **not** an empty soft-deleted listing or a test of seven-day retention expiry;
- Firebase Auth user absent;
- Test renewal remained stopped;
- an unrelated owner sentinel record was unchanged;
- completion and QA ledger receipt existed only after verification;
- a duplicate call returned completed/duplicate without repeating operations.

Cleanup then removed only the nonce fixture records/control documents, any remaining fixture Auth/media, canceled the Test subscription, verified Test prices inactive, archived its product, deleted its Test customer and shut down the SDK. Stripe retains Test history.

## Scope limits and remaining release gates

PASS is limited to this controlled, fresh, zero-retention cloud fixture graph. Auth deletion is real, but authenticated public HTTP requests, token-driven end-to-end login, signed Stripe webhook processing and email delivery are **not verified by this run**. Confirmation is explicitly `qa-ledger-no-email`, not a sent message. The QA provider's no-ingress/no-restore attestations apply only to this harness, which issues no upload URLs, exports, backups or restores; they do not prove Production recovery controls.

PITR was disabled and backup schedules absent in the named QA database. This does not establish that no external export/administrator backup exists elsewhere. Production's seven-day Storage recovery lifecycle remains separate; the existing 38-test emulator suite verifies the waiting state and refuses completion based solely on elapsed time, but actual seven-day cloud expiry/restore replay is not proven here.

Before Production activation: complete scalable ownership inventory and server-writer fencing, real upload/restore draining, retained-data policy and post-revocation communication, signed webhook/email/public-route QA, independent security review and owner approval of an exact release candidate. App Store assets, final policy URL and a new signed iPhone build/device QA are separate release tasks. `productionReady: false` is intentional.

Production was read-only inspected at task start: idogs.com.au alias on project prj_UsnGhC1BWtYnmF5rKMYBR9KWkbIo pointed to READY dpl_ERJ8DsmiapMMJMpCBkbdnEAqFfdM, source ba574cdb0388e007f73ff62bdb40028307ce97d1. No Production deployment, deletion, IAM, Rules, Storage policy or provider change was performed by this task. Recheck fresh before any future promotion; concurrent Production work must be preserved.
