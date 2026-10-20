# Account deletion: proposed scope for owner review

Status: superseded by owner-approved v2 direction on 19 October 2026. The request/status/cancellation endpoint and operator review queue are implemented in the candidate. Permanent deletion is not enabled; no real account, billing or Rules changes have been performed.

## Approved v2 direction

Tony approved the revised recommendation in chat: no mandatory 30-day wait; request processing as soon as possible with honest status; explicit recent authentication and confirmation; protection of transferred/pending/shared records; separate cancellation/refund handling; public passport/media/backup inventory; explicit request cancellation rather than cancellation on login. The historical proposal below is retained for context only. Its 30-day default is NOT the approved behavior.

## Concrete implementation boundary

Settings now sends authenticated requests to `/api/account-deletion`, with server-owned idempotent state, five-minute `auth_time` checks and token revocation checking. `GET` returns only the caller's public request status; `POST` accepts request/cancel, never caller-supplied target UID. Transactions prevent duplicate requests and cancellation after processing starts. The old `useAuth.deleteAccount` and `deleteUserData` destructive helpers were removed.

Super Admin → Account Deletions reads the operator queue and a conservative ownership classification. This is not a complete deletion inventory, is labelled incomplete, and has no fabricated completion button. Requests have explicit inventory/billing/write-freeze holds. Current Firestore default-deny protects the request collection without changing Rules.

## Remaining deployment and execution gates

The native production shell calls `https://idogs.com.au/api/account-deletion`. Tony approved isolated backend SHA c09f87f58808784334b8521c681dcbb95918f39e; it was deployed and live synthetic request/readback/duplicate/cancel QA passed in run 39204547050. Later production SHA 8941cff8737140c024f35e8bde115107fa84cc4c preserves that backend together with web improvements. Do not redeploy the older snapshot over newer production work. IMG_7718 confirms the native UI can read No request; it does not establish successful submission or deletion completion.

Permanent processing still requires a complete records/media/provider inventory and a verified write freeze across Firestore Rules, Storage Rules and Admin-SDK APIs. Disabling Firebase Auth alone does not immediately stop already-issued Firestore tokens. Rules/Storage configuration and production changes remain owner-gated; none are bundled silently into this candidate. No permanent processor or scheduled deletion job is enabled. This boundary is NOT App Store-ready account deletion and must not be described as such.

## Historical defect — destructive helpers now removed

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
