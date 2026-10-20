# iOS release checkpoint — Build 39 delivered

Build 39 is delivered to an existing internal TestFlight tester. Evidence: `../qa/ios-testflight-build39-20261021.md`. Latest read-only App Store inventory: `app-store-readiness-20261021.json` (audit run `39513045804`, before Build 39). This checkpoint does not authorize PR merge, production deployment, legal publication, App Store submission or public release.

## Next concrete owner gate

Approve deployment of isolated request-policy backend SHA `4145b0cef610777a7069fbe9ba5bc79991bb89ec` to `idogs.com.au`, if desired after reviewing draft PR #31: https://github.com/izipawsltd-Tony/idogs-app/pull/31. Exact-source CI/emulator checks and Preview READY are recorded in the Build 39 evidence. This would persist request targets and disabled renewal tasks only. No live cancellation, permanent processing, policy publication or Rules/Storage change is included. Recheck current production before deploying.

## Business-policy decision approved

Tony explicitly approved both principles below on 21 October 2026. This clears the business-rule decision for implementation and synthetic QA. It does not activate the operating service or make the draft effective in production:

1. Aim to complete a valid authenticated deletion request within **seven calendar days**, with an explanation of outstanding checks and a next update date within that period if completion is blocked. This is a service target, not a statutory deadline or a new mandatory waiting period.
2. Arrange and verify stopping future renewal of an active web subscription when a valid deletion request is accepted, without waiting for permanent cleanup. Cancellation takes effect at the end of the paid period; earlier account deletion can end access sooner. Cancelling the deletion request does not restart renewal. No automatic refund promise; statutory consumer remedies remain preserved.

This approval does **not** authorize a live Stripe change, charge, refund, real-data deletion, new Rules/Storage deployment or publication of legal terms. Each consequential production action remains separately controlled. The exact production candidate must be prepared and tested before that later approval request. See `deletion-policy-approval-20261021.md` for the implementation increment and its limitations.

## Remaining engineering and release evidence

- Finish exclusive current-ownership and media inventory, protected shared history, resumable cleanup and effective write fencing across clients/Admin/providers. Current emulator-only ledger cannot be enabled in production.
- Verify backup expiry/restore replay and provider retention; daily Firestore seven-day retention was re-observed saved during this session. Firebase's page does not show completed backup instances. A first completed backup, restore rehearsal and Storage media protection remain unverified.
- Final physical-iPhone QA of Build 39, then a final release binary after functionality and effective policies agree.
- Complete listing, real synthetic-data screenshots, reviewer credentials, privacy declarations, agreements, pricing/availability and manual release setting. Current ASC version remains unsubmitted with substantial missing fields.
- Obtain owner/legal approval of final effective wording and separate owner approval of submission/release and any PR merge.

## Availability communication

Internal users can use delivered TestFlight builds. A public App Store date cannot yet be committed: deletion fulfilment and release materials are not complete. Apple currently describes a goal of reviewing 90% of submissions within 48 hours, but that is after submission and is not approval or publication assurance:
https://developer.apple.com/help/app-review/after-submitting-for-review/review-status

No claim of Australian legal compliance or solicitor sign-off is made by this engineering checkpoint.
