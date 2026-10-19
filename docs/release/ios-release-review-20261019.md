# iDogs iOS: PR review and App Store release preparation

Prepared 19 October 2026. Preparation only; no merge, public submission, release, account deletion or App Store metadata write has been performed.

## Decision

Build 20 is usable in Internal TestFlight and has passed the agreed core checklist. Public submission is **not yet ready**. Core functional QA and App Store submission readiness are different milestones.

Recommended path: close the deletion/privacy gaps, settle the native billing approach, finish the store assets, align the release version and verify an integrated release candidate. Then request separate exact-SHA merge and App Review submission approvals. Select manual release before submission so an approval cannot publish the app automatically.

## Verified baseline

- Repository: izipawsltd-Tony/idogs-app; PR #25 remains open, draft and unmerged.
- PR base: fix/android-dog-create-confirmation at af0074918efd60d2c6d5516d840ba665aea146ef. This is a stacked mobile PR, not a PR into the default branch.
- Reviewed source/evidence head before preparation: 6140e6b0f2802611026f1f244660970a136850c8.
- Installed candidate runtime: f2d563298b818de78dae9d72e5c9457cce2063b0, marketing version 0.1.0, Build 20.
- TestFlight run 39173636771 succeeded, including signing, upload, processing VALID, verified assignment to 1 existing internal tester and signed IPA artifact 12153726057.
- Local candidate: 133 tests, 4 native environment guards, build, 4 isolated component cases and structural checks passed. Both CI jobs on the evidence-only descendant passed.
- Owner-reported device evidence: Build 17 Settings/edit/save/logout/login passed; Build 20 Billing page opened, QR/public passport passed, Litters/Activity and cold relaunch/session persistence passed. Screenshot IMG_7714 shows native purchases unavailable and an empty invoice history. This does not test an actual unpaid invoice on the device; that case is covered by mocked component regressions. Airplane-mode launch and all account classes have not been fully device-tested.
- PR has no submitted reviews or review threads at inspection time. Absence of threads is not independent review approval.

## Read-only App Store Connect inspection

Audit run: https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39179856690

The audit uses existing configured Apple credentials, GET requests only and emits an allowlisted summary. It never exports review passwords, contacts, tokens or full raw responses.

| Item | Observed state |
| --- | --- |
| App | iDogs; 6823094602; au.com.idogs.app; en-AU |
| Build 20 | VALID, not expired, usesNonExemptEncryption=false |
| App information | PREPARE_FOR_SUBMISSION; name present; subtitle absent; privacy policy URL absent |
| Store version | 1.0; PREPARE_FOR_SUBMISSION |
| Release setting | AFTER_APPROVAL: change to manual before any submission approval |
| Selected build | None |
| Description / keywords / support URL | All absent |
| Screenshots | No screenshot sets |
| Review contact / demo account / notes | Review detail absent; none configured |
| Copyright | Absent |
| Age-rating declaration | Resource exists; answers and final rating not verified |
| App Privacy labels / agreements / pricing / territories | Not verified by this audit |

The store version 1.0 and current binary marketing version 0.1.0 differ. Align them intentionally and upload a matching release candidate. Do not assume Build 20 is selectable for the 1.0 record.

## Submission gaps

### 1. In-app account deletion — confirmed code gap

Account creation is available. Settings has no user-accessible deletion initiation. Apple requires apps with account creation to support initiating deletion inside the app.

Existing useAuth.deleteAccount calls deleteUserData before Firebase Auth deletion. The helper queries dogs by tenantId, deletes linked collections by dogId, then deletes dog/profile records. It does not establish a safe current-owner/shared-history boundary, comprehensive Storage cleanup, billing handling or a resumable failure path. Auth deletion can require recent login after the earlier data writes. Do **not** simply connect this helper to a button.

Required implementation/evidence:

1. In-app deletion initiation with explicit confirmation and recent authentication, showing the actual retention/fulfilment policy.
2. Server-owned request and durable idempotent processing, with a status visible to the requester. A contact-us link alone is not the proposed solution.
3. Inventory by ownership and data provenance; protect new owners' records, transferred dog identities and other tenants' media. Resolve retention/anonymisation of shared historical records with the owner.
4. Define subscription cancellation and legally retained records honestly; do not silently charge after promising cancellation.
5. Synthetic emulator tests for transferred dogs, shared media, partial failure/retry, duplicate requests, reauthentication failure and tenant isolation. Never test deletion on real accounts/dogs.
6. Policy wording must match the implemented deletion schedule. Legal statements/retention policy require owner confirmation before publication.

### 2. Privacy and AI scanning — confirmed disclosure gap

api/scan.js sends uploaded documents to Anthropic. AIScan starts the request on file selection; the inspected UI has no provider-specific disclosure/explicit consent step before transmission. Documents can contain human contact details. The current PrivacyPage provider list does not mention Anthropic.

Before submission: draft an accurate data-flow disclosure; obtain explicit permission before third-party AI transmission; provide a manual alternative without AI; confirm the account data, images/documents, purchase history and diagnostics declarations against actual server/SDK behavior. Dog veterinary records must not automatically be labelled as human HealthKit data. Do not assert all data stays in Asia-Pacific without verifying every processor.

The exact App Privacy answers, privacy policy, support URL, age-rating answers and agreements remain review items. The app already has /privacy and /terms routes, but their presence does not establish accurate disclosure or a completed store form.

### 3. Native billing — technical gate passed, distribution approach unresolved

Build 20 hides purchase controls, invoice links and extra-litter checkout on iOS; the native API router blocks external checkout endpoints. StoreKit is not implemented. Existing web entitlements can still be used.

This establishes technical gating, **not** Apple's acceptance of the business model. Review guideline 3.1.3(b) on multiplatform services and the specifically scoped companion-app exception in 3.1.3(f). Do not claim a reader-app exception for iDogs. Decide whether the initial build fits an applicable exception or requires StoreKit. If StoreKit is required, include subscriptions, verified entitlements, restore/manage flows and sandbox QA in the schedule; no purchases or pricing changes are authorized here.

### 4. Store assets and review access — absent in App Store Connect

Draft listing and asset plan: ios-app-store-draft-20261019.md. Actual screenshots must show the release candidate using synthetic or publication-approved data. The screenshots in chat contain owner/account details and are QA evidence, not approved marketing assets.

Configure a dedicated reviewer account securely; test login and representative synthetic records. Never put its password in this public repository or workflow logs. Complete reviewer contact and operational support details through the appropriate secure portal flow. Confirm supported device families and required screenshot sets, including iPad if the binary supports it.

### 5. Integration and release provenance — confirmed branch divergence

Default branch is master, inspected at bd3aa96db1ace02a6fe39407f0575a9dd2cfe9aa. Compared with the mobile baseline, the branches have 121 mobile-side and 35 master-side commits since the common ancestor. This does not establish which branch currently backs web production.

Master-only changes affect breeding rights/compliance and five files: api/export-report.js, src/lib/breedingCompliance.ts, its tests, DogDetailPage and LittersPage.

A git merge-tree simulation (no branch moved, no merge committed) reports one content conflict in LittersPage imports. The combined source must preserve both expanded breeding-compliance imports and native payment-gate helpers. A clean textual merge of DogDetailPage is not a semantic QA PASS.

Merge plan for owner review:

1. Confirm the intended release/web branch and stack; approval to merge #25 into its current base is not approval to deploy master or production.
2. Prepare an isolated integration candidate preserving the recent compliance changes. No force push/rebase/squash.
3. Run both mobile and current compliance/privacy regression suites; build and QA the exact integrated candidate.
4. Produce the matching marketing-version IPA, TestFlight assignment and release evidence.
5. Seek exact-SHA approval for the appropriate PR(s), then separate App Review submission approval; retain manual public release.

## Estimate — planning ranges, not a release guarantee

| Work | Indicative effort / elapsed time |
| --- | --- |
| This review pack and listing draft | Prepared in this session |
| Deletion flow, AI permission/disclosure, integration and safe regression | Approximately 2–4 focused working days, subject to retention decisions and test results |
| Screenshots, review login and remaining store fields | Approximately 0.5–1 working day, partly parallel |
| Matching release build and final device QA | Approximately 0.5 working day if no new defects |
| Apple review after owner-approved submission | Allow at least 1–2 days; may take longer or require resubmission |
| Additional StoreKit implementation if required | Approximately 5–10 additional working days including sandbox and entitlement QA |

A public launch in roughly 4–8 calendar days is a planning target only if the current billing approach is acceptable, owner decisions/access arrive promptly and no new blockers occur. If StoreKit is required, use a 2–3 week planning range. Internal TestFlight is available now.

## Sources checked 19 October 2026

- Account deletion: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
- App Review Guidelines (3.1.3, 4.2, 5.1): https://developer.apple.com/app-store/review/guidelines/
- App Privacy: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- Screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- Build/version matching: https://developer.apple.com/help/glossary/version-number/
- Manual release: https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/
- Review timing: https://developer.apple.com/help/app-review/after-submitting-for-review/review-status
