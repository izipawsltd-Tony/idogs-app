# Deletion candidate verification — 19 October 2026

This is a synthetic reference processor, not an enabled permanent deletion service. The existing production request/status/cancel backend remains unchanged until a separate deployment is approved.

## Scope

- Candidate orchestration and transactional reference adapter under `scripts/qa/deletion/`; no API route, cron, provider SDK or production credentials.
- Requires synthetic UID and memory adapters. The adapter tag is a test guard, not a production security boundary.
- Revision/fingerprint/freeze and current ownership checked at claim and each record transaction. Atomic operation receipts allow retries; another owner's data and lawful-retention entries are preserved. Exact object bucket/path/generation and exclusivity checked. Auth removal follows cleanup, with idempotent retry after a lost completion receipt.
- Mock subscription enumeration handles base and SMS plans, verifies ownership and readback, stops future renewal before inventory holds, and does not re-subscribe when a deletion is cancelled. No refunds, charges, invoices or customer deletes.
- Read-only inventory candidate now discovers requester-owned `reminderEmailDeliveries` metadata without exposing message bodies or another tenant's records. It still reports incomplete/not ready.
- Provider/retention register and 31 literal collection references document evidence and unknowns. Static source discovery is not complete live enumeration.

## Local evidence

- 27 processor/lifecycle safety cases: ownership/tenant mismatch, pending claim, version and freeze changes, missing provider/backup/policy approval, cancellation/claim race, revision mismatch, ownership transaction race, replacement/shared/foreign media, wrong bucket, lost object/provider/completion responses, Auth failure, billing failure/readback/unknown status/customer identity, real-adapter rejection and stale authentication.
- 13 request/inventory tests, including the new reminder payload privacy regression.
- Total Node safety tests: 40 PASS. Existing app: 245 Vitest tests PASS. TypeScript/Vite production build PASS; existing large-chunk warning remains.

## Limits and next production gates

This proves reference behavior with deterministic memory adapters, not Firestore/Storage transaction semantics, provider webhooks/pagination/schedules, backup removal or a real write freeze. There is no production ledger adapter. Reusing a live schema or a mock `complete: true` plan cannot authorize real deletion. Do not expose this harness as a deletion endpoint.

Finish the live store/subcollection/media/backup inventory and record-specific retention decisions. Approve billing behavior and verify provider account mapping/renewal races. A production implementation needs a durable transaction adapter, inventory fingerprint validation, leases/fencing across all mutation paths, exact generation preconditions, backup restore/reapply controls, completion delivery and device cache handling. No real user QA, external messages, Rules/Storage/env changes or live Stripe calls are authorized by these tests.

This candidate does not establish App Store account-deletion readiness or legal approval. Build 34 is still the latest verified TestFlight binary; this change does not create a new iPhone runtime feature.
