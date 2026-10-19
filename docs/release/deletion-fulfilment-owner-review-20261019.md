# Account deletion fulfilment — concrete owner/legal review

Draft only. No public policy, subscription setting, Rules, storage or permanent processor is changed by this document.

## Already approved; do not ask again

No mandatory 30-day delay. Recent authentication and explicit confirmation. Request/status/cancel in the app. Preserve another current owner's data and quarantine ambiguous ownership. No real-data destructive QA.

The request API is deployed and has live synthetic request/readback/idempotency/cancel evidence. The permanent processor remains disabled. A request receipt does not establish that deletion can currently be completed.

## Proposed operational commitment requiring owner approval

Process an authenticated deletion request as soon as practical, with a **target of seven calendar days**. If an ownership, billing or legally required retention check prevents completion within that target, provide a specific status and next update date. Do not require the requester to send a separate email or open a support chat. A login does not cancel a request; cancellation is explicit and possible before processing begins.

This seven-day target is a proposed service commitment, not a statement that every relevant law permits that deadline. It is not active until Tony approves it and an actual fulfilment process is implemented and tested. The existing app makes no completion-date promise.

## Proposed billing disposition requiring owner approval

Before permanent cleanup, establish whether a recurring subscription exists. Resolve its future-charge disposition explicitly, preserving the request and showing a billing hold until resolved. Do not treat account deletion as proof of cancellation or refund. No automatic refund, Stripe change, new payment, or financial-record retention period is authorized by this draft. Any cancellation/refund operation remains separately controlled until the applicable policy and execution scope are approved.

A request may be submitted even when a billing check is unresolved. Do not delete the Auth identity and leave the requester unable to resolve a recurring charge.

## Factual privacy corrections for later review/publication

- The public page's automatic permanent deletion after 30 days is inconsistent with the approved request flow and disabled processor. Replace that claim only with an implemented and approved fulfilment policy.
- AI scanning sends the selected document to Anthropic after per-document consent; manual entry remains available. The proposed factual provider disclosure is in ai-privacy-owner-review.md.
- Do not publish the existing blanket Asia-Pacific residency or processor-contract guarantees without verifying the actual infrastructure and provider arrangements.
- Confirm what private data, shared history, backups and provider records can be removed, what must be retained, why and for how long. Do not invent a legally required retention period or promise deletion of all historical references.

## Technical work after the policy decision

Finish the ownership/media/provider inventory; implement a resumable processor with durable receipts, safe retries and a verified write freeze; test race conditions, transferred dogs, billing holds and Auth deletion failures using synthetic emulator fixtures. Production Rules/Storage changes and irreversible real requests remain separate owner gates. A complete request UI alone is not App Store account-deletion readiness.

## Apple references checked 19 October 2026

- https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
- https://developer.apple.com/app-store/review/guidelines/

Apple permits manual processing over a reasonable period, but requires users to be told how long it will take and receive confirmation on completion. This does not establish the proposed target's legal sufficiency or Apple approval of this implementation.
