# iDogs Growth V1 — HANDOFF (checkpoint, 21 Nov 2026, 18:45 ACDT)

Objective: conversion-focused redesign of idogs.com.au. Deadline 19:03 ACDT, 23 Nov 2026. 98% AUTO / OWNER-GATED.
GitHub is the shared channel. Issue #103 = Growth control (tracker table + comments carry the exact SHAs/CI/Preview of every checkpoint). Issue #69 = main release control.

## Baseline and PR
- Production = `04f0f60eedb9e6fb07273d89c190c9d770ff3e9b`, the head of open PR #102 (`claude/breeding-mating-estimate-20261119`), top of the unmerged stack #93 → #98 → #100 → #102. master (`22c66bc`) has diverged and is NOT the base.
- Growth branch `claude/growth-v1-landing-20261120` is based on `04f0f60`. Draft PR targets `claude/breeding-mating-estimate-20261119` so the diff is Growth-only; the production chain is preserved and nothing is merged. Retargeting/merge order is an Owner decision at G3/G4.
- No merge, production deploy, pricing/billing, Stripe, DB or App Store change has been made.

## Status (PASS requires direct evidence; code pushed alone is not PASS)
| Task | Status |
|---|---|
| LP-01 audit | DONE |
| LP-02 design/copy | DONE (G1 conditional); as-built deviations recorded in `docs/growth/GROWTH_V1_LP02_DESIGN.md` |
| LP-03 homepage (+ Australian-owned copy, location copy "Australia") | CODE + CI PASS; Codex independent browser PASS on `ddb2763` and `b066842` in sampled states |
| LP-04 / LP-05 journeys | PASS in sampled independent smoke (role signup URLs 200, breeder anchor) |
| LP-06 App Store CTA | link PASS; official badge BLOCKED (Apple licence, Owner) |
| LP-06B Safari Smart App Banner | **OWNER APPROVED native-only (21 Nov, reverses earlier deferral)** — implemented on `feat/lp-06b-safari-smart-app-banner` (based on Growth `5f021db`, separate PR, not in #104). App id 6823094602 verified (seller IZIPAWS PTY LTD, AU store, iPhone). Needs real iPhone Safari Owner QA. |
| LP-07 landing → signup | PASS entry smoke; `/signup` has 2 pre-existing contrast findings (out of scope) |
| LP-08 pricing consistency | G2 report; no billing change; live Stripe check BLOCKED (no credentials) |
| LP-09 consent-gated analytics | PASS (unit + browser; independent 0/0/1/0 beacon attempts) |
| LP-10 perf/a11y/SEO | axe 0 violations; Lighthouse on Preview and manual a11y still open |
| LP-11 independent QA | **PARTIAL PASS / BLOCKED** — authenticated owner/breeder/Documents/QR need disposable staging fixtures; full a11y, throttled Lighthouse, third-party/Meta audit open |
| LP-12 release candidate | **DRAFT — NOT RELEASE READY** posted (Issue #103 comment 7059005596, corrected for LP-06B) |
| DOC-MOBILE-01 (Documents iPhone card layout, pre-existing in prod) | Fix on separate PR #105 @ `b535d94` (base `04f0f60`), CI + staging Preview PASS, attempt 1/3 — **awaiting Owner iPhone QA** |
| DOC-VIEW-01 | Owner retest PASS — MONITOR |

## P1 history (retry counters unchanged)
P1-01 pricing overflow 1/3 · P1-02 breeder anchor 2/3 · P1-03 A$0 promotion flash 1/3. All independently PASS on `ddb2763` and again on `b066842` (sampled states).

## Blockers / Owner gates
- Apple badge licence · Stripe read-only verification (annual A$70 stays hidden) · footer/legal wording and Privacy/Terms review (no legal approval claimed; hello@idogs.com.au mailbox to confirm; Privacy has no iDogs-side complaint process/postal address — pre-existing) · G2 decisions (fail-closed promotion while offer status unknown; secondary offer block) · QA fixtures · final G1/G3/G4 · production approval.
- Known limitation: `/api/landing-beacon` does not verify consent server-side (client gated); the pre-existing page-load counter is not consent-gated (disclosed in Privacy).

## Evidence rules
Codex must independently QA ANY new release SHA before an Owner gate; QA on an older SHA is never carried forward. The SHA tested = SHA deployed to the matched Preview.

## Exact next action
1. Owner: iPhone QA of DOC-MOBILE-01 (PR #105 Preview) and LP-06B (its PR Preview, real Safari).
2. Staging QA fixtures/secrets (`E2E_STAGING_EMAIL/PASSWORD`) or an Owner decision on independent authenticated QA (Codex paused).
3. Owner G1/G2 decisions; then decide release composition — Growth alone (`5f021db`) or a new combined SHA (Growth + #105 and/or LP-06B) with full re-verification; final Opus LP-12 review. Stop at G3/G4.
