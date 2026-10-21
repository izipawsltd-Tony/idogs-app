# Cleanup, billing and reminder deletion guards

Stacked on Draft PR #36, source SHA 5c67c0d2a53a370de32e96640aff51bc7a965f59. This is implementation and synthetic QA, not production promotion or authorization to erase real data.

## File cleanup

Gallery removals and profile-photo replacements atomically queue `mediaCleanupTasks` with the trusted object path and generation when known. The trusted current dog may still refer to media uploaded by a previous owner; removing its live gallery reference must preserve transferred history. Cleanup records always require shared-reference/version-retention review. Missing generations are explicit, never inferred from whatever replacement happens to exist at the path later.

Confirmation reads metadata and bytes from the captured Storage generation and stores that generation with the committed gallery item and grant. A rejected/expired confirmation never deletes by path. Closing grants remains transactional, so a cleanup request cannot erase a concurrently confirmed upload. Cron closes expired pending grants, queues review, and retains the grant as `cleanup_review`. This terminal status removes reviewed grants from subsequent bounded cron batches. Malformed expiry stays unresolved. A signed PUT window is inventoried even after grant rejection; expiry alone is not proof that an in-flight upload drained.

No route or cron in this change executes a Storage delete. Actual object deletion remains disabled until exact generations, shared/immutable references, in-flight writes, retained object versions and owner approval are established. This deliberately retains orphan bytes rather than risk deleting another owner's referenced file. The cleanup queue is not proof of physical erasure or provider retention completion.

## Billing/webhooks

Every subscription-effect transaction checks `accountDeletionFences` in the same transaction as its writes. Verified paid reconciliation returns false on a frozen/completed/malformed fence or absent profile, and rejects mismatched customers/stale known-subscription timestamps. Frozen verified events retain minimal `accountBillingEvents` receipts requiring financial review; they cannot reactivate a dog, reset quota, recreate a user or grant Extra Litter credits. Stripe signature verification, event leases and duplicate handling remain in place. One-time asynchronous paid success uses the same credit checks.

Checkout, portal, SMS add/remove and Extra Litter factories dispatch through a server-side operation journal supplied by their production entrypoints. A second fence check happens before the provider call. A call already past that check remains a deletion drain obligation until a confirmed response is recorded. Provider failure/lost responses remain `review_required`; no timeout silently declares them complete. Late receipts update existing workflow documents only. They do not recreate user profiles or absent operation documents. No new Stripe key, API version, live subscription mutation, charge, refund or provider cancellation was used for QA. Existing already-issued checkout/portal sessions need provider-side expiry/review before permanent deletion; local dispatch gating cannot revoke them.

The inherited webhook entrypoint imported non-existent `verifiedPlusInterval`/`reconcileVerifiedPlusSubscription` names; it now uses the actual paid-reconciliation exports. The inherited optional Extra Litter checkout had a missing tax helper import. Its explicit mode-specific GST configuration now fails closed when missing (`STRIPE_GST_TAX_RATE_ID` or `STRIPE_TEST_GST_TAX_RATE_ID`), while the existing checkout-enable flag remains unchanged. No rate, registration, price catalogue or environment setting was created/changed. Enabling that separate flow requires a verified inclusive GST rate in the correct Stripe environment.

## Reminders

Manual claims check the account fence, then revalidate committed profile opt-in/category settings, reminder contents, current dog owner and transfer state before dispatch. Legacy cron writes use fresh owner/fence transactions, so a stale scan cannot regenerate reminders or update a transferred dog's source records. All email/SMS dispatches use durable external-operation admission. Legacy email uses a deterministic per-day/content key to suppress duplicate admissions. Manual email retains its existing Resend key and bounded retry semantics; unresolved earlier attempts remain visible for review even if a later idempotent retry succeeds.

SNS ambiguous failures keep the charged reservation and never automatically resend/refund, because SNS does not provide the Resend idempotency contract. Missing MessageId is also unconfirmed. Receipt/control-plane bookkeeping may finish after freeze, but quota refunds cannot recreate or modify frozen/missing user profiles. Inventory adds unresolved external operations, reminder deliveries, billing receipts and cleanup tasks as explicit holds, and discovers credits by their real `purchasedByUid` field.

A provider cannot join a Firestore commit: a freeze after the last check may overlap an admitted send. The durable drain hold captures this; it is not a claim that previously accepted emails/SMS can be recalled. Retention of provider messages, financial receipts, manual-email payloads, backup/restore/tombstone replay and live Storage ACL/version behavior require separate operational evidence. Permanent deletion remains disabled.

## Validation

Synthetic project only: `demo-idogs-account-deletion`, loopback Auth 9099, Firestore 8080, Storage 9199. The test entrypoints reject other projects/hosts before RPC. No real Firebase account, Stripe operation, email, SMS, dog or file was mutated.

The new emulator suite exercises frozen/completed/malformed verified events, duplicate delivery, missing-profile resurrection, stale reconciliation, paid-credit suppression, every billing mutation factory, cancellation between operation admission and dispatch, in-flight drain holds, lost provider responses, duplicate email admissions, late receipts after journal removal, transfer/freeze reminder writes, manual opt-out after claim, SNS ambiguity, shared/transferred gallery bytes, cron/grant races and configuration refusal before transport. The inherited actual Auth/Firestore/Storage handler suite also verifies profile replacement queues the prior generation without erasing its bytes. Unit fakes were corrected to implement Admin snapshot `exists`, update and auto-ID behavior; the emulator caught a real `doc(undefined)` issue that the old fakes hid.

Local validation passed: 250 app tests, 44 request/processor tests, 247 full inherited/new emulator tests (34 new), 88 webhook checks, 36 billing security checks, 11 billing API checks, 25 SMS checks, seven Extra Litter webhook checks, seven Extra Litter checkout checks, ten dog-creation checks and TypeScript/Vite build.

Cloud CI/Preview evidence is recorded in the Draft PR after exact-source validation. Storage emulator ACL methods are no-ops; it does not establish live object retention or generation-precondition enforcement. Preview read-only smoke is not real-account QA or physical iPhone QA. No merge, production deploy, Rules/Storage configuration change, new TestFlight upload or public release is included.
