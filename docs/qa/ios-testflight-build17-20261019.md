# iDogs iOS Build 17 verification — 19 October 2026

Release candidate: `4c27396b1b147790637f8b85f27e57f2b3c010a6`.
PR #25 remains draft and unmerged. No public release is authorized.

## Defect corrected

BillingPage's payment history exposed hosted Stripe invoice links even when native purchase controls were hidden. An unpaid hosted invoice could offer payment outside the native billing gate. Native builds now hide both external invoice actions; invoice status/history remains readable. Web invoice actions retain their existing behavior. ExtraLitterButton also guarded Android only, leaving iOS purchase UI visible when Plus litter quota was exhausted. It now uses the shared native-platform guard, even if the quota API returns checkoutEnabled=true. No Stripe configuration or server billing logic was changed.

## Verified evidence

- Extra-litter regression reproduced the iOS purchase button on the prior code; corrected iOS/Android/web cases passed.

- Baseline rendered BillingPage regression: iOS and Android both failed (2 failures); web passed.
- Corrected candidate: 126 Vitest cases, 4 native environment guards, TypeScript/Vite production build and diff whitespace checks passed locally.
- Rendered invoice tests exercise synthetic unpaid invoices, verify no external links/purchase controls on iOS/Android, and retain web links. Only a mocked billing-summary request occurs.
- Additional isolated component QA: 4 cases passed. Covers mobile Settings link/route, profile edit/save against a mocked database, sign-out navigation, missing/encoded public passport, successful synthetic public passport/tab switching, and empty Litters/Activity rendering.
- Component QA command: `npx vitest run --config scripts/qa/ios-component.config.ts`.
- Existing structural suites passed: billing navigation, Settings role gating, Dog Detail subordinate read errors, litter client DTO, transfer error sanitization.
- Existing real-SDK offline suite passed: unavailable collections do not become false empty Dogs/Documents/Reminders/Litters/Activity data.
- Candidate CI: https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39170333161
- Candidate unsigned iOS simulator and ARM64 build: https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39170329189
- Signed TestFlight pipeline: https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39170329191

## Limits and remaining acceptance criteria

Component rendering is not an installed iPhone test. This execution environment has no controllable iPhone, macOS simulator, or Appium device session. An attempted local WebKit installation did not complete; no browser or device PASS is claimed.

Still unverified on installed Build 17: visible/tappable Settings layout, logout then actual Firebase login, QR camera/open-public-passport handoff, native Billing screen interaction, Litters/Activity navigation, background/foreground and cold offline launch, and complete installed-iPhone regression. Earlier owner-reported passes from older builds remain historical evidence, not new Build 17 evidence.

Status: automated source/component coverage verified; full iOS TestFlight core-ready is NOT yet established. Device access is a capability blocker. StoreKit is not implemented. Public submission and PR merge remain owner gates after acceptance, not substitutes for missing native QA.

No production data mutation, real transfer, email/SMS, billing purchase, Firebase Rules/Storage/CORS/env/Stripe/Resend configuration change occurred.
