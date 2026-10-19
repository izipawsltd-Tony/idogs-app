# Firestore deletion ledger, backup/retention and Preview QA

Review candidate, 20 October 2026 (Australia/Adelaide). No production deletion, subscription mutation or Rules/Storage/env change is enabled.

## Implemented Firestore progress

`api/_lib/account-deletion-ledger.js` stores request progress and per-operation receipts in Firestore transactions. The factory rejects any project other than `demo-idogs-account-deletion` and any Firestore host outside the expected loopback emulator. It is not imported by a route or scheduler.

- Request revision, immutable manifest fingerprint, current freeze state and worker lease/epoch are checked in transactions.
- Manifest digest covers operation identities, evidence and policy/billing approvals. Those fixture approvals are synthetic, not actual legal approval.
- Deletes require the approved manifest entry, exact nanosecond document version, current owner and no pending transfer. Linked private documents are processed before their owner dog.
- Record deletion and its minimal receipt commit atomically. Receipts contain operation type/status/epoch/time, not document bodies, passwords, tokens or private messages.
- A new worker can resume persisted receipts after an expired lease; old workers fail the epoch/lease check. Cancellation before claim prevents processing.
- Completion requires all cleanup receipts and a persisted successful Auth outcome. Lost completion after Auth deletion is retried as `already_absent`; a request is never marked completed from request submission alone.
- The fence remains after completion as a synthetic restore/tombstone precaution. This does not establish an actual production backup restore process.

## Write freeze finding

The cooperative Admin SDK write helper checks the same Firestore fence transaction. A direct Admin SDK write can bypass that helper; this is explicitly demonstrated with synthetic fixtures. Existing repository Firestore Rules do not reference this deletion fence. A dedicated emulator case verifies whether an authenticated current owner can still edit their synthetic dog while a fence exists. This is a coverage finding, not a claimed live enforcement guarantee.

Do not enable permanent deletion until every client/Storage/Admin SDK mutation path, uploads/grants, transfer/claim, scheduled reminders and provider dispatch is covered. Disabling Auth or revoking refresh tokens alone is not proof of a freeze. Active deployed Rules were not retrieved by the metadata audit, and repository `storage.rules` remains an emulator-only fixture; neither root Rules file was modified or deployed.

## Production retention/backup verification attempt

A GET-only GitHub Actions audit uses the existing Vercel connection to inspect the exact production project's configuration in memory and attempts Google metadata reads only after strict Firebase identity validation. No raw config, credential, private key, token or env file is logged or uploaded.

At source `c4735f0228aa4721250d805db8a30f2e80759a73`, run `39329550256`, metadata job `118323987015`, the API did not supply a verified production Firebase identity/bucket/private key combination. The guard stopped before any Google metadata call. This may reflect omitted/non-readable values or connection scope; it is NOT evidence that the working production runtime is misconfigured. The audit job running successfully does not mean backup/retention verification passed.

Unverified: database region/PITR/history window, backup schedules/expiry/restore viability, bucket location/versioning/soft deletion/lifecycle/retention, active Rules and all external provider/contractual retention. No backup was created, restored, enabled, disabled or deleted. No IAM scope was broadened.

A direct Google Cloud console attempt returned “Site Unavailable” in this browser. Firebase's official plugin was discovered but was not installed/connected at this checkpoint. The next access step is an owner-authorized Firebase connection to project `idogs-app`, used for read-only configuration review. Never ask the owner to paste service-account keys or tokens.

## Preview observations

Earlier exact-source Preview `3e64bda540314dbc08b4a3171396913773f0f72c` became accessible through the existing Vercel connection, HTTP 200; public Privacy and Terms rendered in the cloud browser. Draft notices, shared deletion/billing/retention wording and both cross-links were observed. Desktop viewport/page width both 1357 px; no horizontal overflow observed on Terms. This is desktop browser evidence, not physical iPhone evidence.

Found navigation defect: Privacy/Terms kept the previous page's scroll position, potentially skipping the draft notice. Both legal pages now reset scroll on mount. No legal clause, price, auth or subscription behavior was changed by this fix. Final Preview retest is recorded below when complete.

Navigating to `/app/settings` redirected to `/login?next=%2Fapp%2Fsettings`. There is no authenticated iDogs session in this browser, so Settings/deletion UI end-to-end QA requires secure sign-in. No real deletion request or password reauthentication was attempted.

## Validation checkpoint (superseded by final evidence below)

- Local: 40 Node request/inventory/processor checks PASS; 245 app tests PASS; TypeScript/Vite production build PASS (existing bundle-size warning).
- Firestore/Auth emulator: run `39329436045`, ledger job `118323598076`, 21 integration cases PASS, including new coordinator recovery after Auth succeeds but completion receipt is lost.
- The additional client Rules isolation/freeze-gap cases and latest exact-source CI/Preview results are pending at this checkpoint. Do not infer their result from earlier runs.
- No new TestFlight upload, PR merge, public policy publication or App Store submission.

## New server-only data and retention decisions

| Candidate collection | Purpose | Data minimisation | Retention status |
| --- | --- | --- | --- |
| `accountDeletionManifests/{uid}/revisions/{revision}` | Immutable reviewed work inventory | Record/object identities, versions and approved evidence references; no source document bodies | Duration and restricted archival/disposal policy unapproved; no TTL enabled |
| `accountDeletionFences/{uid}` | Block cooperating writes and prevent accidental restoration | UID/revision and freeze state | Restore/reapply window must be known before removing a fence; not an indefinite legal-retention promise |
| `accountDeletionProgress/{uid}/revisions/{revision}` | Durable lease, fencing epoch and completion state | Worker ID, epoch, deadline, fingerprint, Auth outcome/time | Required throughout processing/retry; post-completion schedule requires approval |
| `.../operations/{operationHash}` | Idempotent per-operation receipts | Operation type, outcome, epoch and completion time | Must not expire while a job can resume or a backup can restore deleted data; exact schedule remains unverified |

These paths supplement the older static collection register. A Firestore TTL policy is not configured or modified by this candidate. Provider/business/legal retention and backup expiry are separate from workflow-artifact retention (seven days) and worker lease duration (30 seconds).


## Final exact-source validation

Candidate: `2a4c614127964885fd97dd7a7854fe48bc601ed7`.

- Push CI `39330233776`: SUCCESS. PR CI `39330242000`: SUCCESS.
- Deletion verification run `39330233644`: SUCCESS as an execution run; ledger job `118326257224` reports 40 unit/safety tests and 23 Firestore/Auth integration tests PASS, zero failures. Metadata execution success does NOT establish verified backup settings.
- The client isolation test passed. The valid active-dog baseline write succeeded with an open fence AND with a frozen fence, proving this repository Rules candidate has no deletion write-freeze enforcement. Direct Admin SDK bypass was also demonstrated. No assertion that global freeze passed.
- Real emulator Auth was deleted after Firestore cleanup; a fresh worker resumed after a simulated lost completion receipt and persisted `already_absent` before marking completed.
- Candidate app tests: 245 PASS and TypeScript/Vite build PASS. The legal navigation fix introduces no new dependency or data/subscription side effect.
- Preview `dpl_AMjhRuxUKhC8vKnr3FsofNm7CAUF`: READY at exact source SHA. URL: https://idogs-app-staging-y7tgy0f0q-izipawsltd-tonys-projects.vercel.app

### Required owner access and activation boundary

1. Add and authorise the official Firebase plugin for read-only review of project `idogs-app` metadata and active Rules. No service-account key/token in chat. Do not expand IAM or enable paid backups without a separate reviewed decision.
2. Sign in through the secure iDogs Preview login flow to permit Settings UI QA. No destructive account request is needed.
3. Production freeze changes, live progress processing, retention/public policy and public App Store release remain unapproved. First verify active Rules/config and prepare a scoped candidate covering every write path; never deploy the emulator-only Rules or enable deletion simply because the ledger tests pass.


### Final deployed browser retest

At exact-source Preview above: Privacy GET returned HTTP 200. Both Privacy → Terms and Terms → Privacy cross-links were exercised in the cloud browser. After the existing smooth scrolling settles, each destination heading was observed at viewport Y=104 px, with the draft notice at the top. Page width and viewport width were both 1357 px; no horizontal overflow. Public desktop policy/navigation QA PASS for these checks only. No physical iPhone or authenticated Settings PASS is inferred.

The latest `/app/settings` navigation again redirected to the app login page. Secure sign-in is the remaining UI access gate. The Firebase plugin was suggested but has not been confirmed connected; retention/backup remains unverified.
