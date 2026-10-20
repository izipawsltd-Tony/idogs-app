# Account deletion fulfilment — concrete owner/legal review

Draft only. No public policy, subscription setting, Rules, storage or permanent processor is changed by this document.

## Already approved; do not ask again

No mandatory 30-day delay. Recent authentication and explicit confirmation. Request/status/cancel in the app. Preserve another current owner's data and quarantine ambiguous ownership. No real-data destructive QA.

The request API is deployed and has live synthetic request/readback/idempotency/cancel evidence. The permanent processor remains disabled. A request receipt does not establish that deletion can currently be completed.

## Proposed operational commitment requiring owner approval

Process an authenticated deletion request as soon as practical, with a **target of seven calendar days**. If an ownership, billing or legally required retention check prevents completion within that target, provide a specific status and next update date. Do not require the requester to send a separate email or open a support chat. A login does not cancel a request; cancellation is explicit and possible before processing begins.

This seven-day target is a proposed service commitment, not a statement that every relevant law permits that deadline. It is not active until Tony approves it and an actual fulfilment process is implemented and tested. The existing app makes no completion-date promise.

## Proposed billing disposition requiring owner approval

Proposed rule: for a verified active web subscription, **arrange and verify cancellation of future renewal as soon as a valid deletion request is accepted, without waiting for cleanup; the subscription cancellation takes effect at the end of the current paid period**. Deletion itself need not wait until that period ends. Do not create a new charge or automatically promise a refund; assess refund requests separately, including any applicable rights. Preserve financial records pending a verified retention policy rather than deleting the Stripe customer or invoices.

If provider identity/status or cancellation cannot be verified, retain the request and show a billing hold; do not delete Auth and leave the requester unable to resolve a recurring charge. A request may be submitted while this check is unresolved. Give the requester an update within the proposed target rather than holding silently.

Cancelling a deletion request would not restart a subscription already marked not to renew. Explain that consequence before applying cancellation. This is a proposed business rule requiring owner approval, not a change already made. No Stripe operation, refund, charge, customer deletion or financial retention period is authorized by this document alone; implementation and any production execution remain separately controlled.

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

## Coordinated review revision

Tony authorised preparation of the coordinated draft on 19 October 2026, not publication or activation. The current source-based assessment and unresolved release checks are in legal-policy-review-20261019.md. Shared candidate wording lives in src/components/legal/PolicyReview.tsx and is reused by Privacy, Terms and the app. Seven days is a proposed service target; absolute partial-month refund exclusions, automatic 30-day deletion, blanket Asia-Pacific residency and unsupported compliance certification are removed in the review candidate. None of these copy changes implements permanent deletion or automatic renewal cancellation.
