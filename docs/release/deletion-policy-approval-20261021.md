# Owner-approved deletion business rules — implementation candidate

Tony explicitly approved both operating principles on 21 October 2026:

1. Aim to complete an authenticated deletion request within seven calendar days; when blocked, provide a specific update explaining the outstanding checks and next update date within that period. No mandatory 30-day wait.
2. Arrange and verify stopping future web-subscription renewal on acceptance, without waiting for data cleanup. Cancellation takes effect at the end of the paid period. Cancelling deletion does not restart renewal. No automatic refund promise or new charge is authorized.

This approval supersedes the pending business-rule decision in earlier review drafts. It authorizes implementation and synthetic testing. It does not authorize live Stripe mutations, real permanent deletion, Rules/Storage deployment, publication of effective terms, PR merge or App Store submission/release.

## This increment

- Server-owned accepted time, seven-day processing target and next update due time, bound to request revision. Duplicate requests never reset them; legacy receipts gain no invented dates.
- Durable renewal task saved atomically with the request/support receipt. Cancellation preserves that work and cannot issue a restart. Provider execution is explicitly disabled.
- Emulator-only renewal rehearsal: complete provider discovery, all account subscriptions existing at acceptance, durable snapshot, lease/epoch, stable cancellation keys and readback, restart/lost-response recovery, exclusion of later subscriptions and stale-revision protection. No live SDK, route or scheduler dispatches this work.
- The app can display server targets and allowlisted renewal status, including pending or review-required. Pending does not mean cancelled. Old production responses remain compatible. Effective policy publication remains gated.

## Boundaries and next deployment review

This does not complete permanent deletion or the seven-day operational service. Global write fencing, complete current-ownership/media inventory, provider retention and restore/tombstone procedures remain required before irreversible processing. Status-update/escalation operation and real provider cancellation require further implementation and verification before the full commitment can become effective.

The backend request/task candidate must be separately approved for production deployment at its exact tested SHA. Such deployment alone must not be advertised as automatic renewal cancellation or App Store deletion readiness. No spending, provider setting, email/SMS or real dog data is changed by this increment.
