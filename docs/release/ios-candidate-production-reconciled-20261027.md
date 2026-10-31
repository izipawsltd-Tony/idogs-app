# Candidate reconciled with the active Production baseline

Read-only Vercel alias lookup on 27 October 2026 resolved idogs.com.au and www.idogs.com.au to dpl_ERJ8DsmiapMMJMpCBkbdnEAqFfdM / ba574cdb0388e007f73ff62bdb40028307ce97d1. The iOS branch did not contain three Production commits: 8ce2ddc4, ff70a137 and ba574cdb. An unchanged promotion would have lost deployed SMS/billing fixes.

Merge that exact baseline into the release candidate. Preserve independent SMS Checkout/subscription lifecycle, tax preflight, canceled-subscription readback and read-only SMS runtime diagnostics. Keep deletion mutation wrappers around both SMS mutation endpoints, native payment gates, consent, privacy and history protections. Resolve CI by keeping both existing deletion/history regressions and Production webhook/SMS checks. Classify the cron-authenticated GET-only SMS diagnostic as an explicit read-only fence exemption; it cannot create a processing lease or enable deletion.

Read-only Production Firestore metadata from Firebase CLI, explicit project idogs-app:
- Default database STANDARD / FIRESTORE_NATIVE, asia-southeast1; PITR disabled; versionRetentionPeriod 3600s.
- One actual daily backup schedule, retention 604800 seconds.
- Six READY snapshots, 21–26 October 2026, each with an actual expiry seven days after its snapshot. The latest observed snapshot expires 2 November 2026 at 07:24:56.774084Z. This is not the separate staging Storage fixture deadline.
- No customer document content, backup content or credential was read. No backup, schedule, protection, Rules or Production setting was changed. External exports remain unverified.

Privacy draft now distinguishes these database backups from file soft-delete recovery. Source configuration booleans alone were not treated as proof of existing backups; schedules and actual backup metadata were listed separately. Restore/replay safeguards remain required before live deletion activation.

Local integration validation: 437 Vitest tests / 51 files, 88 webhook checks, 25 SMS checks and all 42 actual Auth/Firestore/Storage emulator tests PASS. TypeScript, Vite build and diff checks PASS. Exact-source CI, signing, Apple processing and owner device acceptance must be recorded before treating this candidate as accepted. The earlier AI-disclosure-only signed candidate is superseded for final owner acceptance; do not ask the owner to test both.

Neither this merge nor the signed binary activates Production processing, publishes effective terms or submits App Review. Existing owner-approved pricing/Australia/18+ settings and saved screenshots remain unchanged.
