# ClickSend production integration checklist

This package prepares iDogs to switch the SMS provider from AWS SNS to ClickSend. It does not change Vercel production environment variables and it does not deploy production.

## Required production environment variables

Set these only during an explicitly approved production cutover:

- `SMS_PROVIDER=clicksend`
- `CLICKSEND_USERNAME=<ClickSend API username>`
- `CLICKSEND_API_KEY=<ClickSend API key>`
- `CLICKSEND_SOURCE=iDogs`

Optional, only after the Australian Sender ID is registered/approved:

- `CLICKSEND_SENDER_ID=iDogs`

Do not commit API credentials to GitHub. Keep the existing AWS SNS variables during the initial cutover window so rollback can be performed by changing `SMS_PROVIDER` back to `aws_sns` without a code rollback.

## Pre-deploy gate

1. Exact integration SHA is approved.
2. Worktree/source is clean and matches the approved SHA.
3. `scripts/test-sms-provider.mjs` passes.
4. `scripts/test-sms-addon-v1.mjs` passes.
5. `scripts/test-reminders-batch-regression.mjs` passes.
6. `scripts/test-cron-auth.mjs` passes.
7. `scripts/test-webhook-handler.mjs` passes.
8. `npm run build` passes.
9. No `api/qa-sms-*` endpoint exists in the production package.
10. No QA workflow that can send a real SMS is present.

## Production cutover sequence

1. Add ClickSend production env variables in Vercel only after explicit approval.
2. Keep `CLICKSEND_SENDER_ID` unset until `iDogs` Sender ID approval is confirmed.
3. Deploy the exact approved SHA to a production-project Preview first if a fresh production-env-compatible Preview is required.
4. Verify provider configuration without sending a broad reminder batch.
5. Promote/deploy production only after separate explicit approval.
6. Run one tightly scoped production smoke test if separately approved.
7. Verify provider accepted the SMS, `smsCreditsUsed` increments once, `smsDeliveries` is `sent`, and duplicate idempotency does not send/charge twice.

## Rollback

If ClickSend fails after cutover, set `SMS_PROVIDER=aws_sns` and redeploy using the same code package. Quota, idempotency, audit, AU mobile validation, and refund behavior remain provider-independent.
