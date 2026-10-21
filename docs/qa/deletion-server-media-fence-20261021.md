# Server mutation and media upload fences

## Scope

Stacked on PR #33 source `22126d916a43485df925a3f34f8720dde6cd4926`; this is a review candidate, not a production deployment. No frontend, Rules, Storage configuration, environment, billing provider or public policy is changed.

- Transaction-scoped account fences now protect dog creation/status/cap reconciliation, litter creation/update/removal/puppy management, heat cycles, private access, Showcase mutations and transfer/claim. A claim checks the incoming buyer and each committed current owner before any ownership writes. A former breeder's frozen account does not freeze a dog already owned by its recipient.
- Frozen requests return a client-safe 409 with `ACCOUNT_WRITES_FROZEN`. Read-only history/access checks and account-deletion status/cancellation remain accessible through their existing authorization.
- Document, profile, note and legacy Showcase uploads create a server-owned `accountMediaOperations` record before sending bytes. Paths are unique per upload; profile uploads no longer overwrite the previous object's path. The operation is bound to UID, dog, bucket, path and kind. A final transaction rechecks the current owner, transfer state and fence alongside the document/profile/gallery reference and operation receipt.
- Lost Storage responses and rejected final commits retain `uploading` or `cleanup_required` evidence. A failed operation does **not** automatically delete objects. Lost final Firestore responses use transactional readback so an already-committed reference is preserved. Generation metadata is recorded when available; missing generation never becomes a fabricated cleanup receipt.
- Direct signed upload grants check owner/fence within quota reservation. Confirmation rechecks the fence in its final transaction. A frozen confirm keeps the existing pending grant/object instead of claiming it was cleaned. A signed PUT issued earlier can remain usable until expiry; the inventory now records that open window even for a rejected grant.
- Inventory discovery includes account media operations by UID and linked dog, operation state/generation and profile photo paths. Unresolved operations and live/unknown signed upload windows add explicit holds. Inventory completeness and permanent deletion remain false.

## Local verification

249 application tests, 44 request/processor tests, ten dog-creation retry/concurrency checks and TypeScript/Vite build passed. The targeted suite passed 36 cases using real loopback Auth tokens, actual endpoint handlers, Firestore transactions and Storage emulator objects. It covers frozen API mutations, a healthy create/status path, buyer/seller freeze behavior, upload response contracts, freezes/ownership changes mid-upload, ambiguous Storage/Firestore responses, replacement objects, gallery reorder and signed-grant windows. Full inherited emulator regression and exact-source cloud results are recorded in the Draft PR after execution.

## Limits observed during QA

- Storage Emulator reports that ACL operations are no-ops. Its success does not prove live `makePublic` behavior. The replacement-object test also exposed that the attempted delete preconditions could not be relied on in this emulator run; automatic failure cleanup was removed instead of claiming it was verified. Objects remain durably inventoried for a separately verified cleanup workflow.
- Cross-service writes cannot be made atomic with Firestore. Uploads begun before freeze may still place bytes in Storage. This increment blocks new reservations/reference commits and preserves unresolved work; it does not prove all in-flight external work has drained. Do not start permanent cleanup while unresolved operations or signed windows remain.
- Existing gallery-removal and direct-grant validation/expiry cleanup paths still need a complete shared-reference/generation review. Their prior cleanup behavior is not promoted to proof of safe permanent account deletion by this increment.
- Billing/webhook reconciliation, scan quotas, finance/support/admin writers, reminder/provider dispatch and other service paths still need separate account-deletion participation review. No global write-freeze claim is made.
- Backup restore/tombstone replay, full object/version/shared-history inventory, actual provider retention and operational seven-day updates remain open. No irreversible worker or automatic provider cancellation is enabled.

## Release boundary

Publish only a Draft PR/Preview and its checks. Do not promote this stacked branch over production, deploy Rules/Storage, merge, mutate live Stripe, delete real data or submit/release the App Store app without their separate approvals. This backend-only increment does not create a new native TestFlight build or a physical-iPhone QA result.
