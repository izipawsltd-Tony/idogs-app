# Isolated backend candidate from approved production

Current production comparison base: `e4daa0e0246f418e362a36d890a6376811c713b2`, verified READY on idogs.com.au during follow-up. Original extraction base was `4145b0cef610777a7069fbe9ba5bc79991bb89ec`; runtime source was `64ebc8efdd85908f1dfe6754c41e2f8339acd2dd` (Draft PR #38). This is a candidate and QA task; production release remains separately owner-approved.

## Scope and extraction

The original implementation stack differs from production across 171 files. Its API baseline at `a1531caae3fe9b4d5309d43be6086b6fe2ee68d1` matches production for all APIs except an unreachable emulator-only deletion-ledger module. Extract only the 52 API files changed between that API baseline and PR #38, directly onto production. Do not copy the deletion-ledger module, worker activation, Rules, UI/mobile, native pipelines, policies, dependency versions or environment changes.

Source code under src/public/mobile/ios/android, package.json/lock, Firestore Rules/indexes, Storage Rules, vercel.json and the existing general CI are byte-for-byte production. Existing account-deletion request lifecycle and policy remain unchanged. Add narrowly scoped QA scripts, this report and one isolated backend verification workflow. The scope verifier compares the candidate with the exact production base and rejects protected-path drift.

Runtime behavior carried forward: same-transaction server fences on dog/litter/transfer/Showcase operations; immutable media writes and upload journals; generation-aware confirmation; durable cleanup-review tasks that preserve shared/replaced objects; frozen billing-effect suppression and minimal review receipts; provider dispatch drain holds; reminder owner/fence checks, event-based once-only email deduplication and confirmed receipts. The inherited webhook import mismatch and disabled Extra Litter tax-helper import are repaired. Missing mode-specific tax configuration fails closed; no tax rate, price or environment was created/changed.

## Local evidence

169 production-frontend plus backend/reminder app tests passed. TypeScript/Vite build passed. Targeted checks passed: ten dog-creation, 88 webhook, legacy reconciliation, 36 billing security, 11 billing API, seven credit-webhook, seven optional Extra Litter checkout, 25 SMS and 44 deletion request/processor checks.

93 actual Auth/Firestore/Storage emulator tests passed using the unchanged production Rules: account request lifecycle, server scans, actual authenticated endpoint/media contracts, billing and reminder failures/races and the isolated backend boundary. These are synthetic, loopback-only tests; they do not establish real-provider or authenticated staging success.

The previous 250-case stack included candidate client-fence Rules and deletion-worker rehearsals that are deliberately outside this release. Do not reuse that count as evidence for this isolated candidate. The new boundary test demonstrates that unchanged production Rules can still allow a direct client write under a server fence, while the server write is denied and inventory remains readyForDeletion=false. This is an explicit remaining deletion-activation limitation, not a freeze PASS.

No route/cron in this candidate physically deletes Storage objects on upload failure, grant rejection/expiry or gallery removal. Queued objects require shared-reference, exact-generation and retained-version review. No deletion execution worker is introduced. New renewal tasks retain executionEnabled=false. Live cancellation/charge/refund/provider retention and backup/restore/tombstone proof remain separate gates. Existing issued Checkout/portal sessions cannot be revoked by the new dispatch fence alone.

## Exact-source staging QA

Publish an isolated Draft PR against a branch pinned to production SHA, verify cloud CI and an exact-SHA Preview with staging environment. Check public root and server module method/error contracts, confirm public frontend build configuration identifies idogs-app-staging, and inspect runtime errors. Do not move idogs.com.au or the shared staging alias.

Authenticated QA requires the owner to open a staging session on that exact Preview origin. A staging alias preflight in the cloud browser showed the sign-in form with no active operator session. Do not obtain credentials, tokens, cookies or SDK application state through scripts. Use the secure browser-auth flow only after the candidate is concrete and reviewable. No authenticated staging PASS is claimed until actual visible results are obtained.

After login, use clearly labelled synthetic QA data only: create and reopen a dog, change status and restore, create/update a litter where account entitlements permit, upload a small synthetic profile image and PDF, reopen the media/document, reorder/remove a synthetic gallery reference without physically deleting shared bytes, and inspect reminder/billing read flows. Do not purchase, open a new financial session, enable providers, send real email/SMS, change Rules/config, request deletion for a real account or delete real records. Transfer/claim and frozen-account cases require a dedicated QA account pair and server-owned fence fixtures; do not alter real account fences. If those are unavailable, record the precise owner gate instead of substituting emulator results for staging evidence.

Cloud CI/deployment/smoke evidence and any authentication gate are recorded in the Draft PR after exact-source verification. Production remains on the original approved SHA until a separate release decision.

## Scheduled email preference follow-up

The next backend revision fixes a reproduced regression: scheduled vaccination/worming email ignored `careEmailTypes` opt-outs even though manual delivery respected them. Two handler tests first failed with one email sent after opt-out. Scheduled delivery now re-reads the user in both admission and pre-dispatch transactions, checks the event category, and requires the current email to match the cron payload recipient. The durable event key remains independent of recipient and message content. Category opt-out preserves in-app reminders and does not change SMS behavior.

The same regressions cover re-enabling a category before a delivery was admitted: skipped/unconfirmed sends no longer stamp the care record as sent. A source stamp is written only after a confirmed email or SMS; durable provider journals still prevent ambiguous email replays. HTTP 200 without a receipt leaves the source unstamped.

The revised local app suite passes 171 tests and TypeScript/Vite build. All 95 actual emulator cases pass with unchanged production Rules. Added actual-emulator races change category preference or email after admission and assert zero provider calls and a cancelled journal. Exact-source CI and Preview results for this revision must be recorded separately from the initial `bb908c3c` results.

Initial candidate staging evidence: secure login, synthetic dog `QA39 Backend 20261022` / passport `QA3-2025-BDAT` creation and profile-note update visibly succeeded. Upload was not confirmed because the browser file chooser timed out. A fresh browser runtime subsequently reached the login form without an active session. Media, reminder edits, litter/Showcase, billing summary and dedicated transfer/fenced-state fixtures remain unverified on staging. Earlier visible checks belong to `bb908c3c`, not a later revision.

## Current production integration

Production advanced independently to `e4daa0e0` (Plus promotion/GST). Merge that approved production commit without rebasing or rewriting the candidate history. Resolve overlapping checkout, reconciliation, webhook and inventory changes by preserving promotion prices, inclusive-tax policy, legacy Plus recognition, session idempotency and the single webhook reconciliation path, together with server fences. Frontend, shared promotion constants, Rules and configuration remain exactly current production. The scope verifier now compares against that current production SHA.

Promotion checkout ledgers are also fenced transactionally during attempt creation and response persistence; a late provider response cannot recreate a removed ledger after freeze. Added emulator checks cover both boundaries. Integrated local validation passes 244 app tests (including promotion/GST and webhook-entrypoint checks), 97 actual emulator cases and TypeScript/Vite build. Prior 171/95 results belong to the pre-integration revision; integration cloud CI/Preview results must be recorded separately. No production release or live Stripe configuration is performed by this merge.

The first integrated Preview (`fcb2fe06`) passed CI and reached READY, but GET `/api/create-checkout` returned 500. Local `node --check` reproduced a duplicate `getFirestore` import introduced during merge. Removed the duplicate and added a dependency-free syntax scan of every API module to required isolated CI. That failed Preview is not staging PASS; the corrected exact head must pass both CI and deployment smoke again.

Corrected head `5eb5687d` passed both cloud CI jobs and reached READY. Checkout GET returned 405; root 200 and webhook/confirm/update media GETs 405. Authenticated staging QA via the candidate branch alias (verified to this deployment) passed: reopen synthetic dog, upload and replace its synthetic profile image (replacement persisted after reload), create a future manual reminder, see it globally and complete it, create/update a synthetic litter and create its empty disabled Showcase without a public link, and upload/open a synthetic PNG document. These are bounded visible staging checks; no physical-cleanup, gallery reorder, PDF, transfer/claim or frozen-account staging PASS is inferred.

Billing read-only QA rendered unavailable subscription/SMS/payment details and logged `BILLING_SUMMARY_FAILED`. Its cause was not yet exposed by existing fixed-code logging. The next diagnostic-only revision logs only a fixed execution phase and allowlisted provider code, never raw messages, IDs, URLs, credentials or payloads; three regression cases verify log redaction and unchanged generic client errors. Local app tests now pass 247 cases. Billing/provider QA remains open pending that diagnostic, with no Stripe mutation or live configuration change.

## Production baseline refresh — 2026-10-23

Merged production 490717fe3786d1ec7a829363e2c83e1806f3e5a3 without rewriting history. Its Landing/Billing branding and agent-pilot documentation are preserved. Scope verification now compares against this production SHA; frontend, Rules, dependencies and platform configuration remain identical to production. Earlier staging evidence remains tied to its recorded SHA and is not evidence for a newer Preview.

Open staging findings: billing subscription lookup returned resource_missing; gallery upload displayed Failed to fetch without a confirmed transport root cause. The separate Showcase rerender fix remains in Draft PR #41. The cancelled login request was not retried. No production promotion, provider dispatch or physical Storage deletion is authorized by these checks.
