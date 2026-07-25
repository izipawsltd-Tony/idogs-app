// scripts/test-trial-copy-cleanup.mjs — structural/source checks for the
// "no free trial" copy cleanup across public/auth pages, and the
// PDF/JPG/PNG pricing-card row alignment fix. Follows this repo's
// established convention (see test-pricing-integration-checks.mjs) of
// asserting on source shape, since no DOM/component test runner is
// configured for this project.
//
// Scope note: per an explicit decision made mid-task, "Cancel anytime"
// and the 14-day money-back guarantee are NOT published in this round —
// self-service cancellation (e.g. a Stripe Billing Portal) does not exist
// anywhere in this codebase yet (verified: no billingPortal/createPortal
// Session call, no cancel button/endpoint). Some checks below assert
// those claims are still ABSENT, on purpose — that assumption should be
// revisited (and this file updated) once cancellation actually ships.
//
// Usage: node scripts/test-trial-copy-cleanup.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const files = {
  landing: readFileSync(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8'),
  signup: readFileSync(new URL('../src/pages/SignupPage.tsx', import.meta.url), 'utf8'),
  login: readFileSync(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8'),
  terms: readFileSync(new URL('../src/pages/TermsPage.tsx', import.meta.url), 'utf8'),
  settings: readFileSync(new URL('../src/pages/SettingsPage.tsx', import.meta.url), 'utf8'),
  billing: readFileSync(new URL('../src/pages/BillingPage.tsx', import.meta.url), 'utf8'),
}

const PROHIBITED_PATTERNS = [
  /30-day free trial/i,
  /30 day free trial/i,
  /30 days free/i,
  /start free trial/i,
  /free for 30 days/i,
  /no trial/i,
]

// ── Prohibited trial phrases absent from every public/auth page ───────

for (const [name, source] of Object.entries(files)) {
  for (const pattern of PROHIBITED_PATTERNS) {
    check(
      `${name}.tsx has no "${pattern.source}" phrase`,
      !pattern.test(source)
    )
  }
}

// ── Signup/Login CTAs updated ──────────────────────────────────────────

check('SignupPage.tsx badge reads "Free forever for up to 2 dogs"', files.signup.includes('Free forever for up to 2 dogs'))
check('SignupPage.tsx submit button reads "Create free account"', files.signup.includes("'Create free account'"))
check('LoginPage.tsx signup link reads "Create free account"', files.login.includes('Create free account'))

// ── Obsolete plans absent from Terms/public pricing copy ──────────────

check('TermsPage.tsx no longer lists a Basic plan', !/Basic\s*[—-]\s*\$5/i.test(files.terms))
check('TermsPage.tsx no longer lists a Pro plan', !/Pro\s*[—-]\s*\$12/i.test(files.terms))
check('TermsPage.tsx no longer lists a Kennel plan', !/Kennel\s*[—-]\s*\$29/i.test(files.terms))
check('TermsPage.tsx no longer lists an SMS add-on', !/SMS Add-on/i.test(files.terms))
check('TermsPage.tsx lists Plus Monthly and Plus Annual using shared pricingCopy.ts constants', files.terms.includes('Plus Monthly') && files.terms.includes('Plus Annual') && files.terms.includes("from '../lib/pricingCopy'"))
check('LandingPage.tsx pricing cards have no Basic/Pro/Kennel plan card', !/plan="Basic"|plan="Pro"|plan="Kennel"/.test(files.landing))

// ── PDF/JPG/PNG row uses correct left-aligned structure ────────────────

check(
  'LandingPage.tsx PricingCard feature list explicitly overrides the inherited center text-align from the Pricing section wrapper',
  /listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, margin: '0 0 24px', textAlign: 'left'/.test(files.landing)
)
check(
  'LandingPage.tsx PricingCard rows keep the fixed icon column + flex-start layout (icon and text share one left-aligned row)',
  /display: 'flex', alignItems: 'flex-start', gap: 9/.test(files.landing)
)
check(
  'LandingPage.tsx includes the PDF, JPG and PNG document support row on both Plus Monthly and Plus Annual',
  (files.landing.match(/PDF, JPG and PNG document support/g) || []).length === 2
)

// ── Guarantee / cancel-anytime / billing-portal NOT published yet (deliberate, see file header) ──
//
// Round 2: BillingPage.tsx's own FAQ used to claim "cancel anytime from
// your billing portal" — the same unsupported claim as everywhere else,
// just missed in the first pass because "cancel anytime" wasn't checked
// against billing.tsx and "billing portal" wasn't checked at all. Both
// gaps are closed below so this specific claim (or the general shape of
// it — any Stripe Billing Portal / self-service "manage subscription"
// promise) cannot silently return in any of these files while self-service
// cancellation still doesn't exist.

for (const [name, source] of Object.entries(files)) {
  check(`${name}.tsx does not claim "cancel anytime"`, !/cancel anytime/i.test(source))
  check(`${name}.tsx does not reference a "billing portal"`, !/billing portal/i.test(source))
}
check(
  'No page publishes "money-back guarantee" copy this round (self-service cancellation does not exist yet)',
  Object.values(files).every(source => !/money-back guarantee/i.test(source))
)

await summary()
