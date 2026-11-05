# Cloud Auth HTTP QA PASS; dedicated email credential owner gate

Verified 26 October 2026 (Australia/Adelaide). Branch release/ios-app-store-20261025, source 42bba5a11840d2626c9d7411e2c486fe4f2adc5f, PR #62.

## Evidence

Workflow 40237508500, job 121302100060: cloud fixture step succeeded with `isolated_cloud_permanent_deletion_pass` and `cleanupVerified: true`. The overall job deliberately failed at the separate final step `Owner gate - dedicated Resend QA credential`, reporting `IDOGS_DELETION_RESEND_QA_KEY_MISSING`. Do not describe this overall workflow as green.

Before cloud writes, 32 scope/provider/provisioning/Auth-HTTP/email guard tests and 38 actual emulator integration tests passed. Both CI runs 40237512305 and 40237508499 succeeded. TestFlight was skipped, so there is no new signed iPhone candidate from this change.

The harness discovers only the existing staging Firebase web-app public SDK config through the management API, mints a custom token for its nonce-bound Auth fixture, exchanges it for a real Google-issued Firebase ID token, verifies signature/revocation/UID/audience/issuer, and exercises the actual `makeDeletionHandler` over runner loopback HTTP. No token or API key is logged or written to an artifact.

Verified: anonymous/invalid token rejected; authenticated initial status uses private/no-store; request and duplicate request persist without resetting time; the frozen user's existing token is rejected; after permanent Auth deletion that token is also rejected. The full real-cloud Firestore/file-generation/Auth deletion, Test renewal stop, interruption/replacement-worker retry, duplicate completion, unrelated owner sentinel and cleanup all passed again. This does **not** verify a public deployment, a browser/iPhone login, email/password sign-in or signed provider webhook delivery.

An initial QA assertion incorrectly expected `localId` in the custom-token exchange response. Google documents only kind/idToken/refreshToken/expiresIn/isNewUser. The assertion now binds identity to verified token claims; a regression covers the actual response shape and rejects wrong UID/audience/issuer. The initial fixture run was completely cleaned up.

## Prepared email verification

`scripts/qa/deletion-email-sink.mjs` is an operator-only adapter, not imported by a deployed API. It checks the durable fixture manifest, prior Auth freeze/removal intent, actual missing Auth user, missing graph records and missing media before a provider request. Recipient is hard-coded to Resend's documented `delivered@resend.dev` simulation address; sender is the existing `iDogs <noreply@idogs.com.au>`. No recipient parameter or real customer email is accepted.

Requests use stable idempotency keys and a durable exact-message receipt in the existing fixture job. Verification reads only that message, checks sender/recipient/subject/ID and requires `last_event: delivered`. Accepted-but-pending is not delivery proof. Even a future PASS means provider simulation delivery, **not** a human inbox receipt. The QA ledger still makes no claim of customer email delivery. Current email tests are mocked; no actual email was sent by this run.

## Actual owner action

The GitHub runner needs repository Actions secret `IDOGS_DELETION_RESEND_QA_KEY`. No such accessible secret was supplied. Existing Vercel Preview `RESEND_API_KEY` metadata exists, but that does not provision the runner secret. No Resend plugin was found in the current plugin search.

Create a dedicated temporary key in the iDogs Resend account at https://resend.com/api-keys, suggested name `idogs-deletion-qa-20261026`. Automated send **and exact-message readback** need Full access: Resend's Sending access keys can only send. Full access is broader than this harness's implemented use; the harness restricts itself to POST /emails to the fixed simulation sink and GET /emails/{the exact returned receipt ID}. It performs no key/domain/contact/audience/webhook changes.

Save the key value directly as a GitHub Actions repository secret at https://github.com/izipawsltd-Tony/idogs-app/settings/secrets/actions/new. Do not paste the value into chat, code, issues, screenshots or logs. Do not replace existing Production or Vercel keys. After owner confirms, rerun the failed workflow job on this source; it creates fresh fixtures and runs email QA only after actual deletion. Revoke the dedicated key and remove its runner secret after the email QA work is complete.

Sources: https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/signInWithCustomToken ; https://resend.com/changelog/new-api-key-permissions ; https://resend.com/changelog/sending-test-emails ; https://resend.com/changelog/list-sent-emails-endpoint .

## Remaining release limits

The current gate is email credential access, not another resource-creation approval. Production remains unchanged. Public Preview routing, dedicated signed Stripe Test webhook, customer confirmation delivery, actual seven-day recovery expiry/restore behavior, production-scale worker safeguards, independent review, exact owner-approved deployment and App Store/device/assets checks remain separate gates. Do not mark the app publish-ready from this QA result.
