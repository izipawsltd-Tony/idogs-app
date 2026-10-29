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

## Exact-source cloud evidence

Runtime/source candidate: `3e64bda540314dbc08b4a3171396913773f0f72c`.

- Push CI run `39256986528`, job `118074648660`: SUCCESS. All typecheck, unit/server, account deletion safety, native environment guard and production build steps succeeded. Job log explicitly reports `tests 40`, `pass 40`, `fail 0`.
- PR CI run `39256991450`: SUCCESS for the same head SHA.
- Protected staging Preview `dpl_GzC9vWEgTmY2qpNAMtXBSWmuhJWA`: READY at the exact candidate SHA, Preview target (not production).
- Preview URL: https://idogs-app-staging-eqwbzddxp-izipawsltd-tonys-projects.vercel.app
- Staging project protection verified enabled, `all_except_custom_domains`, before deployment. No alias promotion or protection weakening.
- Authenticated Vercel fetch of `/privacy` failed with `deployment_authentication_required`, HTTP 302 at `/sso-api`; generated share-link access was not accepted. No token/share URL is recorded here. Therefore no deployed browser/UI QA PASS is claimed. Rendered policy/component regressions passed in the 245-test suite.
- Production read-only recheck: `dpl_Fe5XxYFrDzhw2hNXL7MxLLwHKHkw`, READY, source `8941cff8737140c024f35e8bde115107fa84cc4c`. No production deploy performed.
- No new TestFlight binary uploaded; latest previously verified binary remains 1.0 (34).

The four-item review phase produced a tested rehearsal, mocked billing, an evidence/gap register and successful CI/Preview build. It did NOT complete a production-capable permanent deletion processor or a live data-retention/legal audit. Those remain blocked by the documented store/provider/write-freeze/retention requirements. Do not describe iOS as App Store core-ready from this evidence.
