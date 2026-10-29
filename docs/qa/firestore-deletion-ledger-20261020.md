# Firestore deletion ledger, retention/backup and Preview QA

20 October 2026 — review candidate, not production activation.

## Current result

| Area | Evidence | Outcome |
| --- | --- | --- |
| Durable progress | 23 real Firestore/Auth emulator integration cases; request revision, receipts, leases/epochs and restart after Auth deletion | PASS in emulator only |
| Global write freeze | Valid current-owner client writes still succeed with a frozen fence under repository Rules; direct Admin SDK writes bypass cooperative guards | NOT READY; permanent processing remains disabled |
| Production backup/retention | GET-only audit could not obtain a verified Firebase identity/credential combination from the existing Vercel connection | UNVERIFIED; no settings read or inferred as enabled/disabled |
| Public policy UI | Exact-source protected Preview rendered Privacy/Terms; reciprocal navigation returns to draft notice after smooth scrolling | PASS for tested desktop views |
| Authenticated Settings | Secure sign-in verified; open → GET “No request” → Refresh → expand billing/retention → Close | PASS for these read-only checks on source 2a4c614… |
| Residual privacy copy | Removed unverified residency/compliance promises in Settings, Signup, Dog Detail and public passport; shared neutral processing summary | 246 app tests and local build PASS; final exact-source cloud evidence below |

No live deletion request, subscription mutation, Rules/Storage/env change, production deploy, TestFlight upload, merge or App Store submission occurred.

## Durable Firestore implementation

`api/_lib/account-deletion-ledger.js` is an emulator-only candidate with no API route/scheduler caller. Before any RPC it rejects a project other than `demo-idogs-account-deletion`, a non-loopback Firestore host, a non-synthetic UID and invalid worker/revision arguments.

Transactions validate request revision/status, immutable manifest digest, freeze state, worker ID/epoch and lease. Deletion requires the exact approved manifest entry, nanosecond document version, current owner and no pending transfer. Linked private records must precede their owning dog. Record deletion and its minimal operation receipt commit atomically. Receipts exclude document bodies, passwords, tokens and private messages.

A new worker resumes persisted receipts after lease expiry; previous workers are fenced out. Cancellation committed before claim blocks cleanup. Completion requires every operation receipt and persisted Auth success. The coordinator test deletes actual emulator Auth after Firestore cleanup, simulates loss of the completion receipt, then resumes through a fresh worker and persists `already_absent` before completion. A request receipt alone cannot become completion.

### New server-only paths

| Path | Purpose | Retention |
| --- | --- | --- |
| `accountDeletionManifests/{uid}/revisions/{revision}` | Reviewed operation identities, versions and evidence references | Unapproved; no TTL configured |
| `accountDeletionFences/{uid}` | Cooperative write guard and restore tombstone | Restore/reapply window must be verified before disposal |
| `accountDeletionProgress/{uid}/revisions/{revision}` | Lease, epoch, fingerprint, Auth outcome and completion | Required during all retries; post-completion schedule unapproved |
| `.../operations/{operationHash}` | Minimal idempotency receipts | Must cover retry/restore windows; exact duration unverified |

Fixture approval/evidence values are synthetic, not actual legal or backup approval. Workflow artifact retention and worker lease duration are not personal-data retention policies.

## Write-freeze finding and release block

The cooperative Admin SDK write helper checks the same fence transaction. It does not automatically protect existing mutation APIs. A direct Admin SDK bypass is demonstrated by a synthetic test. A valid active-dog fixture allows a baseline client update with an open fence, then another update with a frozen fence under the same repository Rules. Therefore a fence document alone does not protect against current-owner writes. Client reads of the server-only ledger/manifest/fence are denied in the emulator.

Before enabling deletion, cover direct client Firestore/Storage writes, Admin SDK APIs, uploads/grants, transfer/claim, scheduled reminders/provider dispatch and restore/reapply behavior. Disabling Auth or revoking refresh tokens alone is not proof of a freeze. Active deployed Rules were not retrieved; repository Rules evidence is not a claim of exact live configuration. Neither root Rules file was modified or deployed. The existing repository Storage Rules fixture must not be applied as live policy.

## Production retention/backup access attempt

The audit is GET-only. It accesses the exact Vercel production project `prj_UsnGhC1BWtYnmF5rKMYBR9KWkbIo` in team `team_oZF1Z0BUEceb9fAXdmFV1Saz`, selects only the existing four Firebase config variables in memory and requires an exact verified Firebase project/bucket before any Google metadata request. No raw config, credential, key, token or env file is logged or uploaded.

At `c4735f0228aa4721250d805db8a30f2e80759a73`, run `39329550256`, metadata job `118323987015`, the returned config did not supply a verifiable production Firebase identity/bucket/private-key combination. The guard stopped before Google requests. Omitted/non-readable values or connection scope can cause this; it is NOT evidence that the working production runtime is misconfigured. A successful audit job means the script executed, not that backup or retention verification passed.

Still unverified: database location/PITR/version history, backup schedules/expiry/restore viability, bucket location/versioning/soft deletion/lifecycle/retention, active Rules, operator exports and external provider contractual retention. No backup was created, restored, enabled, disabled or deleted; no IAM was broadened.

The Google Cloud console returned “Site Unavailable” in this browser. The official Firebase plugin was discovered and suggested; connection remains unconfirmed. Owner-authorised Firebase access to project `idogs-app` is the remaining read-only configuration gate. Do not request service-account keys or tokens in chat.

## Exact-source verification

Source `2a4c614127964885fd97dd7a7854fe48bc601ed7`:

- Push CI `39330233776`: SUCCESS; PR CI `39330242000`: SUCCESS.
- Deletion run `39330233644`, ledger job `118326257224`: 40 unit/safety tests + 23 Firestore/Auth emulator cases PASS; zero failures.
- Protected Preview `dpl_AMjhRuxUKhC8vKnr3FsofNm7CAUF`: READY at exact source SHA.
- https://idogs-app-staging-y7tgy0f0q-izipawsltd-tonys-projects.vercel.app
- Public browser checks: Privacy HTTP 200; both cross-links exercised; each destination heading at Y=104 px after existing smooth scrolling settled; viewport and page width both 1357 px. Draft notices visible. No physical iPhone claim.
- Secure sign-in completed and a fresh Settings page positively identified the signed-in account. No credential values were read or recorded.
- Account deletion UI: “No request”; password empty, confirmation unchecked, submit disabled. Refresh temporarily removed old controls while checking, then returned “No request”. Billing/retention disclosure opened; Close returned to the initial button. No POST request or account deletion confirmation was performed.

During authenticated QA, Settings still asserted Asia-Pacific residency/Privacy Act compliance. Source review found matching unsupported assertions in Signup, Dog Detail and public passport. Candidate `ace98516c813b42df057d1ab0226dfcf42566aeb` replaces these with `DATA_PROCESSING_SUMMARY`. It changes copy only, not signup acceptance state, auth, billing or deletion behavior. A regression checks these surfaces for the old assertions. Local: 246 app tests PASS; TypeScript/Vite build PASS (existing bundle-size warning). Backend ledger/processor files are unchanged from the emulator-verified source. Final candidate CI/Preview observations will be appended when complete.

## Remaining gates

- Confirm Firebase connection and read the actual configuration/active Rules. Do not infer retention or backup settings from code defaults.
- Prepare and verify a scoped global write-freeze implementation before seeking approval to apply production Rules/API changes or enable permanent processing.
- Confirm record-specific legal/business/provider retention and approved billing behavior before policy effectiveness. This is not solicitor approval or App Store readiness.

### Final privacy-copy candidate

- Exact source: `ace98516c813b42df057d1ab0226dfcf42566aeb`.
- Push CI `39332071668`, job `118332449864`, and PR CI `39332076661`: SUCCESS. Cloud logs explicitly report 246 app tests and 40 Node safety checks PASS; typecheck/build successful.
- Protected staging Preview `dpl_2oJxFEkjiumHFk7AHZU54WLPLaFd`: READY at exact source SHA.
- https://idogs-app-staging-q202xnod5-izipawsltd-tonys-projects.vercel.app
- Public Signup HTTP 200 and rendered browser view show the neutral shared processing summary both in the information box and agreement label; no old residency/compliance assertion, no account created or agreement ticked. Viewport/page width both 1357 px. Privacy and Terms headings and draft notices verified in the same final deployment.
- Authenticated Settings behavior was verified on 2a4c614… as recorded above. The final Settings change is copy-only; the new summary also renders in existing Settings component regressions. No claim of a fresh authenticated session on the new deployment hostname.
- Exact GitHub comparison from 2a4c614… to ace985… contains only this evidence document, shared policy copy, policy regression and four UI pages; no API, ledger, processor or Rules changes. Thus the 23-case emulator evidence applies to unchanged backend code, rather than claiming a new emulator run on the copy-only commit.
- Remaining configuration access gate: Firebase connection is not confirmed. Global freeze and backup/retention are not marked PASS. See ../release/deletion-write-freeze-scope-20261020.md for the concrete mutation coverage required before production activation.


## Follow-up: live Firebase Console inspection and rebuild

Observed 20 October 2026 through the existing authenticated Google browser session. This supersedes the earlier connection blocker for the Firebase Console only; the Firebase plugin still exposes no callable tools in this chat, and Google Cloud Console still returns “Site Unavailable”. No credentials were retrieved or changed.

- Exact PR #29 HEAD before this documentation change: `6d72e6a4b6147014acd17e5b93a5b1b501d9aeb7`, open and draft.
- Fresh isolated checkout: 246 Vitest tests PASS; 40 deletion request/processor Node tests PASS; TypeScript/Vite build PASS, with the existing bundle-size warning. No new emulator run or physical iPhone QA is claimed.
- Firebase project `idogs-app`, Firestore `(default)`: Data view reports `asia-southeast1`.
- Disaster Recovery: point-in-time recovery switch is OFF. Daily/weekly retention summaries show `-`. Opening “Edit scheduled backups” shows both Daily and Weekly unchecked. Cancel closed it without changes. Thus these built-in scheduled backups are not configured in the observed UI. This does not exclude external/operator exports or prove backups never existed.
- Storage bucket selector reports `idogs-app.firebasestorage.app`. Bucket lifecycle, soft delete, versioning, retention lock and restore viability remain unverified.
- Published Firestore Rules view has the starred version labelled `Aug 12, 2026 • 6:55 AM` (UI timezone not established). The full editor text was copied for read-only inspection (45,595 characters); no typing/editing/publishing occurred. It has no references to `accountDeletionFences`, `accountDeletionProgress` or `accountDeletionManifests`. The dog update grant checks effective ownership/protected fields/transfer provenance/status/claim history, but no deletion fence. This confirms the proposed fence is not enforced by these live Rules. It is not an exact-content hash comparison against repository Rules or an authenticated production write test.
- Read-only Firebase navigation initially restored the accountDeletionRequests collection list; no request documents or dog records were opened, changed or deleted.

Remaining release holds: actual global write enforcement across clients/Admin/storage/jobs, complete exclusive-ownership inventory, storage/provider/backup retention and restore/reapply policy, and billing fulfilment. The emulator adapter remains intentionally unavailable to production routes. Request/status UI readiness is not permanent-deletion or App Store readiness.

Owner review needed before enabling paid recovery settings or applying production Rules/API changes. A possible backup configuration to cost and review is daily backups with 7-day retention plus 7-day PITR; this is a proposal, not a verified quotation, approved retention policy, existing configuration or complete media backup plan. Do not enable it or claim a spending cap without a separate cost decision. Permanent processing, production policy publication, PR merge and App Store submission remain unapproved.
