# Protected Preview account-deletion HTTPS QA proposal

Prepared on the separate release branch; activation is disabled by default. Existing evidence covers the actual request handler on runner loopback and a separate real signed webhook over protected HTTPS. It does not yet prove the account-deletion request endpoint over deployed HTTPS.

Prepared route: `/api/qa/deletion-account`. It requires the existing exact staging Preview runtime guards plus a new explicit variable `IDOGS_DELETION_HTTP_QA_ENABLED=2026-10-26-isolated-https-fixture`. Missing approval variable, Production, wrong project, wrong branch, expired session or emulator overrides reject activation. This variable has not been created.

The handler verifies a real Firebase token with revocation checking, accepts only nonce QA UIDs backed by a disposable durable job manifest and the exact Auth creation time/email, and uses only named database `idogs-deletion-qa`. A transaction fence permits the bound fixture's revision-one request/renewal-task/support records. It does not execute deletion, access Storage, change Stripe subscriptions or write the default database. Synthetic fixture deletion and provider checks remain in the existing operator harness.

Five tests cover target rejection, invalid/foreign/recreated identities, expiry, request duplication/cancellation and refusal of a second revision. CI runs them. These tests are not a deployed HTTPS PASS.

Next owner scope to activate: one temporary additional branch-scoped Preview variable above, on staging project `prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o`; a fresh exact-source Preview and temporary protection bypass; the already approved dedicated Test webhook session and synthetic Firebase/Stripe fixtures. Exercise request/status/duplicate/cancel and revoked/deleted-token rejection over HTTPS, record safe readbacks, then delete the new variable and temporary deployment and revoke the bypass. Do not weaken SSO/password protection or modify Production/shared resources.

Implementation and test preparation are authorized branch work. The prior webhook approval covered only three Preview variables, so activating this fourth variable and deployed account-request QA requires this separate exact approval. No new secret is required; existing GitHub credentials stay in runtime memory. Human-inbox confirmation, seven-day actual expiry and Production activation remain separate unproven items.
