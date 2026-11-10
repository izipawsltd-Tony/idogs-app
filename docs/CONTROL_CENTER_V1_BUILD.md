# Control Center V1 — first increment

Baseline: canonical production `92dd37772f42821f23eccfcdc753188a7a2fae53`, verified via Vercel on 10 November 2026. Development branch: `feature/control-center-v1-20261110`. No production release has been performed.

## Behavior

- Existing Super Admin GET dashboard includes an evidence envelope. `?view=evidence` provides only fixed aggregate fields for future AI tools. The original admin response still contains privileged account details and must never be passed wholesale to a model.
- Responses require the existing verified-email Super Admin guard and have private/no-store headers. Invalid views and write methods are rejected before aggregation. Provider failure text is not returned to the client.
- Revenue is masked as unverified if customer billing evidence is partial, timestamp invalid/future, or snapshot older than five minutes. UI checks snapshot age every 30 seconds; refresh remains manual.
- Signup sources use existing first-party acquisition fields from the last 30 days. INTERNAL/TEST_QA are excluded. REAL_CUSTOMER and LIKELY_REAL counts are separate; UNCLASSIFIED is outside the denominator. Missing source stays unknown. No new product data writes, external analytics calls or advertising-consent changes.
- An authenticated on-demand health endpoint probes only canonical homepage/signup URLs, with manual redirects and a five-second deadline. PASS means HTTP 200 HTML headers, not verified page rendering, login, checkout or database access. Challenge/access/transport failures produce UNKNOWN. No scheduler, incident store, notifications or model is connected yet.

## Validation

Run from this directory:

```powershell
node --test scripts/control-center-evidence.test.mjs scripts/control-center-handler.test.mjs scripts/control-center-health.test.mjs scripts/control-center-growth.test.mjs
node node_modules/vitest/vitest.mjs run src/super-admin/pages/SuperAdminAiCeoPage.test.ts src/lib/acquisition.test.ts src/lib/metaPixel.test.ts
node node_modules/typescript/bin/tsc
node node_modules/vite/bin/vite.js build
```

Direct Node commands avoid Windows cmd shim errors with the ampersand in the workspace parent path. CI now also runs the new Node regression tests.

Live public probe at 2026-11-10T10:18:56Z: homepage and signup returned HTTP 200, 632/627 ms. This is a single external observation, not an uptime history or proof of authenticated backend integration. Unit/UI tests use injected dependencies and mocked authentication; preview end-to-end verification remains required.

## Next increments

External scheduled monitoring and deduplicated incident lifecycle; bounded/cacheable aggregation; durable server-authoritative growth events; scoped AI tools/MCP authorization and audit; model integration; preview browser QA and exact-source production review. Existing secrets must remain in the runtime and are never copied into source or chat.

## Second increment: bounded assistant and incident lifecycle

`/api/super-admin/assistant` uses the existing Super Admin guard. GET reports runtime enablement; POST accepts exactly one question (maximum 2000 characters). The server builds a fresh evidence projection, reserves one of 20 global daily attempts in a Firestore transaction, then makes one Anthropic request with a 600-token output ceiling and 20-second timeout. No execution tools, redirects, automatic retries or conversation history. Only projected aggregate metrics accompany the question; UI renders answers as plain text. The question itself goes to the provider, so the form advises against pasting customer details.

Enablement requires both `IDOGS_CONTROL_CENTER_AI_ENABLED=true` and the existing server-side `ANTHROPIC_API_KEY`. The flag has NOT been set and no paid provider request has been made. Environment metadata shows the key exists for production only; it has not been read, copied or added to preview. Model ID matches the existing iDogs integration: `claude-sonnet-4-6`. API contract checked against https://platform.claude.com/docs/en/api/messages/create .

Operational metadata, once enabled, goes only to `controlCenterAiBudgets/{UTC-day}` and `controlCenterAiAudit/{request-id}`. Audit contains hashed admin UID, timestamps and outcome; never question, answer, key or customer data. Reservations are not refunded on failures/unknown outcomes. This is a request ceiling, not a currency budget. Existing default-deny Firestore rules cover both collections, with no rules changes.

Actual Firestore Standard SDK verification (isolated `demo-idogs-control-center`, loopback port 8285) passed: cross-instance contention admits only the final available slot; attempted usage never exceeds 20; audit updates work; failed attempts do not refund; unauthenticated audit reads return 403. Run with:

```powershell
firebase emulators:exec --config firebase.control-center-qa.json --project demo-idogs-control-center --only firestore 'node scripts/test-control-center-ai-budget-emulator.mjs'
```

`control-center-incidents.js` adds deduplicated incidents: two consecutive HTTP failures open an HTTP incident; two uncertain probes open an observation gap; two successful probes resolve. Replayed/future observations are rejected. `scripts/control-center-monitor.mjs` runs fixed probes and saves an atomic state/report under gitignored `.control-center-monitor/`; it sends no messages and is NOT scheduled yet. A scheduler outside the website hosting runtime and an approved notification channel remain to be connected.

First increment preview: https://idogs-3z78lor1l-izipawsltd-tonys-projects.vercel.app (READY at ec22f0b6). Protected-preview access via a temporary share link was rejected by automatic review pending explicit approval; no access protection was disabled. Live authenticated preview behavior and actual model responses remain unverified.

First increment GitHub CI run42799278937 succeeded. Staging Preview E2E run42799723692 failed at `Check bypass secret` because its automation bypass secret was absent; no Playwright result is claimed. Current local verification:27 Node regression tests,32 Vitest tests, actual budget/rules emulator, TypeScript and bundle PASS.

## Preview readback and aggregation cache

Second increment `0db71faf` passed GitHub CI run42813272549 and Vercel deployment dpl_2ELpe5th4UyZSDswJWMVx6CqRQT8 is READY at https://idogs-6x9qn4qno-izipawsltd-tonys-projects.vercel.app . User approved temporary share-link access. The Vercel connector created a link but returned deployment_authentication_required; existing Vercel CLI credentials successfully accessed the exact preview instead. No deployment protection or provider settings were changed, and no credentials exported.

Actual unauthenticated GETs to assistant, ai-ceo?view=evidence and site-health each returned HTTP401 with missing Authorization header. Chrome reached the preview's login page. Google login currently requests terms/privacy agreement and marketing preference; the user has been asked to complete this step. No authenticated dashboard or model-provider PASS is claimed.

The operating brief now has a per-function-instance single-flight cache, capped at60seconds from the source timestamp. Auth checks remain before cache access. Concurrent requests share one pending aggregation, failed refreshes never fall back to expired data, and generatedAt is never reset to disguise old evidence. Four new cache tests PASS. This reduces repeated reads within an instance; collection-wide scans and cross-instance aggregation remain future work.
