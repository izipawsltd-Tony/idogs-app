// scripts/test-round15-error-screens-hide-data.mjs — Codex round 15,
// Blocker 5: on a load failure, a page must never render a count, list,
// or selector as if it were current/genuine — 0 is a real answer only
// when the load actually succeeded. Source-pattern checks against the
// real, rendered JSX conditions (component rendering can't be exercised
// without a test renderer in this plain-Node script — see CLAUDE.md; no
// test framework is configured), targeting the exact regressions found
// during the round-15 audit.
//
// Usage: node scripts/test-round15-error-screens-hide-data.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

function src(relPath) {
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')
}

// =========================================================================
// DocumentsPage — hide count, disable Upload
// =========================================================================
{
  const s = src('src/pages/DocumentsPage.tsx')
  check('DocumentsPage: the document count text is conditioned on loadError, not shown unconditionally',
    /\{loadError \? 'Document count unavailable[\s\S]{0,120}documents\.length/.test(s))
  check('DocumentsPage: the Upload button is disabled while loadError is true',
    /disabled=\{loadError\}[\s\S]{0,150}\+ Upload Document/.test(s))
  check('DocumentsPage: the filter tabs (with their per-type stale counts) are hidden entirely on loadError',
    /\{!loadError && \(\s*<div style=\{\{ display: 'flex', gap: 8, marginBottom: 20/.test(s))
}

// =========================================================================
// RemindersPage — hide zero statistics and stale list
// =========================================================================
{
  const s = src('src/pages/RemindersPage.tsx')
  check('RemindersPage: the overdue/upcoming subtitle text is conditioned on loadError',
    /\{loadError \? 'Counts unavailable/.test(s))
  check('RemindersPage: the "Email me reminders" button is disabled while loadError is true',
    /disabled=\{sending \|\| upcomingCount === 0 \|\| loadError\}/.test(s))
  check('RemindersPage: the 3-card stats grid (Overdue/Next 7 days/Completed) is hidden entirely on loadError, not shown as 0s',
    /\{!loadError && \(\s*<div style=\{\{ display: 'grid', gridTemplateColumns: 'repeat\(3, 1fr\)'/.test(s))
  check('RemindersPage: the filter tabs are hidden entirely on loadError',
    /\{!loadError && \(\s*<div style=\{\{ display: 'flex', gap: 8, marginBottom: 16/.test(s))
}

// =========================================================================
// BuyersPage — hide count badge/stale buyers
// =========================================================================
{
  const s = src('src/pages/BuyersPage.tsx')
  check('BuyersPage: the count badge is conditioned on !error, not shown unconditionally',
    /\{!error && <span className="badge badge-gray">\{buyers\.length\}<\/span>\}/.test(s))
  check('BuyersPage: the buyer list/table only renders when !error (existing round-13/14 gating, re-verified this round)',
    /\{!loading && !error && buyers\.length > 0/.test(s))
  check('BuyersPage: now depends on the authenticated user (useAuth), not just a reloadToken with no account awareness',
    /import \{ useAuth \} from '\.\.\/hooks\/useAuth'/.test(s) && /const \{ user \} = useAuth\(\)/.test(s))
}

// =========================================================================
// ExportPage — hide/disable selectors and "No female dogs"
// =========================================================================
{
  const s = src('src/pages/ExportPage.tsx')
  check('ExportPage: the dog selector is replaced with a load-failure hint (not the stale/empty <select>) when loadError is true',
    /Select dog[\s\S]{0,50}loadError \? \(\s*<span className="form-hint">.*failed to load/.test(s))
  check('ExportPage: the litter selector is replaced with a load-failure hint when loadError is true',
    /Select litter[\s\S]{0,50}loadError \? \(\s*<span className="form-hint">.*failed to load/.test(s))
  check('ExportPage: the "No female dogs in your account" message is now confined to the non-error branch, not shown when the load itself failed',
    (() => {
      const breedingBlockMatch = s.match(/Select female dog[\s\S]{0,700}/)
      const block = breedingBlockMatch ? breedingBlockMatch[0] : ''
      // The hint must appear ONLY inside the !loadError branch, i.e.
      // nested after the loadError ternary's else-branch opens.
      return /loadError \? \(/.test(block) && /No female dogs in your account/.test(block) &&
        block.indexOf('No female dogs in your account') > block.indexOf('loadError ? (')
    })())
}

// =========================================================================
// AuditPage — hide/clear previous data/counts/filter options
// =========================================================================
{
  const s = src('src/pages/AuditPage.tsx')
  check('AuditPage: the activity count text is conditioned on loadError, not shown unconditionally',
    /\{loadError \? 'Activity count unavailable/.test(s))
  check('AuditPage: the dog/action filter dropdowns are hidden entirely on loadError',
    /\{!loadError && \(\s*<div style=\{\{ display: 'flex', gap: 10, marginBottom: 20/.test(s))
}

// =========================================================================
// DogListPage — hide/clear previous data/counts/filter options (found
// during the round-15 audit; not explicitly named in the task's example
// list, but the exact same anti-pattern)
// =========================================================================
{
  const s = src('src/pages/DogListPage.tsx')
  check('DogListPage: the dog count text is conditioned on loadError, not shown unconditionally',
    /\{loadError \? 'Dog count unavailable/.test(s))
  check('DogListPage: the search/stage-filter/Transferred(N) row is hidden entirely on loadError',
    /\{!loadError && \(\s*<div style=\{\{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' \}\}>/.test(s))
}

// =========================================================================
// Dashboard sections — must not render zero/stale values (round 14
// already fixed this; re-verified here as part of round 15's full
// inventory, not re-litigated/changed)
// =========================================================================
{
  const s = src('src/pages/DashboardPage.tsx')
  check('DashboardPage: every stat card checks its own error flag and renders "—" instead of a number',
    /\{s\.error \? '—' : s\.value\}/.test(s))
  check('DashboardPage: every panel (dogs/litters/reminders/documents/activity) checks its error flag before its empty-state branch',
    ['dogsError ? <LoadErrorState', 'littersError ? <LoadErrorState', 'remindersError ? <LoadErrorState',
      'documentsError ? <LoadErrorState', 'activityError ? <LoadErrorState'].every(pattern => s.includes(pattern)))
}

await summary()
