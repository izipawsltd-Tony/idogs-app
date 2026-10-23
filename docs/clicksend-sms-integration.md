# iDogs ClickSend migration — owner gated
Provider decision: ClickSend, NOT AWS SNS (owner instruction 23 October 2026). ACMA approved alphanumeric Sender ID `iDogs` for IZIPAWS PTY LTD on 22 October 2026.
- API: `POST https://rest.clicksend.com/v3/sms/send` with Basic auth username + API key, sender `iDogs`.
- Server env: `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY` (secrets); `SMS_PROVIDER=clicksend`, `SMS_SENDER_ID=iDogs`, `SMS_PROVIDER_ACCOUNT_VERIFIED=true`, `SMS_SENDING_ENABLED=true` (gates). Never set last two until ClickSend account/sender authorization and one owner-approved test.
- The SMS transport returns an AWS-compatible `MessageId` shape solely to preserve legacy `sendSmsWithQuota()` accounting. Provider audit metadata may still say `aws_sns` until subsequently migrated; don't claim it accurately reflects provider.
- Entire new SMS path disabled by default. No live sends, billing changes, or production changes in this PR.
- Need verified ClickSend delivery receipts, per-user SMS preference/consent and real controlled owner-approved test; a queued response is not proof of delivery.
