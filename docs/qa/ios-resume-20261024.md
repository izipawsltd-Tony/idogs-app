# iOS resume after TestFlight 1.0 (39)

Build 39 runtime is 54013cb619577019fef28a2681bfa86c49328b97; this isolated candidate starts from its documentation successor e69a9d4ede873c4da70e54ac86a935641ccb911c. The owner's task is iPhone/TestFlight delivery, not another web QA round.

Read-only Billing now distinguishes trial end from ordinary renewal and preserves cancellation priority. Optional server trialEnd and promotionStatus fields are supported without assuming that a legacy trial is a confirmed campaign. Missing fields remain compatible. Native promotion confirmation is neutral: no prices, checkout/portal links or purchase steering are introduced. All native payment route/UI gates remain in place. No API, Firebase Rules/Storage, production configuration, Stripe objects or other branches change.

Local validation: 255 Vitest tests, four native production-environment guard checks, TypeScript and Vite build passed. Six new status cases cover legacy trial, explicit trial end, cancellation, confirmed/unconfirmed promotion and missing date. Existing rendered iOS/Android payment-gate tests passed. TestFlight packaging uses the existing guarded production client configuration; a staging Test customer must not be treated as a production iPhone entitlement fixture.

The existing TestFlight workflow is enabled for this isolated branch and will sign/upload to the existing internal tester group. Delivery and physical iPhone validation must be verified separately. No public App Store submission, release, PR merge or production backend deployment is authorised by this increment. Existing deletion fulfilment and public-release gates documented for Build 39 remain open.
