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
