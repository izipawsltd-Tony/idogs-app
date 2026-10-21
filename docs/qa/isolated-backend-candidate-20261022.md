# Isolated backend candidate from approved production

Base: `4145b0cef610777a7069fbe9ba5bc79991bb89ec`, reverified READY on idogs.com.au before extraction. Runtime source: `64ebc8efdd85908f1dfe6754c41e2f8339acd2dd` (Draft PR #38). This is a candidate and QA task; production release remains separately owner-approved.

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
