# iDogs Growth V1 — HANDOFF (checkpoint)

Objective: conversion-focused redesign of idogs.com.au. Deadline 19:03 ACDT, 23 Nov 2026. Mode: 98% AUTO / OWNER-GATED.
Control Center: Issue #69. Growth tracker: Issue #103.

## Baseline
- Production SHA (verified via GitHub Deployments): `04f0f60` (stacked PR chain #93→#98→#100→#102; master `22c66bc` has diverged, not used as base).
- Dev branch: `claude/growth-v1-landing-20261120`, based on `04f0f60`.

## Gate status
- G1: CONDITIONAL approval (19:26, 20 Nov). NOT final visual approval.
- G2: pricing/billing untouched. Separate discrepancy report pending (see below).
- G3 / G4: not requested. No merge, production deploy, billing or App Store change has been made.

## LP task status
| Task | Status | Notes |
|---|---|---|
| LP-01 audit | DONE | see Issue #103 |
| LP-02 design/copy | DONE (G1 conditional) | `docs/growth/GROWTH_V1_LP02_DESIGN.md` — needs a deviations update |
| LP-03 homepage | IMPLEMENTED, local QA PASS | Preview URL pending push |
| LP-04 owner journey | IN PROGRESS | CTA `/signup?role=owner` verified in browser |
| LP-05 breeder journey | IN PROGRESS | `#for-breeders` anchor + `/signup?role=breeder` verified |
| LP-06 App Store | PARTIAL / BLOCKER | link + click tracking done; official Apple badge artwork must be supplied by Owner (placeholder text button until then) |
| LP-07 landing→signup nav | VERIFIED locally | signup-funnel specs pass on 6 viewports |
| LP-08 pricing consistency | IN PROGRESS | Free / voucher / Plus promo / standard Plus kept distinct; annual price hidden |
| LP-09 analytics | DONE locally | anonymous first-party counters via `/api/landing-beacon` (`byEvent`) |
| LP-10 perf/a11y/SEO | NOT STARTED | index.html title/meta + og:image still old |
| LP-11 E2E/independent QA | NOT STARTED | CI to run on push |
| LP-12 release candidate | NOT STARTED | Opus final review per routing policy |

## Evidence (local, uncommitted state at time of writing)
- `tsc --noEmit`: clean
- vitest: 706/706 pass
- `vite build`: success
- Playwright local matrix (6 projects, 78 specs, CI placeholder Firebase env): 78/78 pass
- Browser checks: no horizontal overflow at 320/390/1440; breeder anchor lands below header at 320/390/1440; App Store link `target=_blank rel="noopener noreferrer"`
- Screenshots: `docs/growth-v1/screenshots/`

## Defects found and fixed (counters)
- Hero CTA under consent pill at 320x568: fixed, attempt 1.
- Hero CTA under consent pill in iPhone landscape: fixed, attempt 1.
- Pre-existing production defect: empty 56px consent spacer mounted before the app created a blank band above the header on all marketing pages. Fixed by mounting `MarketingMeasurement` after `<App />` in `src/main.tsx` (affects every page the pill appears on — flag to Owner).

## Open items for Owner
1. Supply the official Apple "Download on the App Store" badge SVG (Apple marketing resources) — sandbox cannot fetch it.
2. Footer legal wording: kept "(Disclaimer pending legal review.)"; removed landing "© 2026 iDogs. All rights reserved." (repo rule: no copyright year) while Terms/Privacy still show "© 2026"; trademark line mirrors Terms s.7; NN Global ABN not displayed. Legal review is NOT evidenced.
3. Click tracking is anonymous and not consent-gated (matches the existing landing beacon). Confirm.
4. G2 discrepancy report: Gift Voucher (100 places, 12 months Plus, claim by 31 Dec 2026) vs Plus A$0 promo to 31 Jan 2027 (superseded for new customers while voucher runs per commit 02d653d) vs Owner policy; annual A$70 in `pricingCopy.ts` unverified against live Stripe; "Most popular" badge removed.
5. Hero shows the Plus promo line only when live offer status is unavailable (existing production logic); with the voucher live it shows the voucher.

## Architecture decisions
- No DB schema change; beacon adds a `byEvent` map to the existing daily doc.
- No billing, Stripe, voucher or entitlement code touched.

## Exact next action
Commit, push the branch, read the Vercel Preview URL for the exact SHA, run CI, then LP-10 (index.html meta/title, a11y), update Issue #103, produce the G2 report, and prepare the review pack. Stop at final G1/G3/G4.
