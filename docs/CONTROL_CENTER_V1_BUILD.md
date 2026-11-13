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

`control-center-incidents.js` adds deduplicated incidents. Two consecutive HTTP failures open an HTTP incident, two uncertain probes open an observation gap, and two successful probes resolve an incident. More than 30 minutes between observations resets the streak. The runner rejects replayed or future observations. `scripts/control-center-monitor.mjs` runs fixed probes and publishes the observation, incident state and transition events together in the gitignored `.control-center-monitor/state.json`. Existing state files remain readable. Read the observation timestamp before using the result.

From the runner's working directory, `node scripts/control-center-monitor.mjs --status` reads local state without probing the site or writing a new observation. It reports `NO_OBSERVATION` before the first run and `STALE` after 30 minutes without an observation. Exit code zero means a recent healthy observation with no open incident. This check does not supply independent monitoring when the computer is offline.

The Windows pilot runs every 15 minutes while the machine is awake and the user is signed in. It skips overlapping runs and expires at midnight on 15 November 2026 Adelaide time. Automatic execution and recovery after an overnight gap were verified. Results are stored locally. Off-device execution and notification routing are pending.

First increment preview: https://idogs-3z78lor1l-izipawsltd-tonys-projects.vercel.app (READY at ec22f0b6). Protected-preview access via a temporary share link was rejected by automatic review pending explicit approval; no access protection was disabled. Live authenticated preview behavior and actual model responses remain unverified.

First increment GitHub CI run42799278937 succeeded. Staging Preview E2E run42799723692 failed at `Check bypass secret` because its automation bypass secret was absent; no Playwright result is claimed. Current local verification:27 Node regression tests,32 Vitest tests, actual budget/rules emulator, TypeScript and bundle PASS.

## Preview readback and aggregation cache

Second increment `0db71faf` passed GitHub CI run42813272549 and Vercel deployment dpl_2ELpe5th4UyZSDswJWMVx6CqRQT8 is READY at https://idogs-6x9qn4qno-izipawsltd-tonys-projects.vercel.app . User approved temporary share-link access. The Vercel connector created a link but returned deployment_authentication_required; existing Vercel CLI credentials successfully accessed the exact preview instead. No deployment protection or provider settings were changed, and no credentials exported.

Actual unauthenticated GETs to assistant, ai-ceo?view=evidence and site-health each returned HTTP401 with missing Authorization header. Chrome reached the preview's login page. Google login currently requests terms/privacy agreement and marketing preference; the user has been asked to complete this step. No authenticated dashboard or model-provider PASS is claimed.

The operating brief now has a per-function-instance single-flight cache, capped at60seconds from the source timestamp. Auth checks remain before cache access. Concurrent requests share one pending aggregation, failed refreshes never fall back to expired data, and generatedAt is never reset to disguise old evidence. Four new cache tests PASS. This reduces repeated reads within an instance; collection-wide scans and cross-instance aggregation remain future work.

## Authenticated preview QA and revenue correction

After the user completed login, the exact0db71faf preview rendered the Super Admin dashboard, acquisition snapshot and correctly disabled assistant. The website-check button completed an authenticated API round trip: homepage PASS149ms, signup PASS809ms. No customer writes or model calls were performed.

This QA exposed a certification defect: customer allocation could be marked VERIFIED with zero LIVE dollars even when upstream Stripe billing was PARTIAL/UNKNOWN (TEST subscriptions were visible). The kernel and model-facing evidence now share a requirement for VERIFIED billing in LIVE mode; incomplete/TEST/MIXED/UNKNOWN billing cannot certify customer MRR. The backend brief, headline amount and customer-revenue status/note are all conservative. The UI also labels the deployment environment so a preview snapshot is not mistaken for production business results. New evidence and UI regressions PASS; TypeScript/bundle PASS. Actual authenticated proof above applies to0db71faf; the correction requires its own preview readback.

## Live Claude preview verification

Owner supplied a separate Anthropic key in Vercel Preview and approved20 attempts/day,600 output tokens. Metadata-only edit restricted the preview secret to feature/control-center-v1-20261110; production secret unchanged. A fresh PREVIEW deployment dpl_7S19XFroMtjA94jgXgSGjc8A8Eu8 at31a8ea3f reached READY. CI42815978661 succeeded for the same source.

Stable authenticated URL: https://idogs-app-git-feature-control-4e405a-izipawsltd-tonys-projects.vercel.app/app/super-admin/ai-ceo . User completed login at this origin. Reload preserved the session, showed environment preview and corrected Unverified revenue, and enabled the read-only analysis form.

One approved live request asked in Vietnamese for three priorities in100words without guessing revenue/conversion. Actual answer rendered in Vietnamese, prioritising support, incomplete billing evidence and acquisition measurement. The successful route only returns after a staging quota reservation and audit completion; raw audit documents were not separately fetched. No session tokens or secret values were read or transferred, and no production/customer records were mutated.

The live answer compared23 raw new accounts against1 qualified acquisition signup. Context now explicitly includes QA/internal/unclassified exclusions and warns that the denominators differ; the system instruction forbids treating raw account totals as real customer growth. Plain text/simple numbered output is requested for the current plain-text renderer. New context regression and related provider tests PASS; this refinement requires its own deployment/model readback.

## User-reported generic analysis failure

User screenshot on the5cff4497 preview showed successful website probes but generic Analysis unavailable for a longer three-priority question. Existing provider catches did not log sanitized reasons, so the original request cause could not be established from runtime logs. Investigation found a deterministic defect: any `max_tokens` stop discarded even usable text and turned the paid response into503.

The provider now accepts usable text with `max_tokens`, returns `truncated:true`, and the UI explicitly labels it incomplete. Tool requests, empty/malformed/oversized answers remain rejected. The approved600-token ceiling and20attempt/day limit are unchanged; no automatic provider retry was added. Failure logs now include only fixed stage/code fields, never question, key, raw provider error or account ID; timeout has a distinct client message. Nine provider/handler tests and eight UI tests PASS, including token-limit retention, safe diagnostics and no retry.

## Preview verification on 12 November

Source `b6ea7555` passed [iDogs CI](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/43152837068) and [staging E2E](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/43153189100). Staging tests exercise signed-out API authorization on desktop and iPhone. The authenticated preview previously returned a real Vietnamese Claude answer. The latest prompt wording and answer timestamp still need authenticated readback.

The signup cohort uses existing dog and active litter records. An account qualifies for the ordered milestone when its dog record is dated at or after signup and before its earliest currently active litter. Current verified active subscriptions are available only when billing evidence is complete and live. Historical conversion, cancellation and retention require event coverage. External delegated AI access remains pending.

## Claude Code takeover — 13 November (Adelaide)

Claude Code took over from Codex at handover commit `d8dba307` (base production `92dd3777`; current production is `95603df0`, so this branch is 40 commits behind production and must be rebased or merged before any release review).

**Authenticated preview acceptance (d8dba307).** Owner signed in as Super Admin at the stable preview URL. The served API matched d8dba307 (its new "Active subscriptions show current billing status" limitation was rendered); Vercel deployment `H4ubZB8XQX6QJvYAyqtgRFitmiNc`. Header showed `Environment: preview`, unverified customer revenue and the signup funnel (2 eligible signups, 11 internal/QA and 15 unclassified excluded). Refresh within 60 seconds returned the cached snapshot (9:56:33 pm) as designed; refresh after 60 seconds produced a new one (9:57:55 pm). Exactly one model question was sent (the 10-paying-customers question). Results: evidence timestamp shown (PASS); did not infer collected money from active subscriptions (PASS); did not invent traffic or conversion (PASS); **did not state that the evidence is staging (FAIL)** even though the system prompt requires it. Missing data was only partly listed because of the 90-word output contract. The header label "Model reasoning: OFF" (from the V1.2.1 kernel) is misleading while the assistant is enabled; reported, not changed.

**Fix `03988506`.** The assistant response now carries `evidenceScope` (PRODUCTION / STAGING / UNKNOWN) derived from the deployment runtime, and the UI always shows a scope caveat unless the server confirms production. The model's wording no longer decides this. Node tests 44 (+1), UI tests 12 (+3 cases). The label still needs one authenticated readback in the next acceptance round (counts against the 20/day quota).

**Off-device monitor `7ce29a90`.** `scripts/control-center-monitor-core.mjs` holds state handling shared by the Windows runner and `.github/workflows/control-center-monitor.yml` (every 10 minutes, Node only, no secrets, GET of the two fixed public URLs). State persists in the Actions cache. Unattended runs quarantine a corrupt state file and publish `STATE_RESET`. Exit codes: 0 healthy, 3 incident open, 1 runner error (previously `--status` returned 1 when not healthy). 8 new tests: first run, persistence, deduplication, recovery, 30-minute gap, incident surviving a gap, replay rejection, corrupt/oversized state. Verified on GitHub: run 43417795902 attempt 1 (no cache, PASS, saved) and attempt 2 (restored attempt 1 state, PASS, saved). The schedule only starts after merge to master (Owner gate). Incidents fail the job, which makes GitHub email the schedule's last editor, only when the repository variable `CONTROL_CENTER_MONITOR_ALERTS=on` (Owner gate). GitHub may delay scheduled runs; a delay over 30 minutes resets streaks by design. The Windows task (expires 00:00 15 November Adelaide) is unchanged.

**Funnel history.** Proposed definitions and four Owner decisions are in `docs/CONTROL_CENTER_FUNNEL_DEFINITIONS.md`. No collection code or Firestore writes until those are decided.

**External read-only Claude access — plan, not built.** Prerequisites before any code: (1) choose the OAuth issuer (Firebase Auth custom tokens are not an OAuth authorization server; a dedicated issuer or the MCP authorization flow is needed); (2) define one scope, `idogs.evidence.read`, returning only the `?view=evidence` projection; (3) the resource server verifies issuer, audience, expiry, scope and that the subject is the Super Admin, before any Firestore read; (4) audit each grant and read with a hashed subject, as in `controlCenterAiAudit`; (5) staging tests must reject missing scope, wrong audience, expired token and non-admin subject. Granting Claude Code access to the repo does not grant access to iDogs data.

## Owner decisions and staging test — 13 November, 23:00 Adelaide

Owner (22:25): prepare the off-device monitor, test manually, report before merging to master or enabling the schedule; no alert emails, log results and report website errors separately from could-not-check; funnel definitions decided (see `docs/CONTROL_CENTER_FUNNEL_DEFINITIONS.md`); keep the Codex build schedule to the original handover milestone.

**Monitor `dd513b39`.** The job never fails while alerts are off (a failed run emails people). The log and job summary carry the outcome (`WEBSITE_OK`, `WEBSITE_ERROR`, `MONITOR_COULD_NOT_CHECK`, or a runner-error warning), per-check HTTP status/latency/reason and the open incident kind, each with its own annotation. A simulated rehearsal step (skipped on scheduled runs) prints both failure cases without contacting the website. Real runs on the branch: run 43421829109 attempt 1 (push-triggered, restored state from run 43417795902, WEBSITE_OK 590/625 ms) and attempt 2 (manual re-run, restored attempt 1, WEBSITE_OK 263/266 ms). `workflow_dispatch` is only available once the file is on master, so the manual test used Re-run. **No scheduled run can happen before the merge to master**, so none will exist before the Windows task expires at 00:00 15 November Adelaide unless the Owner approves the merge first.

**Funnel `e150444d`.** Read-only. Visits: `NO_VERIFIED_SOURCE`, rate empty. Activation: first dog after signup; first litter separate (archived included; surviving records only). Paying customers: `api/_lib/control-center-payments.js` reads Stripe charges and paid invoices per linked customer (excluding INTERNAL/TEST_QA, max 100 customers, concurrency 5), counts the first successful non-refunded charge above A$0 once per account, LIVE only; Apple reported as not integrated. Paid retention: renewal among accounts whose first paid period ended 3+ days ago. Certified only with a LIVE key and complete reads; otherwise null with the status. Usage retention defined, not measured. Model evidence receives verified aggregates only, never test diagnostics. Tests: Node 61, full Vitest 642, typecheck, build; CI 43421829113, staging E2E 43422420913, both Vercel previews READY.

Staging readback at the stable preview (Owner's Super Admin session, no model question sent): Funnel panel rendered; visits "No data yet", first dog 2, first litter 0, paying customers and paid renewal "No data yet" with status `UNKNOWN_MODE` (the preview's canonical Stripe price reads fail, so the key mode is not confirmed; charges observed were test mode), test diagnostics 8 accounts with a successful test payment, 8/8 due test subscriptions renewed. Note: this request now makes two Stripe list calls per linked customer; the 60-second cache still applies.
