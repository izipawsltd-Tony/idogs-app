# iDogs SMS sender readiness — owner-gated

## Evidence
ACMA email supplied by owner: sender ID `iDogs` approved for IZIPAWS PTY LTD on 22 Oct 2026. This approves registry entry; it does NOT confirm AWS SNS delivery account authorization, pricing/limits, or any SMS sent.

Source audit: iDogs currently sends via AWS SNS (`api/send-sms.js`, `api/send-reminders.js`) with explicit SenderID `iDogs`. Account reachable via AWS connector on 23 Oct 2026 shows SNS default SenderID `IZIPAWS`, spend limit USD 1/month and zero End User Messaging SenderId registrations in Sydney. The AWS connector account may not be the same account as iDogs Vercel deployment; verify account ID against a trusted, non-secret deployment setting before any write or test. Do not assume changing SNS defaults is necessary: explicit per-message sender ID already exists.

## Guardrail
Staged sender readiness gate requires ALL:
- `SMS_SENDING_ENABLED=true` (explicit owner approval, never inferred)
- `SMS_SENDER_ID=iDogs` (case-sensitive)
- `AWS_SNS_REGION=ap-southeast-2`
- `SMS_PROVIDER_ACCOUNT_VERIFIED=true` (owner-confirmed account and provider readiness)

Do not turn on these variables or send actual SMS before provider verification, target mobile/consent, spend/cost and test-message approval. Billing/webhook and Firebase rules are out of scope. Transactional reminders still require SMS add-on entitlement, quota, per-user delivery consent, and idempotency protections.

## Exit QA
CI unit tests; staging exact-SHA Preview; provider account ownership and AU sender ID status; explicit owner-approved single controlled test SMS to owner; delivery-status evidence; QA duplicate suppression and quota; independent production approval.
