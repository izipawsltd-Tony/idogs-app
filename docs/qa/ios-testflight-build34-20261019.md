# iOS integration candidate — 1.0 (34)

Runtime/source SHA: 9c642e07a396e35233944dc8160a2575442550ae. Branch: fix/android-v20-qa-blockers. PR #25 stays draft and unmerged.

## Changes

- Clear stale deletion status/controls before a new status read or mutation. A lost request/cancel response cannot leave an old form enabled; the user must reconcile via Refresh status. Password and confirmation are cleared. Three added component regressions cover failed refresh and lost request/cancel responses.
- Integrate the deployed web baseline c6780255a1774032f58e7a8b678446554e3ecc57 and subsequent production SHA 8941cff8737140c024f35e8bde115107fa84cc4c. Preserve native billing gates, safe document viewing/upload, offline server reads, startup/auth, Settings and per-document AI permission alongside current-owner-only data, immutable/recovered history, HEIC, care reminders and notification settings.
- Preserve the Other reminder option and collapsible notification-category panel. Native push is not implemented. Email delivery tests use mock providers; no actual email/SMS was sent by QA.
- Resolve seven original textual conflicts plus the later Settings import conflict, preserving both mobile behavior and current-owner edit restrictions. Fix a new historical QR path to use the public HTTPS origin rather than the Capacitor origin.
- TestFlight assignment checks the existing tester/build relationship before adding, handles bounded transient/conflict retries, emits only sanitized Apple error codes and requires a subsequent read to prove assignment.

An exact diff against deployed source 8941cff8737140c024f35e8bde115107fa84cc4c confirms all API files, firestore.rules and storage.rules are identical. The integrated Rules file is inherited from that source. No Firebase Rules/Storage deploy, environment change, Stripe operation, production promotion, public submission or PR merge was performed.

## Verification

- Fresh dependency install succeeded. 240 Vitest tests PASS locally; TypeScript/Vite build PASS. Existing bundle-size warning remains.
- Node account-deletion/history/media/ownership regressions and four native environment guards PASS. Some emulator-only scripts initially refused a local run without emulator configuration; they were then run in the guarded cloud emulator environment. No unconfigured test is counted as PASS.
- Exact-source CI 39247983761 and PR CI 39247987318 SUCCESS.
- Exact-source emulator run 39247983760 SUCCESS: 12 server safety checks, 8 real Auth/Firestore request lifecycle cases, actual Firestore ownership Rules checks, synthetic two-dog transfer/claim/history/export and legacy-history recovery isolation. No cloud credentials or real dogs/accounts used.
- Earlier isolated integration b83f7ca2aff51fb7e34d1a2e61a0fbe9e265ad8f also passed CI 39247043244 and emulator 39247043054.
- Signed TestFlight run 39247983714 / job 118044503336 SUCCESS end-to-end. Upload succeeded at 2026-10-19T12:01:23.9000490Z; Internal tester assignment PASS for build 34 (1 tester) at 2026-10-19T12:04:06.7588130Z. Apple returned transient HTTP 409 STATE_ERROR twice; bounded retry and subsequent relationship GET verified delivery. IPA artifact 12184737397, archive SHA256 80f0720d1de8cdb34bea9b6f44b816bef4e1ca8a8cc8e438f64ca724184c49d8.
- Unsigned simulator/ARM64 run 39247983910 SUCCESS. This is compile/identity evidence, not a booted simulator or physical-device regression.
- Exact-source staging-project Preview dpl_6bGGvKU7dy5nAuHmmGdJU9DSuzwd READY, verified git SHA 9c642e07a396e35233944dc8160a2575442550ae. URL: https://idogs-app-staging-f3yag5rtn-izipawsltd-tonys-projects.vercel.app. No authenticated Preview browser E2E claim is made.

Build 33 source f379977ebe4fa70e96e619ee54eec1c26b0fd50d uploaded successfully in run 39246467132, but tester assignment returned HTTP 409 and that pipeline FAILED. Artifact 12182788834 is upload evidence, not end-to-end delivery success. Build 34 supersedes it with its own successful upload, VALID processing and verified tester assignment.

## Store audit and remaining gates

Read-only audit run 39246467134 succeeded, checkedAt 2026-10-19T11:41:41.784Z. At that time Build 29 was the newest VALID build. The report deliberately sampled the five newest builds and flags older-build pagination as incomplete; it is not a full build inventory. Store version 1.0 remained PREPARE_FOR_SUBMISSION, releaseType AFTER_APPROVAL, no selected build, description/keywords/support URL/screenshots/reviewer details absent. No App Store fields were changed. Select manual release before any future approved submission.

No agent physical-iPhone regression of this binary has occurred. The owner's IMG_7718 screenshot verifies that the prior native app read No request after backend deployment; it does not establish submission/deletion completion. Historical device results are not relabelled as Build 34 results.

Permanent account deletion remains disabled/incomplete. Inventory, race-safe write freeze, storage/provider/backup coverage, billing disposition and privacy publication still need completion. The proposed seven-calendar-day fulfilment target and renewal-cancellation business rule are concrete owner/legal review items in ../release/deletion-fulfilment-owner-review-20261019.md; neither is enabled by a TestFlight upload. StoreKit, store assets, privacy declarations and secure reviewer access remain unresolved. This candidate is not a claim of App Store submission readiness.
