// scripts/test-landing-pricing-ui.mjs — structural/source checks for the
// public landing page's Pricing section (iDogs Pricing v1.1 landing-page UI
// fix). Follows this repo's established convention (see
// test-pricing-integration-checks.mjs) of asserting on source shape, since
// no DOM/component test runner is configured for this project.
//
// Usage: node scripts/test-landing-pricing-ui.mjs

// UPDATE (Landing Page V2, staging-only, 2026-08-10): the approved V2
// design/copy brief hides the Pricing section entirely until real
// prices/inclusions are verified (brief §2/§8) — this is a deliberate,
// approved product decision, not a regression. Checks that specifically
// depended on the pricing cards existing are marked skip() below with
// their reason rather than deleted, since the brief's own "Awaiting
// verification... Rename to FINAL only after all of the above verify"
// note means Pricing is expected to return to the landing page in a
// later round, at which point these checks become relevant again.
// pricingCopy.ts's own values are still checked directly (independent
// of whether the landing page currently renders them).

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, skip, summary } = makeChecker()

const landingSource = readFileSync(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8')
const pricingCopySource = readFileSync(new URL('../src/lib/pricingCopy.ts', import.meta.url), 'utf8')
const checkoutHandlerSource = readFileSync(new URL('../api/_lib/checkout-handler.js', import.meta.url), 'utf8')

// ── Obsolete plans absent ──────────────────────────────────────────────

check(
  'LandingPage.tsx no longer renders a Basic pricing card',
  !/plan="Basic"/.test(landingSource)
)
check(
  'LandingPage.tsx no longer renders a Pro pricing card',
  !/plan="Pro"/.test(landingSource)
)
check(
  'LandingPage.tsx no longer renders a Kennel pricing card',
  !/plan="Kennel"/.test(landingSource)
)
check(
  'LandingPage.tsx pricing section has no SMS reminder upsell',
  !/SMS remind/i.test(landingSource)
)

// ── Free, Plus Monthly, Plus Annual present ────────────────────────────

skip('LandingPage.tsx renders a Free pricing card', 'Pricing section hidden on Landing V2 (staging) until real prices/inclusions are verified — brief §2/§8')
skip('LandingPage.tsx renders a Plus Monthly pricing card', 'Pricing section hidden on Landing V2 (staging) until real prices/inclusions are verified — brief §2/§8')
skip('LandingPage.tsx renders a Plus Annual pricing card', 'Pricing section hidden on Landing V2 (staging) until real prices/inclusions are verified — brief §2/§8')

// ── Correct dog limits and scan quotas (sourced from pricingCopy.ts) ───

check(
  'pricingCopy.ts defines the Free dog cap as 2',
  /export const DOG_CAP_FREE = 2/.test(pricingCopySource)
)
check(
  'pricingCopy.ts defines the Plus dog cap as 5',
  /export const DOG_CAP_PLUS = 5/.test(pricingCopySource)
)
check(
  'pricingCopy.ts defines the Free lifetime scan quota as 2',
  /export const SCAN_QUOTA_FREE_LIFETIME = 2/.test(pricingCopySource)
)
check(
  'pricingCopy.ts defines the Plus monthly scan quota as 10',
  /export const SCAN_QUOTA_PLUS_MONTHLY = 10/.test(pricingCopySource)
)
skip('LandingPage.tsx pricing cards render the dog caps from pricingCopy.ts (not hardcoded numbers)', 'Pricing section hidden on Landing V2 (staging) — brief §2/§8')
skip('LandingPage.tsx pricing cards render the scan quotas from pricingCopy.ts (not hardcoded numbers)', 'Pricing section hidden on Landing V2 (staging) — brief §2/§8')

// ── False trial copy absent from the landing page ──────────────────────

check('LandingPage.tsx has no "30-day free trial" / "30-day trial" copy', !/30-day free trial|30-day trial/i.test(landingSource))
check('LandingPage.tsx has no "Start free trial" CTA copy', !/Start free trial/i.test(landingSource))
check('LandingPage.tsx has no "Start Free for 30 Days" CTA copy', !/Start Free for 30 Days/i.test(landingSource))
check('LandingPage.tsx has no "30 days free" pricing-card badge copy', !/30 days free/i.test(landingSource))

// ── $40 annual launch offer: never shown as purchasable (checkout doesn't support it) ──

check(
  'checkout-handler.js confirms only plus_monthly and plus_annual Stripe prices exist (no $40 launch price)',
  checkoutHandlerSource.includes('plus_monthly:') &&
    checkoutHandlerSource.includes('plus_annual:') &&
    !/plus_annual_launch|launch_offer/i.test(checkoutHandlerSource)
)
check(
  'LandingPage.tsx never shows $40 as a purchasable annual price (backend does not support it)',
  !/\$40/.test(landingSource)
)
skip('LandingPage.tsx shows the real $49/year standard annual price', 'Pricing section hidden on Landing V2 (staging) — brief §2/§8')
check(
  'pricingCopy.ts still defines the real $49/year standard annual price (independent of whether the landing page currently renders it)',
  pricingCopySource.includes('export const PLUS_ANNUAL_PRICE_AUD = 49')
)

// ── CTA routes correct — all three pricing cards route through the real signup flow ──

skip(
  'LandingPage.tsx Free/Plus Monthly/Plus Annual CTAs all route through navigate(\'/signup\') — the only real route available to a logged-out visitor (checkout requires an authenticated Firebase ID token)',
  'Pricing section hidden on Landing V2 (staging) — brief §2/§8. All other landing-page CTAs (Start Free, Log In) now use react-router <Link to="/signup"|"/login"> instead — verified separately.'
)
check(
  'LandingPage.tsx does not hardcode a Stripe price id anywhere',
  !/price_[A-Za-z0-9]{10,}/.test(landingSource)
)

// ── Logged-in visitors never reach the public pricing section (pre-existing redirect, must remain intact) ──

check(
  'LandingPage.tsx still redirects an authenticated visitor to /app/dashboard before the pricing section can render',
  /if \(!loading && user\) navigate\('\/app\/dashboard'\)/.test(landingSource)
)

await summary()
