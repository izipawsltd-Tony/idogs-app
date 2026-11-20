# iDogs Growth V1 — HANDOFF (checkpoint)

Objective: conversion-focused redesign of idogs.com.au. Deadline 19:03 ACDT, 23 Nov 2026. 98% AUTO / OWNER-GATED.
Issue #103 = Growth control (task table must stay in sync). Issue #69 = main release control. GitHub is the shared channel (Claude Code / ChatGPT Coordinator / Owner).

## Baseline
- Production SHA `04f0f60` (stacked unmerged PR chain #93→#98→#100→#102; master `22c66bc` diverged, not used).
- Dev branch `claude/growth-v1-landing-20261120`. No PR opened yet. No merge / production deploy / billing / App Store change made.

## Gates
G1 conditional (not final visual). G2 report drafted (no billing change). G3/G4 not requested.

## LP status (PASS requires evidence; code pushed alone is not PASS)
| Task | Status | Evidence / note |
|---|---|---|
| LP-01 audit | DONE | Issue #103 |
| LP-02 design/copy | DONE (G1 conditional) | `docs/growth/GROWTH_V1_LP02_DESIGN.md` (needs deviations update) |
| LP-03 homepage + Australian-owned copy | CODE PASS / PREVIEW UNVERIFIED | Owner kept copy as `ae79a0c`; local + CI evidence; deployed Preview not opened by Claude (sandbox egress) |
| LP-04 owner journey | PARTIAL | `/signup?role=owner` verified locally |
| LP-05 breeder journey | PARTIAL | `#for-breeders` anchor + `/signup?role=breeder` verified locally |
| LP-06 App Store | BLOCKED (Owner) | link works; badge needs Apple licence acceptance (see blockers) |
| LP-07 landing→signup | PARTIAL | signup-funnel specs pass on 6 viewports |
| LP-08 pricing consistency | PARTIAL | distinct offers kept; see `G2_PRICING_DISCREPANCY_REPORT.md` |
| LP-09 analytics | CODE PASS (Option C, consent-gated) | unit + real-browser specs prove 0 requests before choice/after Decline, 1 after Allow; Privacy Policy + dialog updated (not legally reviewed) |
| LP-10 perf/a11y/SEO | CODE PASS / PREVIEW UNVERIFIED | axe 0 violations on `/` at 320/390/1440; contrast, heading order, landmark fixed; title/meta/OG + `og-idogs.jpg`, `robots.txt`, `sitemap.xml` added; CLS 0.006–0.011; Lighthouse on Preview still to run by QA |
| LP-11 E2E / independent QA | PACKAGE READY | `LP11_INDEPENDENT_QA_PACKAGE.md` for Codex; Claude-only tests are not sufficient for PASS |
| LP-12 release candidate | NOT STARTED | Opus final review |

## Blockers (retry counters)
- Apple badge: BLOCKED, 0 retries. Apple's official artwork URL is `https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg` but its use requires the Apple Developer Program member (IZIPAWS) to accept Apple's App Marketing Artwork licence, and the sandbox cannot download from Apple. No third-party copies used. Owner action: accept the licence and drop the SVG at `public/app-store-badge.svg` (then set `APP_STORE_BADGE_SRC` in `LandingPage.tsx`).
- Footer legal: unresolved, not claimed complete — `LEGAL_FOOTER_VERIFICATION.md`.
- Click counters: RESOLVED — Owner chose Option C (consent-gated), implemented and tested.
- Stripe read-only verification: BLOCKED — no Stripe credentials/connector here; annual A$70 stays hidden.
- `/signup` has 2 pre-existing contrast findings (auth divider, footer) — outside homepage scope, reported not fixed.
- G2: report drafted — Owner decisions listed in it.

## Defects fixed
- Blank 56px band above header on marketing pages (pre-existing; `MarketingMeasurement` moved after `<App />` in `src/main.tsx`) — attempt 1.
- Hero CTA under consent pill at 320px and landscape — attempt 1 each.

## Release candidate in progress (NOT final)
Code commits: `c7ae808` (homepage), `ae79a0c` (Australian-owned copy), `b9a88d9` (reports/flag), `c14fd7c` (LP-09 consent gating + LP-10 + LP-11 package). Latest SHA is in the newest Issue #103 comment.

## QA round 1 (Codex, SHA 3586569): FAIL — 3 P1, 0 P0
- P1-01 pricing overflow at 320–430: root cause pricing-card min-content 439px (grid `1fr` + nowrap voucher CTA). Fixed attempt 1 (`minmax(0,1fr)`, wrapping CTA/price). Verified with voucher/promo/neutral mocks.
- P1-02 hero breeder link at 320×568: not reproducible in Chromium touch emulation; likely side-effect of P1-01 widening the layout. Attempt 1: explicit scroll+hash handler, 44px target. CI (`add8c5b`, iPhone 390) then failed my own position assertion → attempt 2: handler now re-aligns for 1.5s via ResizeObserver while content above changes height (published images/fonts), cancelled by wheel/touch/key; new deterministic test fails on the attempt-1 handler. Needs real-device retest.
- P1-03 superseded A$0 promo flashed while status unknown: guard now requires resolved status. Fixed attempt 1. Fail-closed on API error (G2 to confirm).
- Retry counters: P1-01 1/3, P1-02 2/3, P1-03 1/3.

## Exact next action
Codex retests the replacement SHA (see newest Issue #103 comment) incl. consent request counts, full a11y/perf and authenticated regression (needs disposable staging credentials + valid QR fixture from Owner). Then LP-12 with Opus. Stop at final G1/G3/G4.
