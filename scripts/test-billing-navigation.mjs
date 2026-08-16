// scripts/test-billing-navigation.mjs — structural/source checks for the
// Billing & Payments route + workspace navigation entry (staging QA
// finding: /billing had no discoverable path from the Breeder/Owner
// Workspace, so a guessed bare "/billing" URL 404'd and an authenticated
// visitor bounced back through "/" to /app/dashboard via LandingPage's
// own auto-redirect — reading as "billing falls back to Dashboard").
// Follows this repo's established convention (see
// test-pricing-integration-checks.mjs) of asserting on source shape for
// React Router structure/JSX that isn't cleanly unit-testable without a
// full render harness.
//
// Usage: node scripts/test-billing-navigation.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const appSource = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8')
const appLayoutSource = readFileSync(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')
const billingPageSource = readFileSync(new URL('../src/pages/BillingPage.tsx', import.meta.url), 'utf8')

// ── Route registration ─────────────────────────────────────────────────

check(
  'App.tsx registers BillingPage at billing under the protected /app tree',
  /<Route path="billing" element={<BillingPage toast={toast} \/>} \/>/.test(appSource)
)
check(
  'App.tsx registers exactly one "billing" route (no duplicate registration)',
  (appSource.match(/<Route path="billing"/g) || []).length === 1
)
check(
  'the billing route is not wrapped in BreederOnlyRoute (Owner-role internal-entitlement accounts must reach it too)',
  !/<Route path="billing" element={<BreederOnlyRoute>/.test(appSource)
)

// ── No fallback-to-Dashboard ───────────────────────────────────────────

check(
  'BillingPage.tsx never redirects to /app/dashboard on load (no plan/role condition can bounce a visitor away)',
  !/navigate\(['"]\/app\/dashboard['"]\)/.test(billingPageSource) &&
    !/<Navigate to=['"]\/app\/dashboard['"]/.test(billingPageSource)
)
check(
  'App.tsx does not register a second, bare (non-/app) "/billing" route that could shadow or redirect away from the real one',
  !/<Route path="\/billing"/.test(appSource)
)

// ── Super Admin Workspace keeps its own separate billing pages ────────

check(
  'Super Admin Workspace still registers its own separate subscriptions page, distinct from the Breeder/Owner billing route',
  /<Route path="subscriptions" element={<SuperAdminSubscriptionsPage \/>} \/>/.test(appSource)
)
check(
  'Super Admin Workspace still registers its own separate plans-pricing page, distinct from the Breeder/Owner billing route',
  /<Route path="plans-pricing" element={<SuperAdminPlansPricingPage \/>} \/>/.test(appSource)
)

// ── Sidebar navigation (desktop) ───────────────────────────────────────

check(
  'AppLayout.tsx NAV_SECTIONS has an ACCOUNT section with a visible "Billing & Payments" entry pointing at /app/billing',
  /label: 'ACCOUNT',\s*items: \[\s*{ path: '\/app\/settings', label: 'Settings', icon: '⚙️' },\s*{ path: '\/app\/billing', +label: 'Billing & Payments', icon: '💳' },/.test(appLayoutSource)
)
check(
  'the Billing & Payments sidebar entry is a plain NavLink (no breederOnly/comingSoon gate hiding it from either role)',
  /{ path: '\/app\/billing', +label: 'Billing & Payments', icon: '💳' },\s*\]/.test(appLayoutSource)
)
check(
  'NAV_SECTIONS registers the /app/billing path exactly once (no duplicate nav item)',
  (appLayoutSource.match(/path: '\/app\/billing'/g) || []).length === 1
)

// ── Mobile navigation ───────────────────────────────────────────────────
// The desktop <aside> sidebar (which NAV_SECTIONS renders into) is
// `display: none !important` under the same @media(max-width:768px) rule
// that also hides .desktop-topbar — exactly the rule that already made
// Settings itself unreachable from a real mobile viewport before this
// fix. Billing needs its own link inside .mobile-topbar (the surface
// index.css actually shows below that breakpoint) rather than relying on
// the NAV_SECTIONS entry alone.

check(
  'AppLayout.tsx mobile-topbar contains a direct link to /app/billing',
  /className="mobile-topbar">[\s\S]*?<Link to="\/app\/billing"/.test(appLayoutSource)
)
check(
  'the mobile billing link sits inside the mobile-topbar block, not the desktop-only sidebar/topbar',
  (() => {
    const mobileTopbarMatch = appLayoutSource.match(/{\/\* Mobile top bar \*\/}[\s\S]*?<\/div>\s*<\/div>/)
    return !!mobileTopbarMatch && mobileTopbarMatch[0].includes("to=\"/app/billing\"")
  })()
)

// ── No checkout/payment prompt for an already-entitled Plus account ────

check(
  'BillingPage.tsx never calls create-checkout/create-billing-portal from a mount-time effect — only from explicit user button clicks',
  !/useEffect\([^)]*create-checkout/.test(billingPageSource) &&
    !/useEffect\([^)]*create-billing-portal/.test(billingPageSource)
)

summary()
