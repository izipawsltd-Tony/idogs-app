// Regression coverage for SettingsPage.tsx's breeder-only gating (Litters /
// "Litter Management" and Heat cycle reminder lead time must never render
// for a Pet Owner account — not merely be disabled).
//
// SettingsPage.tsx is a React component (hooks + JSX); this project has no
// React test-rendering environment configured, so this suite combines:
//   1. Pure-logic assertions mirroring the exact gating predicates used in
//      the component (isOwner, and the two conditionals gating Litters /
//      Heat cycle), including against a legacy-shaped profile normalized
//      via the same normalizeUserProfile() logic added to db.ts.
//   2. Static source-code assertions confirming the JSX is structurally
//      absent (wrapped in `{!isOwner && ...}`), not just visually hidden,
//      and that gating is derived from role — never tenantId or a
//      hardcoded email.
// The two dynamic-behavior requirements ("switching roles updates Settings
// immediately" and "refresh preserves correct visibility") are additionally
// verified live against a running Preview during staging QA — a real
// browser observation is the stronger check for those two specifically.
//
// Usage: node scripts/test-settings-role-gating.mjs (no emulator needed)

const { readFileSync } = await import('node:fs')

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

// ── Mirror of db.ts's normalizeUserProfile (see test-user-profile-role.mjs
// and db.ts's own precedence comment for the full policy rationale) ──
function isValidRole(v) {
  return v === 'breeder' || v === 'owner' || v === 'admin'
}
function isValidLegacyRole(v) {
  return v === 'breeder' || v === 'owner'
}
function evaluateAccountType(raw) {
  if (raw.accountType === undefined) return { status: 'absent' }
  return isValidLegacyRole(raw.accountType) ? { status: 'valid', role: raw.accountType } : { status: 'malformed' }
}
function evaluateRolesArray(raw) {
  if (raw.roles === undefined) return { status: 'absent' }
  const roles = raw.roles
  if (!Array.isArray(roles) || roles.length === 0) return { status: 'malformed' }
  if (!roles.every(isValidLegacyRole)) return { status: 'malformed' }
  const distinct = new Set(roles)
  return distinct.size === 1 ? { status: 'valid', role: [...distinct][0] } : { status: 'malformed' }
}
function normalizeUserProfile(raw) {
  if (isValidRole(raw.role)) {
    return { ...raw, role: raw.role }
  }
  const accountTypeResult = evaluateAccountType(raw)
  const rolesArrayResult = evaluateRolesArray(raw)
  if (accountTypeResult.status === 'malformed' || rolesArrayResult.status === 'malformed') {
    return { ...raw, role: 'owner' }
  }
  if (accountTypeResult.status === 'valid' && rolesArrayResult.status === 'valid') {
    return { ...raw, role: accountTypeResult.role === rolesArrayResult.role ? accountTypeResult.role : 'owner' }
  }
  const soleValid = accountTypeResult.status === 'valid' ? accountTypeResult
    : rolesArrayResult.status === 'valid' ? rolesArrayResult
    : null
  return { ...raw, role: soleValid?.role ?? 'owner' }
}

// ── Mirror of SettingsPage.tsx's exact gating predicates ──
function littersVisible(profile) {
  const isOwner = profile?.role === 'owner'
  return !isOwner
}
function heatCycleVisible(profile, emailReminders) {
  const isOwner = profile?.role === 'owner'
  return emailReminders && !isOwner
}

// ── Test 1: owner does not render Litter Management ──
{
  const profile = { role: 'owner' }
  check('Owner: Litters section not visible', littersVisible(profile) === false)
}

// ── Test 2: owner does not render Heat cycle reminder lead time ──
{
  const profile = { role: 'owner' }
  check('Owner: Heat cycle section not visible (email reminders on)', heatCycleVisible(profile, true) === false)
  check('Owner: Heat cycle section not visible (email reminders off either way)', heatCycleVisible(profile, false) === false)
}

// ── Test 3: breeder still renders both ──
{
  const profile = { role: 'breeder' }
  check('Breeder: Litters section visible', littersVisible(profile) === true)
  check('Breeder: Heat cycle section visible (email reminders on)', heatCycleVisible(profile, true) === true)
}

// ── Test 4: legacy normalized owner role also hides both ──
{
  const legacyAccountType = normalizeUserProfile({ accountType: 'owner' })
  check('Legacy accountType=owner normalizes and hides Litters', littersVisible(legacyAccountType) === false)
  check('Legacy accountType=owner normalizes and hides Heat cycle', heatCycleVisible(legacyAccountType, true) === false)

  const legacyRolesArray = normalizeUserProfile({ roles: ['owner'] })
  check('Legacy roles[]=owner normalizes and hides Litters', littersVisible(legacyRolesArray) === false)
}

// ── Test 4c: cross-field rule — a present-but-malformed accountType
// voids the whole legacy fallback even when roles[] alone looks like a
// clean, unambiguous breeder signal. Must still hide breeder settings. ──
{
  const profile = normalizeUserProfile({ accountType: 123, roles: ['breeder'] })
  check('accountType malformed + roles clean breeder: still hides Litters', littersVisible(profile) === false)
  check('accountType malformed + roles clean breeder: still hides Heat cycle', heatCycleVisible(profile, true) === false)
}

// ── Test 4a2: mixed valid/invalid legacy roles[] array never grants
// breeder settings access — the fix was that invalid entries were
// silently filtered out before checking ambiguity, so ['breeder', 123]
// used to resolve to 'breeder' (Litters/Heat cycle would incorrectly
// render) ──
{
  const mixedArrayCases = [
    ['breeder', 'unknown'], ['owner', 'unknown'], ['breeder', 123],
    ['owner', null], ['breeder', {}], ['owner', 'breeder'],
  ]
  for (const roles of mixedArrayCases) {
    const profile = normalizeUserProfile({ roles })
    check(`roles=${JSON.stringify(roles)} hides Litters (never grants breeder settings)`, littersVisible(profile) === false)
    check(`roles=${JSON.stringify(roles)} hides Heat cycle (never grants breeder settings)`, heatCycleVisible(profile, true) === false)
  }
}

// ── Test 4b: malformed/conflicting profile data can never grant breeder
// settings access — the safe-default (owner) applies here too ──
{
  const malformed = normalizeUserProfile({ role: 'superuser', accountType: 'breeder', roles: ['owner'] })
  check('Malformed + conflicting profile fails safe to owner (never gains breeder settings)', malformed.role === 'owner')
  check('Malformed + conflicting profile: Litters section stays hidden', littersVisible(malformed) === false)
  check('Malformed + conflicting profile: Heat cycle section stays hidden', heatCycleVisible(malformed, true) === false)
}

// ── Test 5 (structural): the JSX is actually absent for owner, not just
// disabled/styled-hidden — confirmed by checking the exact conditional
// wrapping in the source, not just that the word "Litter" appears ──
{
  const src = readFileSync(new URL('../src/pages/SettingsPage.tsx', import.meta.url), 'utf8')

  check('Litters ToggleRow is gated by `{!isOwner &&`, not a ternary that still renders something for owner',
    /\{!isOwner && \(\s*<ToggleRow[\s\S]{0,40}icon="🐣" label="Litters"/.test(src))

  check('Heat cycle block is gated by `emailReminders && !isOwner`',
    src.includes('{emailReminders && !isOwner && ('))

  check('No remaining rendered "Litter Management" upsell label (comments mentioning it are fine)',
    !src.includes('label="Litter Management"'))

  check('No remaining handleUpgrade/isEnable/upgrading dead code',
    !src.includes('handleUpgrade') && !src.includes('isEnable') && !src.includes('upgrading'))
}

// ── Test 6 (structural): gating is derived from role, never tenantId or a
// hardcoded email — this file must have no email-literal branching ──
{
  const src = readFileSync(new URL('../src/pages/SettingsPage.tsx', import.meta.url), 'utf8')
  check('No tenantId-based gating in SettingsPage.tsx', !src.includes('tenantId'))
  check('No hardcoded @gmail.com or similar email-literal gating', !/@[a-z0-9.-]+\.[a-z]{2,}/i.test(src))
  check('isOwner is derived directly from profile.role', src.includes("profile?.role === 'owner'"))
}

await summary()
