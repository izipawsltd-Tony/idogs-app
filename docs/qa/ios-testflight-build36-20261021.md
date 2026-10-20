# iOS TestFlight Build 36 — internal policy-review candidate

Version: 1.0 (36). Exact runtime source: `f84f8bb42b91afec3b0f5185a452fa3ff6929e86`.

Workflow: https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39512943863

Archive/upload job: `118938161822`. App identity: `au.com.idogs.app`, App Store Connect app `6823094602`, Apple team `5N3LZDNHWM`.

## Observed checks

- Local: 246 Vitest tests, 12 deletion request/inventory tests, 4 native environment guard tests passed; TypeScript/Vite build passed with existing large-chunk warnings.
- Cloud: unit tests, deletion safety tests, production environment guard/pull, web build, Capacitor sync, identity/compliance, archive, export, signed IPA validation and App Store Connect upload succeeded.
- iOS build workflow `39512943831` succeeded for the same source.
- CI `39513045760` and `39513052527` succeeded at the following workflow-only commit `d83e21b0ce16870f721074a7f55f58fe6a2aaee6`; the app source is unchanged. Earlier candidate CI jobs were superseded/cancelled, not test failures.

Final workflow conclusion: **SUCCESS**. Processed-build lookup reached VALID and the tester assignment step succeeded. Runtime log at `2026-10-20T23:18:30.2798380Z`: `Internal tester assignment PASS for build 36 (1 tester(s))`. The workflow assigns only existing internal testers; no new tester invitation was sent.

IPA evidence artifact: `12307440988`, `idogs-ios-testflight-ipa-f84f8bb42b91afec3b0f5185a452fa3ff6929e86-build-36`, 4,929,617 bytes; SHA-256 `8530cd3ec2110ff0be6aaa32dcbd46ce65467b568cd81fc4ae8f44eaf376f9bc`. GitHub reports expiry on 27 October 2026; download before expiry if archival retention is required.

No physical-iPhone regression of Build 36 is claimed. Internal TestFlight delivery does not establish public release readiness.

## Release boundary

This binary includes explicitly labelled policy drafts. Permanent account deletion and automatic renewal cancellation remain disabled. The Firestore daily seven-day backup schedule was observed saved, but a first completed backup, restore rehearsal and Storage media backup have not been verified.

Read-only ASC audit `39513045804`, checked at `2026-10-20T23:08:58.959Z`, still showed version 1.0 in `PREPARE_FOR_SUBMISSION`, no selected build, missing listing/reviewer/screenshots/privacy URL, and `AFTER_APPROVAL` release mode. Set manual release before any approved submission. The audit preceded this upload and listed Build 34 as the newest VALID build; older build pagination was incomplete. See `../release/app-store-readiness-20261021.json`.

Public availability remains blocked by safe deletion fulfilment, operational policy decisions and publication review, final device QA and completed App Store metadata/privacy/reviewer assets. Owner approval for PR merge, production changes, submission and release remains separate.
