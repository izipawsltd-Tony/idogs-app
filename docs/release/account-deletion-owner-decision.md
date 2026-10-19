# Account deletion: proposed scope for owner review

Status: proposal only; no deletion endpoint, data mutation or legal policy has been enabled.

## Confirmed defect

`useAuth.deleteAccount` calls `deleteUserData` before Firebase Auth deletion. A recent-login failure can therefore follow partial data deletion. The helper selects dogs by original `tenantId`, despite `currentOwnerId` being the current ownership source, and deletes linked records without checking their current ownership. It has no storage cleanup or durable retry ledger. Settings currently has no deletion initiation path. Do not connect this helper to a button.

## Proposed product behavior

Settings → Delete account → explain scope → recent password reauthentication → explicit confirmation → authenticated server request with durable status. A request receipt must say requested, never deleted. Show status and allow cancellation before processing begins. No mailto-only flow, real emails, ownership transfers or purchases are needed to request deletion.

The proposed request itself is reversible. Permanent processing remains disabled until the owner approves the retention and billing policy below and the complete processor passes synthetic ownership/race/retry tests.

## Decisions requiring owner approval

1. Retention: retain an account-deletion request for 30 days before permanent processing, matching the current policy draft, with a cancellable request during that period. Confirm that this is the intended policy rather than assuming the old page is authoritative.
2. Shared history: preserve dogs and records belonging to another current owner, including pending transfers, and remove the departing person's private contact details where safe. Define any legally required breeder/history retention separately; do not promise that every historical reference can disappear.
3. Owned data: remove the departing person's private records and media after the retention period only where the deletion inventory proves exclusive ownership. Quarantine ambiguous ownership for review, never delete by original tenant alone.
4. Billing: deletion must not silently leave a recurring charge running. Subscription cancellation/refund behavior and financial-record retention require an explicit billing policy; no Stripe changes or charges are authorized by this proposal.

## Implementation and verification after approval

Use a server-owned idempotent request/status record and a resumable deletion inventory. Verify recent authentication before accepting the request. Validate ownership again at execution, fail closed on races or pending transfers, delete private storage by inventoried object identity, and delete Auth only after required cleanup succeeds. Restrict status reads to the requesting user. Do not log identity tokens, document bodies or personal data.

Synthetic tests must cover current owner versus original breeder, transferred and pending-claim dogs, unrelated tenant records, media ownership, stale authentication, repeated requests, cancellation, partial cleanup retries, billing holds and Auth deletion failure. Review exact retention wording before publishing privacy changes. No destructive QA against Tony's account or real dogs.
