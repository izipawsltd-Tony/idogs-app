# Storage recovery and deletion policy candidate

Evidence: owner-supplied Google Cloud Configuration screenshot on 25 October 2026, exact idogs-app.firebasestorage.app bucket; Singapore (asia-southeast1), soft delete seven days, object versioning off, bucket retention policy None. Screenshot remains private and is not committed. This is a configuration snapshot, not an object/version/backup inventory or production deletion test.

Google documentation: https://docs.cloud.google.com/storage/docs/soft-delete and https://docs.cloud.google.com/storage/docs/json_api/v1/objects/delete. Soft-deleted objects remain recoverable during their retention period; the object's hardDeleteTime determines permanent deletion. Existing deleted versions retain the policy that applied when deleted. Do not disable protections or infer historical versions/exports are absent from current settings.

## Emulator flow

Require explicit synthetic storageRetentionSeconds evidence (integer 0–90 days); missing evidence holds before destructive operations. Persist the period with the plan; a changed or missing bound period holds rather than silently changing an in-progress job. Every media receipt needs a valid removal timestamp. The latest receipt time plus the bound period defines a conservative earliest review time; retries reuse receipts instead of restarting the clock.

After active records/media removal and residual verification, keep the request processing/waiting_for_storage, Auth disabled and confirmation unsent until the period has elapsed. Time alone is insufficient: a separate synthetic storageRecoveryVerified check is required before final Auth removal and confirmation. This is a synthetic adapter contract, not actual Cloud Storage verification. It must never be wired to a live constant true or derived solely from wall clock time.

The public status exposes only a valid storageReviewAfter during processing/waiting_for_storage. UI states deletion remains incomplete and that the review date is not an erasure guarantee. Cancellation remains unavailable once processing starts. Auth revocation means the former account may no longer access the in-app status; production requires an independently verified confirmation/status communication mechanism before activation.

## Policy candidate

Shared Settings/Privacy/Terms content distinguishes the seven-day request target from seven days of file recovery after each deletion. It documents known Singapore resources, recovery copies, restricted retained records and proposed restore replay safeguards. Privacy also explains optional first-party marketing consent separately from essential service messages. All content remains draft/not effective until live fulfillment and provider retention/disclosures are verified.

## Remaining production requirements

No live worker, dispatcher, provider adapter, renewal stop, email confirmation or Rules deployment is enabled. Real storage verification must inventory relevant generations/soft-deleted copies and object holds, establish actual hardDeleteTime, cover historical policy periods, and verify no restored/recreated copy reappears. External exports, provider-held copies, signed upload draining, operational Auth fencing, scalable inventory and retention decisions still require implementation and review. Final account communication must work after Auth revocation. Screenshots and a new signed iPhone candidate remain separate release work.
