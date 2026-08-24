# iDogs SMS Add-on Product Spec V1

Status: Build contract
Product: idogs.com.au
Feature branch: feature/sms-addon-v1
Baseline SHA: 42bd976dc89e881206f0738b1051897479b55258
Pricing decision: AUD $3/month SMS add-on
Initial included allowance: 20 SMS segments per billing month
Scope: Australia only, transactional reminders only

## 1. Product goal

Give iDogs users a paid SMS reminder channel for time-critical breeding and health events. SMS complements the existing in-app/email reminder engine; it does not replace it.

Primary V1 value proposition:
Never miss a critical breeding or health date.

Priority order:
1. Breeding cycle: heat cycle -> mating -> pregnancy -> whelping.
2. Vaccination.
3. Worming.

Out of scope for V1:
- marketing/bulk SMS campaigns
- inbound/two-way SMS
- breeder-to-buyer promotional messaging
- international destinations
- MMS
- unlimited SMS
- rollover credits
- push notifications

## 2. Pricing and quota

- SMS Add-on price: AUD $3/month, charged through Stripe as an add-on subscription item.
- Included allowance: 20 SMS segments per billing month.
- 1 credit = 1 provider-billed SMS segment, not 1 logical reminder.
- Credits do not roll over.
- V1 does not auto-purchase overage.
- When quota is exhausted, further SMS sends fail closed while in-app/email reminders continue.
- UI warns at >=80% usage and at 100%.
- Extra credit packs are deferred to a later version.

The quota reset boundary follows the add-on Stripe billing period, not calendar month.

## 3. Eligibility and entitlement

SMS sending is allowed only when all are true:
- authenticated iDogs account has SMS add-on entitlement active;
- add-on subscription is not cancelled/expired;
- Australian mobile number is present and valid;
- remaining SMS credits are sufficient for the actual segment count;
- reminder event is a supported transactional type;
- reminder has not already been sent for the same idempotency key/window.

SMS entitlement and usage counters are server-owned fields. Browser writes must not be able to:
- activate sms add-on;
- alter subscription identifiers/status;
- increase quota;
- reduce used credits;
- reset billing period.

## 4. Supported reminder events

### 4.1 Heat cycle
Source: existing heat-cycle/reminder data.
Default lead: existing user heat reminder lead time, default 14 days.
Send once per predicted/recorded heat event within the active window.
Do not repeatedly send daily unless a future explicit SMS-frequency setting is introduced.

### 4.2 Mating
Source: recorded mating date / litter matingSuspectedDate / validated breeding event.
V1 reminder candidates:
- mating day reminder if user records future planned mating;
- optional follow-up reminder 2 days after mating for a repeat mating/check.
Only create/send when there is a concrete stored date. Do not invent dates from breed assumptions.

### 4.3 Pregnancy
Source: mating date / litter expected due date and explicit pregnancy-related date.
V1 reminder candidates:
- pregnancy check/ultrasound reminder around day 28 after mating when a mating date exists;
- pregnancy follow-up reminder can be represented as an explicit reminder record.
The system must label inferred dates as estimates.

### 4.4 Whelping
Source: litter expectedDueDate.
Default SMS reminder: 7 days before expected due date and 1 day before.
Only one SMS per configured milestone.
If actualBirthDate is recorded, future expected-whelping SMS for that litter must stop.

### 4.5 Vaccination
Source: vaccineRecords.nextDue.
Use existing reminder window.
Send one transactional SMS per due record/window.
Overdue records may still send once if not previously sent for the active due date.
Superseded vaccine records must not send.

### 4.6 Worming
Source: wormingRecords.nextDue.
Same safety rules as vaccination.
Send one transactional SMS per due record/window.
If a newer worming record supersedes the older due cycle, old reminder must be completed/suppressed.

## 5. Reminder engine rules

- SMS is an additional channel on the existing reminder engine.
- Email and in-app behavior must continue when SMS is unavailable, disabled or quota-exhausted.
- Every SMS send must use an idempotency key derived from tenant + event type + source record + due/milestone date.
- Cron retries must not double-send or double-charge credits.
- Provider failure must not consume a successful-send credit unless provider accepted the message.
- Concurrent cron executions must not overspend quota.
- A completed/cancelled/superseded event must not send.
- Ownership rules must follow currentOwnerId behavior already used by the reminder engine.
- Transferred dogs must not continue sending reminders to the former owner.
- No raw SMS body or full phone number is required in long-term usage logs.

## 6. SMS segmentation

Before sending, calculate GSM-7/UCS-2 segment count.
Templates should avoid emoji and non-GSM characters where practical because Unicode can reduce per-segment capacity.
Quota is deducted by segment count actually estimated/sent.
Templates should target a single segment.

## 7. Data model

### users/{uid} server-owned SMS billing fields
- smsAddonStatus: 'active' | 'inactive' | 'past_due' | 'cancelled'
- smsStripeSubscriptionItemId?: string
- smsStripePriceId?: string
- smsPeriodStart?: string
- smsPeriodEnd?: string
- smsCreditsLimit: number (V1 = 20)
- smsCreditsUsed: number
- smsLastBillingEventAt?: string

Existing legacy smsAddon boolean may be read only for migration compatibility but must not be the final entitlement source.

### smsDeliveries/{id}
Server-owned audit/idempotency ledger:
- tenantId
- dogId?
- litterId?
- eventType: 'heat_cycle' | 'mating' | 'pregnancy' | 'whelping' | 'vaccination' | 'worming'
- sourceRecordId
- milestoneKey
- idempotencyKey
- segmentCount
- status: 'reserved' | 'sent' | 'failed'
- provider: 'aws_sns'
- providerMessageId?
- createdAt
- sentAt?
- failedAt?
- errorCode? (sanitized)
- periodStart

Do not store full SMS body. Do not store full recipient phone in this ledger.

### reminder records
Extend type support so reminder types are canonical:
- vaccination
- worming
- heat_cycle
- mating
- pregnancy
- whelping
- vet_appointment
- custom

Legacy values such as 'vaccine'/'heat' must remain readable during transition.

## 8. UI

### Billing & Plans
Add SMS Add-on card:
- title: SMS Reminders
- price: $3/month
- copy: 20 SMS credits/month
- supported events summary
- current status
- usage: X / 20 SMS credits
- usage progress indicator
- 80% warning
- exhausted-state warning
- Subscribe / Manage button

No checkout button should be shown as operational if server configuration for the Stripe SMS price is missing.

### Settings > Reminders
Add SMS section:
- SMS Reminders toggle/status linked to paid entitlement, not a client-writable entitlement flag
- mobile number display/edit through existing profile mechanism
- supported reminder categories
- explain that one long/Unicode SMS can use more than one credit
- link to Billing to activate/manage add-on

### Reminders page
Show channel badges where useful:
- In-app
- Email
- SMS available/active
Do not block reminder list if SMS usage API fails; fail SMS status independently.

## 9. SMS templates

Templates should be plain text, concise, Australian English, and aim for one GSM-7 segment.

Heat:
iDogs: {Dog} heat cycle expected {date}. Review her breeding record and prepare if needed.

Mating:
iDogs: {Dog} mating reminder for {date}. Check the breeding plan in iDogs.

Pregnancy:
iDogs: {Dog} pregnancy check is due {date}. Review the breeding plan in iDogs.

Whelping 7-day:
iDogs: {Dog} expected whelping date is {date} - about 7 days away. Review your whelping plan.

Whelping 1-day:
iDogs: {Dog} expected whelping date is {date}. Please review your whelping plan today.

Vaccination:
iDogs: {Dog} vaccination {Vaccine} is due {date}. Please arrange with your vet if needed.

Worming:
iDogs: {Dog} worming is due {date}. Check the recorded treatment schedule in iDogs.

Avoid clinical certainty. Estimated breeding dates must be described as expected/estimated.

## 10. Provider and compliance

V1 uses the existing AWS SNS / AWS End User Messaging SMS path.
Australian recipients only.
Sender ID target: iDogs.

Production release is blocked until the sender ID/compliance path is verified for Australia and the required AWS sender-ID registration status is acceptable.
As of the build date, AWS documents that Australian alphanumeric Sender IDs require ACMA registration from 1 July 2026; unregistered IDs may be labelled Unverified, use a shared long code, or be blocked.

No provider credentials or Vercel environment variables are changed as part of normal code implementation without explicit approval.

## 11. Stripe integration

Add-on must be represented by a dedicated Stripe recurring Price.
Server config keys:
- STRIPE_SMS_ADDON_PRICE_ID
- STRIPE_SMS_WEBHOOK_SECRET

Checkout/update logic must:
- authenticate user;
- never trust client-supplied arbitrary price IDs;
- allowlist the configured SMS price;
- create the SMS add-on as an isolated recurring subscription on the same trusted Stripe Customer as the base iDogs Plus subscription;
- never replace, downgrade, or mutate the base iDogs Plus subscription from SMS billing code;
- update SMS entitlement only through the isolated trusted SMS webhook handler.

If SMS Stripe Price/env is absent, APIs fail closed with a configuration error and UI shows unavailable/not configured rather than granting access.

## 12. Security

- send-sms endpoint must not remain an unauthenticated arbitrary phone/message relay.
- Direct SMS sends must require trusted internal auth or authenticated + authorized structured request.
- User cannot submit arbitrary message text for V1 reminder sends.
- Firestore Rules protect all SMS billing/quota fields from client writes.
- smsDeliveries is server-write-only; user may only read their own summary if exposed through a server API.
- error responses/logs must not expose provider secrets or raw internal errors.

## 13. Acceptance tests

### Entitlement/security
1. Client cannot set smsAddonStatus active.
2. Client cannot reset smsCreditsUsed.
3. Client cannot write smsDeliveries.
4. Unauthenticated direct POST to SMS endpoint cannot send.
5. Arbitrary phone/message relay is rejected.
6. Missing Stripe SMS price fails closed.
7. Inactive/past-due/cancelled add-on cannot send.

### Quota/idempotency
8. Active user with 0/20 can send eligible reminder and usage increments by actual segments.
9. 19/20 + one segment succeeds -> 20/20.
10. 20/20 blocks next send without affecting email/in-app.
11. Two concurrent attempts for same idempotency key produce at most one provider send/charge.
12. Retry after provider-accepted response does not double-charge.
13. Multi-segment message consumes matching credits.
14. Billing-period rollover resets usage only through trusted server billing logic.

### Reminder behavior
15. Vaccination due event sends once.
16. Superseded vaccination does not send.
17. Worming due event sends once.
18. Superseded worming does not send.
19. Heat event sends once within configured lead window.
20. Mating reminder requires a concrete stored date.
21. Pregnancy estimate is labelled estimated and requires mating date.
22. Whelping reminders fire at configured 7-day/1-day milestones only once each.
23. actualBirthDate suppresses later expected-whelping reminders.
24. Transferred dog does not send to former owner.

### UI
25. Billing shows $3/month and 20 credits/month.
26. Usage shows X/20 and warnings at >=80% and exhausted.
27. Settings links non-subscribers to Billing.
28. SMS API/status failure does not break normal Reminders page.
29. Mobile layout is usable at common iPhone viewport widths.

### Regression/build
30. Existing email reminders continue.
31. Existing in-app reminders continue.
32. Existing vaccination reminder behavior remains compatible.
33. Existing heat reminder behavior remains compatible.
34. npm build passes.
35. git diff --check passes.
36. Existing targeted reminder/billing/security tests pass.

## 14. Deployment gates

1. Branch starts from exact live SHA 42bd976dc89e881206f0738b1051897479b55258.
2. Code + tests first.
3. Preview deploy to idogs-app-staging project only.
4. Verify Vercel metadata: correct project, READY, target preview, exact Git SHA.
5. Browser QA on Preview.
6. User approval required before promoting stable staging.
7. Firestore Rules deployment requires separate explicit approval if rules changed.
8. Stripe product/price or environment changes require explicit approval.
9. Production requires separate explicit approval.
10. Before production, report master/feature drift and reconciliation plan; do not force-push/rebase/squash.
11. After production, restore worktree Vercel link to idogs-app-staging.
