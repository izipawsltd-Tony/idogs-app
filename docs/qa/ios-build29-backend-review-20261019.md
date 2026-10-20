# Build 29 and isolated deletion-request backend review

Mobile runtime source: `47c18b06702a8aad6eb0ad36463a41e093479d6f`.
Backend-only candidate: `c09f87f58808784334b8521c681dcbb95918f39e`, branch `fix/account-deletion-backend-20261019`.

## Changes

The account deletion lifecycle now atomically creates one support conversation and message in the existing operator inbox. Duplicate request submissions do not create duplicate tasks. Cancellation closes the task and records the cancellation without claiming permanent deletion.

Read-only inventory discovers account/dog/litter/support-related records, nested media references, unresolved ownership, missing profiles, nested collections, unknown collection names and legacy URLs. Query truncation and query errors are explicit holds. Returned reports exclude record bodies, document text, emails, provider error details and media access tokens. Record count and report fingerprint do not authorize deletion. Storage/provider/billing/write-freeze/retention checks are still outstanding; no permanent deletion processor is enabled.

## Verified tests

- Local mobile source: 139 Vitest tests, 12 server safety tests, four native environment guards, TypeScript/Vite production build and whitespace checks PASS.
- Initial isolated integration: run 39198024248, source a1102c4ce95470f538e8d99a505f9e62e0814b73, 7/7 emulator tests PASS.
- Expanded mobile-source integration: [39198422835](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39198422835), job 117886115973, 12 server tests and 8 HTTP/Auth/Firestore/Rules integration cases PASS.
- Backend candidate integration: [39198485655](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39198485655), job 117886305238, 12 server tests and 8 integration cases PASS against the candidate's actual production-base Rules. Logs report zero failures and script exit 0.
- Integration uses only `demo-idogs-account-deletion` and loopback Auth/Firestore emulators, with explicit guards against real projects and no production credentials. Real Firebase SDK transactions and token revocation checks run through an HTTP fixture. Tests confirm persistent status, concurrent idempotency, account isolation, direct-client Rules denial, support-task persistence, cancellation, transferred-dog preservation and read-only inventory.
- Mobile exact-SHA CI 39198422778 / 39198426563 PASS; unsigned simulator/ARM64 39198422728 PASS.
- Backend exact-SHA CI 39198485634 PASS.

## Preview evidence and limits

- Backend project `prj_UsnGhC1BWtYnmF5rKMYBR9KWkbIo`, team `team_oZF1Z0BUEceb9fAXdmFV1Saz`, deployment `dpl_BJN5ZgxrDh33B9Wevomy8yCheBzT` READY, target Preview, exact candidate SHA. URL: https://idogs-nw5fi1vng-izipawsltd-tonys-projects.vercel.app
- Mobile staging-project Preview `dpl_2pmZZvPjNf3NUZG4LeyCzUiAbG7c` READY at exact mobile runtime SHA. URL: https://idogs-app-staging-3d6c3ft4o-izipawsltd-tonys-projects.vercel.app
- Backend Preview HTTP fetch was blocked by Vercel Authentication after connector share-link retries. No authenticated local Vercel CLI was available. Deployment READY is not application-authenticated Preview E2E PASS; no live request persistence or live native end-to-end PASS is claimed.
- Tony confirmed Close on the Build 26 deletion screen. IMG_7715 showed service unavailable; this is historical evidence of missing production API, not successful request submission. No physical iPhone QA of Build 29 has been performed by the agent.

## Production owner gate

Current production was rechecked: SHA `ee3a4089ca6feb0a650fcf01d9aa9816530067f0`, deployment `dpl_GVNRvUc9JMiW7V4DnKwVaV6F71dQ`, with idogs.com.au and www.idogs.com.au aliases verified. Candidate c09f87f is exactly one commit ahead, zero behind, and adds eight files: four new server files, two test scripts, one credential-free emulator workflow and one release note. No existing production file is changed. No mobile UI, Rules/Storage/CORS/env, Stripe, Resend or deletion execution changes are included.

[Review exact backend-only diff](https://github.com/izipawsltd-Tony/idogs-app/compare/ee3a4089ca6feb0a650fcf01d9aa9816530067f0...c09f87f58808784334b8521c681dcbb95918f39e).

Only after separate exact-SHA production approval: recheck production base and deploy the backend-only candidate to the existing production project. Verify unauthorized API rejection and use a synthetic disposable account for request/read/cancel + one support task. Preserve request data on rollback. Do not promote the full mobile branch or merge PR #25. Permanent cleanup, billing disposition, write freeze, published privacy wording and App Store submission remain incomplete and separately gated where applicable. No real account, dog, billing or production configuration was changed in this work.

## Signed TestFlight delivery

- iOS 1.0 (29), runtime source 47c18b06702a8aad6eb0ad36463a41e093479d6f: [run 39198422720](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39198422720) SUCCESS; job 117886115785.
- 2026-10-19T04:20:08.2167140Z: `UPLOAD SUCCEEDED with no errors`.
- 2026-10-19T04:22:13.7880660Z: `Internal tester assignment PASS for build 29 (1 tester(s))`. The workflow polls VALID and verifies tester assignment.
- IPA evidence artifact 12163381346; archive digest `sha256:06a75b4858bd3994002b50d83730cd3928f1f6d4e437e6d16c8c886081d21db5`.
- This confirms delivery to TestFlight, not physical iPhone regression or production endpoint availability.
