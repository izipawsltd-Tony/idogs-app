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
| LP-03 homepage + Australian-owned card copy | CODE PASS / PREVIEW UNVERIFIED | local 78/78 e2e, 706+ unit; copy check done locally; deployed Preview not opened (sandbox egress) — independent QA to confirm |
| LP-04 owner journey | PARTIAL | `/signup?role=owner` verified locally |
| LP-05 breeder journey | PARTIAL | `#for-breeders` anchor + `/signup?role=breeder` verified locally |
| LP-06 App Store | BLOCKED (Owner) | link works; badge needs Apple licence acceptance (see blockers) |
| LP-07 landing→signup | PARTIAL | signup-funnel specs pass on 6 viewports |
| LP-08 pricing consistency | PARTIAL | distinct offers kept; see `G2_PRICING_DISCREPANCY_REPORT.md` |
| LP-09 analytics | HELD OFF | click counters disabled by flag pending privacy sign-off (`PRIVACY_ASSESSMENT_CLICK_COUNTERS.md`) |
| LP-10 perf/a11y/SEO | NOT STARTED | index.html title/meta/og:image outdated |
| LP-11 E2E / independent QA | NOT STARTED | needs Codex or equivalent (not Claude-only) |
| LP-12 release candidate | NOT STARTED | Opus final review |

## Blockers (retry counters)
- Apple badge: BLOCKED, 0 retries. Apple's official artwork URL is `https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg` but its use requires the Apple Developer Program member (IZIPAWS) to accept Apple's App Marketing Artwork licence, and the sandbox cannot download from Apple. No third-party copies used. Owner action: accept the licence and drop the SVG at `public/app-store-badge.svg` (then set `APP_STORE_BADGE_SRC` in `LandingPage.tsx`).
- Footer legal: unresolved, not claimed complete — `LEGAL_FOOTER_VERIFICATION.md`.
- Click counters: OFF pending decision (A keep off / B enable for all after policy line / C consent-gated).
- G2: report drafted — Owner decisions listed in it.

## Defects fixed
- Blank 56px band above header on marketing pages (pre-existing; `MarketingMeasurement` moved after `<App />` in `src/main.tsx`) — attempt 1.
- Hero CTA under consent pill at 320px and landscape — attempt 1 each.

## Release candidate in progress (NOT final)
Code commits on branch: `c7ae808` (homepage), `ae79a0c` (Australian-owned copy). Later SHA recorded in Issue #103. Preview: https://idogs-bpe0d2mza-izipawsltd-tonys-projects.vercel.app (for c7ae808; later commits create new Previews).

## Exact next action
After CI is green on the latest SHA: update Issue #103 table; then LP-10 (index.html meta/title/og, a11y), request independent QA on the Preview, then LP-12 with Opus. Stop at final G1/G3/G4.
