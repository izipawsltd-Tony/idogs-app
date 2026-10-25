# iOS release integration checkpoint

Tony confirmed physical iPhone QA PASS for iDogs 1.0 (43), source 7fcc70eab99c55bf546924004925b07de80e6e19. The supplied Settings screenshot confirms the account deletion entry is visible. It is not proof of completed permanent deletion. The image includes private contact information and is not copied into this repository.

## Baseline reconciliation

Read-only Vercel inspection found both production and staging on f7c25ccb9a98c42568fb266c7cd7a7f87dfc3449, branch release/marketing-consent-20261025, READY. Production deployment dpl_4oAgW82qKDHqPhHP2mTEjMR98dgh remains unchanged. The iOS branch diverged from that source at 8941cff8737140c024f35e8bde115107fa84cc4c.

Three-way source integration preserves the live promotion/tax safeguards, optional marketing consent, server persistence checks, ClickSend transport and SMS settings fixes. It also preserves native payment gates, current-owner privacy, request-only deletion UI and the emulator-only worker. Promotion purchase copy and CTAs stay hidden on iOS/Android while web promotion consent and Checkout remain available.

The existing seven-day target and disabled renewal-task receipt now coexist with prototype processing stages. In emulator mode only, request acceptance runs a synthetic renewal check before destructive processing. Stable cancellation keys, provider readback, request revisions and attempt epochs prevent fabricated success and stale overwrites. Canceled deletion requests never restart renewal. Real provider execution remains disabled.

## Additional engineering

- Residual email-only records block completion, even if introduced after planning.
- A changed staged operation hash blocks retry before another account path can be deleted.
- UID-keyed promotion Checkout ledgers enter explicit billing retention review; disabled renewal tasks remain server-only workflow records.
- An injected Stripe SDK contract covers customer reverse ownership, account/mode checks, paginated legacy/SMS subscription inventory, schedules, open Checkout sessions, stable cancellation keys and readback. It is mock-tested, has no runtime route or SDK construction, and is rejected by the emulator worker's synthetic-provider gate. It is not a live integration.
- Draft privacy provider copy now identifies ClickSend, matching the integrated transport. The policy remains a draft. No verified provider retention/residency guarantee or tax configuration change is made.

## Validation and release gates

Local validation and exact-SHA CI results are recorded in PR #62. The unsigned iOS workflow now runs for this release branch to check native compilation without uploading another TestFlight build. Build 43 remains the physically verified binary; source integration is not a new signed release.

No production deployment, Rules/Storage/CORS change, live Stripe/SMS/email action, merge of PR #62, App Review submission or public release has occurred.

Remaining engineering includes reviewed production ingress fencing and detached writer draining, Auth identity mutation/recreation protection, real provider adapters and reconciliation, signed upload draining, provider/backup retention and restore suppression. These are not solved by a successful emulator test or by enabling an environment flag.

The App Store portal currently requires Apple sign-in again. Final screenshots, effective privacy policy and completed App Privacy disclosures, reviewer login QA and a final selected release build are still outstanding. An administrative read-only inventory does not certify App Store eligibility.
