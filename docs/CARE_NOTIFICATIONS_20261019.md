# Care notification increment — 19 October 2026

Base: c6780255a1774032f58e7a8b678446554e3ecc57 (verified live before work).
Branch: fix/care-notification-settings-20261019. PR #27 remains unchanged and unmerged.

## Behavior
- Fix the existing Email Reminders switch so it actually toggles its stored value.
- Add an explicit, default-off manual-reminder email opt-in and ten manual-care email category switches.
- Saved in-app reminders remain available when email is disabled. Existing scheduler behavior also pauses scheduled SMS when the main email switch is off; this increment does not change SMS behavior or enable any SMS.
- Category switches apply only to source=manual reminders. Recorded next-dose vaccine/worming emails retain their existing main switch and scheduler behavior.
- Existing daily GitHub Actions job handles manual emails; no additional cron, env, Rules, billing or provider configuration changes.
- Manual lead time uses each reminder's saved notifyDaysBefore and date-only UTC comparisons. No chosen delivery hour or local-timezone guarantee. Once-only emails catch up no more than 14 days overdue; daily manual emails stop after the due date.
- Require explicit opt-in, matching reminder tenant, current dog owner, valid dates/type/lead, pending/overdue status, and a living non-transferred dog.
- Server-only reminderEmailDeliveries records fall under existing default-deny Rules. Transactional leases suppress concurrent claims. Provider request keys include Firebase project identity, reminder, tenant, dog, due date and daily/once identity. Payload remains stable on retry.
- Provider success is recorded only for an OK response with an email ID (provider acceptance, not proof of inbox delivery). Ambiguous retries stop before 24h provider key expiry; status becomes review_required after 23h or if recipient/content changes. The current daily job may reach that hold on its next run; there is no new frequent retry worker or admin review UI.
- Ownership/status/preferences are read transactionally at each claim. External provider send cannot be atomic with a later ownership transfer; an already accepted email cannot be recalled.
- Declare the already imported SNS dependency, pinned to 3.1152.0, to prevent missing-module scheduler cold starts.

## Validation
- 156 Vitest checks passed, including synthetic full handler execution, all ten categories, concurrent claims, timeout retry keys, 23h stop, preference changes, transfer/completed suppression, daily cutoff, HTML escaping and Settings switch interactions.
- TypeScript/Vite build passed. Existing bundle-size warning remains.
- 20 Node checks passed (account deletion and historical recovery).
- Tests use injected/mock I/O and reserved invalid recipient addresses. No actual provider requests, emails, SMS, production records, transfers or deletions were made.
- Authenticated deployed browser E2E and actual inbox delivery are separate from mocked checks and must not be claimed from these results.

## Release gates
No merge or production release authorized for this new SHA. Re-read production before any approved release, preserving newer backend/iOS work. Native push, iPhone permission handling, recurrence, snooze and reminder editing remain outside this increment.
