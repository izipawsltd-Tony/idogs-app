# Email simulation PASS; prepared signed-webhook activation gate

26 October 2026, Australia/Adelaide. Repo izipawsltd-Tony/idogs-app, branch release/ios-app-store-20261025, PR #62.

## Verified email and deletion result

After the owner supplied repository secret IDOGS_DELETION_RESEND_QA_KEY, workflow 40237508500 attempt 2, job 121305223195, completed successfully on source 42bba5a11840d2626c9d7411e2c486fe4f2adc5f. The report was isolated_cloud_permanent_deletion_pass, cleanupVerified true, emailSimulationAcceptedAfterAuthRemoval true, providerSimulationDelivered true, emailSimulationVerified true. No key or message payload was emitted to logs.

Resend accepted the fixed simulation message only after actual missing Auth, graph records and media were verified. Exact-message readback returned delivered for delivered@resend.dev. This is a provider simulation, not human-inbox proof; emailDeliveryVerified remains false. Cloud Firebase-token HTTP checks, interruption/new-worker retry, Firestore/media-generation/Auth removal, Stripe Test renewal stop, unchanged unrelated-owner sentinel and cleanup also passed. The same job ran 32 guards/contracts and 38 emulator integration checks before cloud fixtures. No Production changes or real customer messages were performed.

## Prepared endpoint and validation

Source 3107dfbd18aa164049c47c2978c25b3e14a666ff adds api/qa/deletion-webhook.js and its dependency/test, plus an explicit deletion-control route exemption. Both CI runs 40239007545 and 40239005107 passed; processor regression workflow 40239005162 passed its app tests/build, 19 account-deletion checks, 12 billing checks, 15 Stripe-contract checks, 6 signed synthetic webhook/guard checks and 38 emulator integration tests. The webhook tests use the real Stripe signature verifier with a synthetic test signing secret: they do not prove delivery from Stripe.

The endpoint is disabled unless every runtime guard passes: Vercel Preview, project prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o, exact branch release/ios-app-store-20261025, staging Firebase project/service-account identity, no emulator/alternate-universe endpoints, dedicated Test key, dedicated webhook signing secret and a future window no longer than 24 hours. It uses only named database idogs-deletion-qa.

It accepts only Stripe-signed Test customer.subscription.updated events showing stopped renewal, then verifies exact nonce fixture/customer/subscription binding and actual Stripe account/readback before writing one idempotent receipt under that QA job's providerEvents subcollection. It does not grant Plus, invoke deletion, send email or write the default database. Foreign fixtures and irrelevant events are ignored. Live/bad signatures, wrong provider account, changed ownership/readback or wrong target fail closed.

Prepared staging Preview deployment: dpl_3aPn7gS6UDdT3KJ52Lk2mmMRdA4R, host idogs-app-staging-yeh5jvxgo-izipawsltd-tonys-projects.vercel.app. It was still BUILDING at this document's preparation; re-read READY and exact SHA before any QA activation. A redeployment after configuration will have a new immutable URL and must be independently checked before updating the QA endpoint URL.

## Actual next owner gate

Read-only Stripe Test inventory on acct_1TiU0IGHgBd6ZgJE found five existing endpoints, all disabled. None is an active receiver for this new QA path. No existing endpoint or secret was changed. Staging project metadata confirms Preview SSO protection; no automation bypass is configured. Do not remove project-wide protection or reuse an old bypass/signing secret.

Existing owner webhook/bypass approval applied specifically to fix/promotion-billing-compat-20261023. The next step needs explicit approval for this release branch's separate configuration:

- Create/update one dedicated Stripe **Test** endpoint on account acct_1TiU0IGHgBd6ZgJE, enabled event customer.subscription.updated only, URL the independently verified READY staging Preview plus /api/qa/deletion-webhook. Leave all existing endpoints unchanged.
- Configure **new branch-scoped Preview variables only** on staging Vercel project prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o: IDOGS_DELETION_STRIPE_TEST_KEY, IDOGS_DELETION_WEBHOOK_SECRET, IDOGS_DELETION_WEBHOOK_QA_EXPIRES_AT. Reuse only the owner-approved staging/Test credential in the runtime; do not expose credentials to chat or artifacts. Verify existing staging Firebase server identity. Any required correction outside these exact new variable scopes is a separate gate.
- Create a temporary staging project automation bypass, used only for Stripe's QA webhook URL, while retaining existing SSO/password protections. Such a project bypass token is **project-scoped**, not cryptographically restricted to one route; limit its use to this webhook and revoke after QA. Never log a URL query carrying the bypass token.
- Redeploy the exact tested source to Preview only, verify READY/SHA/target, execute fresh controlled fixtures, check signed event receipts and actual Test subscription state, exercise duplicate delivery, then disable/delete the dedicated Test endpoint and revoke the temporary bypass. The endpoint runtime expires after at most 24 hours; do not claim that this automatically expires the Vercel bypass token.

After configuration is approved, extend the fixture runner to wait for the actual signed event receipt before cleanup. An absent signature receipt must fail QA; provider polling or a locally generated signature is not a substitute. No signed-provider delivery PASS is currently asserted.

Remaining separate release requirements include real customer confirmation strategy, Production recovery/restore lifecycle, scalable worker/writer fencing, independent review, final policy/assets, a new signed iPhone candidate/device QA and exact Production/App Store approvals. This work does not declare the app publish-ready.
