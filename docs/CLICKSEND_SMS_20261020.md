# ClickSend migration — owner-gated activation

Candidate is based on production 8941cff8737140c024f35e8bde115107fa84cc4c.
Both the daily scheduler and trusted internal relay now use ClickSend REST v3.
Email delivery, Stripe entitlement, monthly 20-credit quota and ownership filters remain unchanged.

## Server configuration (owner action)

Set `CLICKSEND_USERNAME` and `CLICKSEND_API_KEY` directly in the hosting secret
settings, separately for Preview and Production. Never paste API keys in chat,
source, VITE variables, screenshots or logs. No environment values were changed
by this migration. No account provisioned, credit purchased, or live SMS sent.

The transport uses the ClickSend account's approved default sender. Configure
and validate that sender in ClickSend before live QA; this code does not assume
the iDogs alpha tag is approved. Account activation, available credit and any
sender requirements must be checked in the account. New accounts may need URL
messaging approval because existing reminder templates include links.

## Acceptance and retries

HTTP 200 alone is not acceptance. Both the operation and individual message
must report SUCCESS and return a message ID. Accepted means queued, not delivered
to a handset. Verify a delivery receipt or owner handset receipt for live PASS.

Definitive rejections refund the reserved credit. Timeout, network failure,
malformed responses, throttling or ambiguous HTTP errors retain the existing
reserved ledger entry; future runs skip it. `custom_string` is an opaque delivery
ID for reconciliation, not a provider idempotency guarantee. No automatic POST
retry or SNS fallback is used. Before releasing an ambiguous reservation, check
ClickSend history/receipts for that reference; do not blindly resend it.

Existing `aws_sns` history and reserved/sent IDs are preserved. New ledger entries
record `clicksend`; the existing internal status `sent` means provider acceptance.
No delivery-receipt webhook or automatic reconciliation job is enabled here.
The internal relay remains cron-only and has no ledger; do not retry an ambiguous
relay call. The scheduler sends through the quota/ledger path directly.

## Release gates

1. Exact candidate SHA → CI PASS → Preview READY.
2. Configure Preview credentials securely and approve one bounded live SMS test.
3. Confirm handset receipt and quota/ledger behavior with an entitled QA account.
4. Recheck live production SHA before presenting a release candidate; integrate
   newer production changes if needed. Production requires Tony's exact-SHA approval.

Official API reference: https://developers.clicksend.com/docs/messaging/sms
# Bounded staging QA reminder (20 October)

Settings contains a temporary control backed by `/api/staging-sms-qa`.
It requires all of: the exact staging Vercel project, Preview environment,
staging Firebase credentials/app, authenticated allowlisted QA UID, the approved
account mobile, a current active entitlement with exactly one unused credit,
and a time before 21 October 2026 00:00 UTC. Production fails closed with 404.
Neither phone nor message can be supplied by the browser. No production release
or subscription purchase is needed to exercise this owner-approved staging test.

GET only reports state. An explicit POST sends one fixed GSM-7 reminder with no
URL or real animal health information. A shared Firestore attempt document is
claimed transactionally before the normal SMS quota/delivery ledger is used.
The attempt remains consumed on success, rejection, timeout or uncertain result;
do not delete/reset it to retry without reconciling provider history and renewed
owner approval. No scheduler or unrelated tenant is invoked. Acceptance still
requires handset confirmation and does not verify link-bearing templates.

