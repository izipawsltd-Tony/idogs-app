# iDogs iOS — current PR and App Store readiness

Updated 19 October 2026. This replaces the earlier Build 20 review as the current summary. No PR merge, App Store submission/release, public policy publication or permanent account deletion is performed by this pack.

## Current candidate

Source/runtime: 9c642e07a396e35233944dc8160a2575442550ae, marketing version 1.0, Build 34. See ../qa/ios-testflight-build34-20261019.md for final delivery states, runs, artifact and limitations. A version number alone is not delivery or physical-device QA evidence.

The candidate integrates current production source 8941cff8737140c024f35e8bde115107fa84cc4c with native Settings/auth/document/offline/billing gates, explicit AI consent, safe deletion initiation and current-owner/history isolation. Production remains separate; no mobile branch promotion is implied.

240 Vitest checks and the local TypeScript/Vite build passed. Exact-source CI 39247983761 / 39247987318 and emulator 39247983760 succeeded. Emulator checks cover real Auth/Firestore deletion request persistence/cancellation/isolation, actual ownership Rules, synthetic transfers/claims, frozen history/export and legacy recovery. Provider/email I/O is mocked. No destructive QA against real accounts/dogs.

PR #25 remains draft and stacked on fix/android-dog-create-confirmation. Feature-branch integration commits preserve both histories; no force push/rebase/squash or PR merge. Reinspect the intended release base before any owner-approved merge. Do not assume master or this PR base is the deployed web branch.

## Completed technical increments

- Settings access, effective plan display, native purchase/portal/invoice gates; StoreKit remains absent.
- Production API request/status/cancel, recent authentication, explicit confirmation, server-owned idempotency and atomic support task; unsafe client deletion helpers removed.
- Failed refresh or lost request/cancel response clears stale controls until status reconciliation.
- Per-document Anthropic scan permission with cancel/manual entry, before transmission.
- Production HEIC, care reminders, Other type, notification preferences and collapsible category panel integrated for native. These controls do not enable native push.

Historical device QA remains historical. IMG_7718 confirms the prior native UI reads No request after the backend fix. No agent full physical-iPhone regression of Build 34 is claimed.

## Remaining account deletion and policy gate

Permanent deletion is still disabled/incomplete. The read-only inventory reports explicit ownership/storage/provider/billing/retention/write-freeze holds; it is not cleanup authorization. Disabling Auth alone does not invalidate every already-issued Firestore token.

Concrete owner/legal proposals: deletion-fulfilment-owner-review-20261019.md. The proposed seven-calendar-day fulfilment target and cancellation of future renewal before permanent cleanup are not active. The already approved no-mandatory-30-day direction is not being re-requested. Finish safe fulfilment, retries/races, verified freeze, provider/backup coverage and completion receipts after the policy decision; production Rules/Storage and irreversible execution remain separately gated.

Apple permits manual fulfilment in a reasonable period, with an explained timeframe and completion confirmation; it does not require that every cleanup operation be automated. A request that nobody can safely fulfil is not submission readiness.

## Privacy and native billing

The in-app AI permission exists, but the published PrivacyPage still contains unverified Asia-Pacific/processor/compliance claims and an outdated automatic 30-day deletion promise. The factual Anthropic addition is drafted in ai-privacy-owner-review.md. Verify processing arrangements, retention and App Privacy answers before owner-approved publication; do not infer legal compliance from code tests.

Native Stripe/web checkout is technically gated. This does not establish App Review acceptance of the existing-web-entitlement model. StoreKit, any applicable companion-service basis, subscription/refund treatment and final reviewer explanation remain review items; no pricing, Stripe or purchase action has been performed here.

## App Store Connect inventory

GET-only audit run 39246467134 at 2026-10-19T11:41:41.784Z verifies app 6823094602, au.com.idogs.app, en-AU. At audit time Build 29 was newest VALID; five recent builds were sampled, older-build pagination explicitly incomplete.

Version 1.0: PREPARE_FOR_SUBMISSION, AFTER_APPROVAL, no selected build. Subtitle/privacy URL, version description/keywords/support/marketing URLs, screenshots, copyright and reviewer information were absent. App Privacy labels, agreements, age-rating answers, pricing/territories and reviewer-login success were not verified. No fields were changed. Set manual release before any future approved submission so App Review approval cannot automatically publish.

Listing and screenshot capture draft: ios-app-store-draft-20261019.md. Actual release-candidate assets must use synthetic/publication-approved data and the supported device-family sizes. Private owner QA screenshots are not marketing assets. Reviewer credentials must stay outside this public repository and logs.

## References rechecked 19 October 2026

- https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications

Public submission and release remain unapproved. This pack does not claim App Store readiness or a guaranteed launch date.
