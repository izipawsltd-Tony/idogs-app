# LP-11 — Independent QA package for Codex (LP-03 through LP-10)

Purpose: an independent check that does not rely on Claude's own tests. Do NOT merge, deploy production, change billing, or modify Stripe/vouchers/entitlements.

## Subject
- Repo `izipawsltd-Tony/idogs-app`, branch `claude/growth-v1-landing-20261120`, production base `04f0f60`.
- Exact SHA under test and Preview URL: see the latest comment on Issue #103 (the SHA tested must equal the deployed Preview SHA — verify in Vercel).
- Diff scope: `git diff 04f0f60...HEAD --stat`. Expected: `src/pages/LandingPage.tsx`, `src/main.tsx`, `src/lib/landingEvents.ts(+test)`, `src/components/MarketingMeasurement.tsx`, `src/pages/PrivacyPage.tsx`, `api/_lib/landing-beacon.js`, `scripts/landing-beacon.test.js`, `index.html`, `public/{og-idogs.jpg,robots.txt,sitemap.xml}`, `e2e/local/landing-clicks-consent.spec.ts`, `docs/**`. Anything else is out of scope — flag it.

## How to run locally
```
npm ci
export VITE_FIREBASE_API_KEY=ci-placeholder-api-key VITE_FIREBASE_AUTH_DOMAIN=localhost VITE_FIREBASE_PROJECT_ID=idogs-app VITE_FIREBASE_STORAGE_BUCKET=ci-placeholder VITE_FIREBASE_MESSAGING_SENDER_ID=1 VITE_FIREBASE_APP_ID=1:1:web:1
npx tsc --noEmit && npx vitest run && npx vite build
npm run test:e2e:local          # 6 viewport projects (320/375/390/430/landscape/Pixel 7)
```
(Without the placeholder Firebase env the app does not boot and the consent specs fail — that is an environment issue, not a regression.)

## Claude's evidence (to be re-verified, not trusted)
tsc clean · 709 unit tests · Playwright 96/96 · axe-core (wcag2a/aa/21aa/best-practice) 0 violations on `/` at 320/390/1440 · local CLS ≈0.006–0.011, LCP element = preloaded hero avif · CI green on the pushed SHA (see Issue #103).

## What Claude could NOT verify (please test)
1. The deployed Vercel Preview itself (sandbox egress blocked): hero, sections, footer, images load; no console errors; staging Firebase (`idogs-app-staging`) is the backend.
2. Real devices / Safari iOS / Android Chrome; 200%/400% zoom; keyboard-only and screen-reader pass; `prefers-reduced-motion`.
3. Lighthouse/WebPageTest on the Preview with mobile throttling (LCP/CLS/TBT/INP numbers).
4. App Store link opens `https://apps.apple.com/au/app/idogs/id6823094602` on iPhone and desktop (no badge yet — BLOCKED on Apple licence; a text button is used. Do not substitute an unofficial badge).
5. Live `/api/offer-status` behaviour: with Gift Voucher live the hero/pricing show the voucher; with it off, the Plus A$0 promotion (through 31 Jan 2027) shows; both offers are never presented as combinable.
6. Live Stripe price for annual A$70 (not shown on the page; read-only verification BLOCKED, no credentials).

## Test matrix
| # | Area | Check | Expected |
|---|---|---|---|
| 1 | Hero | headline, "Get Started Free" → `/signup`, "Download for iPhone" → App Store (new tab, `noopener`) | works at all widths; no overlap with the consent pill/sticky bar |
| 2 | Breeders | "Explore iDogs for Breeders" scrolls to `#for-breeders` below the sticky header; "Start Free as a Breeder" → `/signup?role=breeder` | lands visibly; CTA clickable on mobile |
| 3 | Owners | "Start Free as a Dog Owner" → `/signup?role=owner` | opens owner signup |
| 4 | Nav | 320–1100px nav collapses to menu; menu links scroll and close menu | no horizontal scroll; focus order sane |
| 5 | Pricing | Free / Plus / Gift Voucher text; no annual price; no "Most popular"; no combined-offer claim | matches `G2_PRICING_DISCREPANCY_REPORT.md` |
| 6 | Australian-owned card | exact text "Built for Australian dog owners and breeders. Delete your account at any time."; no "Built in Adelaide" | exact |
| 7 | Footer | operator, ABN, NN Global trademark line, disclaimer incl. "(Disclaimer pending legal review.)" unchanged; no copyright year | wording unchanged; report any legal concern |
| 8 | Consent/tracking | before choice and after Decline: zero `/api/landing-beacon` requests with an `event`; after Allow: one per tap; Meta Pixel never loads before Allow; pill never covers a CTA | per `PRIVACY_ASSESSMENT_CLICK_COUNTERS.md` |
| 9 | Privacy page | new "Home page button counts" paragraph present; date 20 November 2026 | accurate vs behaviour |
| 10 | SEO | title/description/OG/Twitter tags, `og-idogs.jpg` 1200×630 loads, `/robots.txt`, `/sitemap.xml` return the files (not the SPA) on the Preview; `/p/*` stays noindex | all true |
| 11 | A11y | axe + manual: headings h1→h2→h3 in order, landmarks, contrast ≥4.5:1 on homepage, focus visible, 44px targets | 0 violations |
| 12 | Regression | `/signup`, `/login`, `/terms`, `/privacy`, QR passport `/p/:id` still load; QR passport privacy unchanged | unchanged |
| 13 | Security/privacy | no secrets in diff; no new third-party requests on `/`; no cookies set before consent | confirmed |

## Known limitations / findings to confirm
- `/signup` has two colour-contrast findings (auth divider text 3.2:1; footer 3.8:1) — pre-existing, outside the homepage scope, NOT fixed.
- Pre-existing page-load counter is not consent-gated (disclosed in the policy; Owner decision pending).
- Hero shows the Plus promotion line when the offer-status API is unreachable (production logic).
- Apple badge missing (BLOCKED, Owner/Apple licence). Legal review not complete.

## Report format requested
For each matrix row: PASS / FAIL / BLOCKED + evidence (screenshot, command output, URL). List any P0/P1 defects with reproduction steps. Post the report as a comment on Issue #103; do not edit the tracker table. Retry limit: 3 attempts per failure, then BLOCKED.
