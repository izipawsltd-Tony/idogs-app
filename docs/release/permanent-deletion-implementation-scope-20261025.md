# Permanent account deletion — implementation scope for owner decision

## Observed baseline and blocker

Source: TestFlight 1.0 (42), ec8eef95178a2c518d0191737770b62b1c54ed4e. This is source analysis, not a verification of currently deployed Firebase Rules or production backend version.

- api/_lib/account-deletion.js is explicitly request lifecycle only. It creates a receipt/support task and supports cancellation; it does not delete data or mutate subscriptions.
- api/_lib/account-deletion-inventory.js always returns complete:false and readyForDeletion:false, retaining write_freeze_not_verified, billing_provider_verification, storage_object_inventory, external_provider_retention and shared_history_retention_review holds.
- api/super-admin/account-deletions.js is GET-only; there is no trusted completion processor.
- src/components/legal/PolicyReview.tsx tells users permanent deletion and automatic renewal cancellation are unavailable and policy text is not effective.
- firestore.rules isSignedIn/isOwnerUser-based client writes do not consult a server-owned deletion processing lock. users/{uid} create/update and dog-related write routes therefore need a verified freeze before taking a cleanup snapshot. This is an analysis of source; do not claim active production Rules are identical.
- storage.rules is a local-emulator-only deny-all fixture. Do not deploy or modify its production counterpart indiscriminately. Real media uploads use Admin endpoints and signed grants, so server/provider write fencing must be assessed as well as Firestore client writes.

## Proposed authorised engineering increment

Request permission to change the account-deletion backend, relevant UI, Firestore Rules SOURCE and emulator tests on this isolated release branch. The requested scope is implementation and synthetic local/emulator QA, not production activation. Do not change real Rules/Storage/CORS, execute live Stripe cancellation, or erase real accounts without their separately prepared exact-SHA production authorisations.

1. Add a server-owned processing lock and client-write denial for the deleting account while processing. Keep request/readback/cancel available before processing; never allow a user to self-clear a processing lock. Do not broadly lock unrelated current owners or shared dog records.
2. Add equivalent fences to authenticated Admin mutation endpoints, reminder jobs and media grants; wait for or invalidate outstanding signed-upload authority before inventory is considered stable. Freeze existing write credentials, not merely the UI or profile flag. Do not assume disabling Auth instantly invalidates every existing ID token or signed URL.
3. Build a complete, paginated current-ownership and media inventory. Protect other owners' dog histories and shared documents, quarantine ambiguous/pending transfers, cover nested collections and newly discovered collections. Missing pages, changed versions, unresolved references or external-provider retention checks hold processing; never silently skip them.
4. Use a durable resumable job with revision/lease guards, idempotent operation receipts and exact record/object version checks. Keep identity/billing resolution available until verified; do not remove Auth first and strand a subscriber. Mark completed only after actual readback verifies the intended removals/de-identification and retained categories are documented.
5. Reuse the previously approved seven-day service target and stop-future-renewal principle. Provider cancellation uses test adapters only in this increment, verified subscription discovery and idempotency; no real charges/refunds/cancellations. A cancelled deletion request never restarts renewal already stopped. Target/explanation/status updates must reflect durable server state.
6. Add backup/tombstone/restore handling and provider-retention evidence; do not promise immediate expiry from all backups. Retention decisions must be specific to data and purpose, preserving lawful records without retaining all dog history indefinitely.
7. Align final in-app text and privacy policy with tested operational behaviour. Draft wording must not become an effective promise ahead of a functioning service.

## Required synthetic verification

Authenticated repeated requests/cancellations; fresh-auth and stale-session handling; duplicate/concurrent workers; processing-lock races with direct client writes, Admin writes, transfers, reminders and signed media uploads; pagination and nested data; legacy/ambiguous ownership; preservation of the new owner's vaccination/worming/photos/documents; subscription mismatch/provider failure/renewal readback; worker crash/retry and Auth deletion failure; backup restore tombstone replay; no cross-account deletion; no real production SDK fallback or real SMS/email.

## Other current portal state

Owner-entered reviewer username/password/contact phone were checked only for non-empty presence; Save disabled indicated no pending edits. No credential values were read or copied. Actual reviewer-login QA is still unverified.

App Privacy draft now contains 11 types: Name, Email Address, Phone Number, Physical Address, Other Financial Info, Photos or Videos, Customer Support, Other User Content, User ID, Purchase History and Product Interaction. Each is drafted as App Functionality / identity-linked / not tracking. This is a source-derived draft, not a complete provider/configuration audit. Do not publish until effective policy, processor retention/log collection, marketing/analytics use and the final binary are reconciled. Privacy Policy URL remains unconfigured. The Publish button being available is not a release PASS.

Age 18+, free download and Australia-only initial availability are saved and approved; do not request those decisions again. No App Store submission or production backend/Rules/billing/deletion changes occurred.
