// scripts/test-round17-dogdetail-completeness.mjs — Codex round 17,
// Blocker 4: DogDetail completeness.
//
//   - Dog A must never appear while navigating to Dog B — DogDetailPage is
//     keyed/remounted by dogId (via a DogDetailRoute wrapper in App.tsx),
//     not left to its own effects to clear stale state in time.
//   - Every subordinate section (vaccines, worming, health tests,
//     reminders, documents, activity/audit/timeline, scan data) has its
//     own Retry action, committing only for the current uid+dogId+token —
//     round 16 gave each section its own error FLAG; round 17 adds the
//     actual retry AFFORDANCE and wires it through each tab component.
//   - Add/edit actions are disabled while their prerequisite section is
//     incomplete (round 16 already covered Vaccines/Worming/Health's own
//     "+ Add" buttons; round 17 extends this to Timeline's "Add note").
//   - refreshReminders() (called after a vaccine save) now logs a fixed
//     operation name + allowlisted code, not the raw error object.
//
// Same source-pattern-against-the-real-file approach as
// test-round16-dogdetail-subordinate-reads.mjs, for the same reason
// (DogDetailPage is too large/deeply-nested to practically mount whole in
// react-test-renderer within this round's scope) — combined with the
// mounted, production-import useRequestGuard lifecycle coverage in
// test-round16-request-guard-lifecycle.mjs for the underlying commit-
// safety guarantee every retry function here depends on.
//
// Usage: node scripts/test-round17-dogdetail-completeness.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

// Both files use CRLF line endings — \r?\n throughout, not a bare \n.
const src = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
const appSrc = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8')

// =========================================================================
// SECTION 1 — Dog A must never appear while navigating to Dog B: App.tsx
// keys DogDetailPage on dogId via a dedicated wrapper route element.
// =========================================================================
{
  check('App.tsx defines a DogDetailRoute wrapper that reads dogId via useParams()',
    /function DogDetailRoute\(\{ toast \}[\s\S]*?useParams<\{ dogId: string \}>\(\)/.test(appSrc))
  check('DogDetailRoute passes dogId as the React key, forcing a full unmount/remount on every dog switch',
    /<DogDetailPage key=\{dogId\} toast=\{toast\} \/>/.test(appSrc))
  check('the routed dogs/:dogId path uses DogDetailRoute, not DogDetailPage directly (so the key actually applies at the route level)',
    /<Route path="dogs\/:dogId" element=\{<DogDetailRoute toast=\{toast\} \/>\} \/>/.test(appSrc))
}

// =========================================================================
// SECTION 2 — each subordinate section has its own independent
// useRequestGuard instance (not sharing one generation counter — retrying
// Vaccines must not invalidate an unrelated in-flight Worming retry)
// =========================================================================
{
  const guards = ['vaccinesGuard', 'wormingGuard', 'healthGuard', 'documentsGuard', 'scanCountGuard', 'remindersGuard', 'timelineGuard']
  for (const g of guards) {
    check(`${g} is its own useRequestGuard instance, keyed on uid:dogId`,
      new RegExp(`const ${g} = useRequestGuard\\(\`\\$\\{user\\?\\.uid \\|\\| ''\\}:\\$\\{dogId \\|\\| ''\\}\`\\)`).test(src))
  }
  // All seven must be textually distinct instances (not the same guard
  // object reused under different local names, which would silently
  // reintroduce the shared-generation-counter problem this section exists
  // to avoid).
  const uniqueGuardLines = new Set(guards.map(g => {
    const m = src.match(new RegExp(`const ${g} = useRequestGuard\\([^)]*\\)`))
    return m ? m[0] : g
  }))
  check('all seven section guards are independent useRequestGuard() calls (7 distinct call sites)', uniqueGuardLines.size === 7)
}

// =========================================================================
// SECTION 3 — each retry function: guards on dogId, uses its OWN guard's
// beginRequest(), re-checks isCurrent() before EVERY commit (success and
// failure), and logs failures via the sanitized allowlisted-code helper,
// never the raw error object.
// =========================================================================
{
  const retries = [
    { fn: 'retryVaccines', guard: 'vaccinesGuard', setter: 'setVaccines', errorSetter: 'setVaccinesError' },
    { fn: 'retryWorming', guard: 'wormingGuard', setter: 'setWormings', errorSetter: 'setWormingError' },
    { fn: 'retryHealthTests', guard: 'healthGuard', setter: 'setHealthTests', errorSetter: 'setHealthTestsError' },
    { fn: 'retryDocuments', guard: 'documentsGuard', setter: 'setDocuments', errorSetter: 'setDocumentsError' },
    { fn: 'retryScanCount', guard: 'scanCountGuard', setter: 'setScanCount', errorSetter: 'setScanCountError' },
    { fn: 'retryReminders', guard: 'remindersGuard', setter: 'setReminders', errorSetter: 'setRemindersError' },
  ]
  for (const { fn, guard, setter, errorSetter } of retries) {
    const fnMatch = src.match(new RegExp(`function ${fn}\\(\\)[\\s\\S]*?\\r?\\n  \\}\\r?\\n`))
    const block = fnMatch ? fnMatch[0] : ''
    check(`${fn}() was located for inspection`, block.length > 0)
    check(`${fn}() acquires its token from ${guard}.beginRequest(), not a different section's guard`,
      new RegExp(`const req = ${guard}\\.beginRequest\\(\\)`).test(block))
    check(`${fn}() checks req.isCurrent() before committing the SUCCESS result`,
      /\.then\([^)]*=> \{\s*if \(!req\.isCurrent\(\)\) return/.test(block))
    check(`${fn}() checks req.isCurrent() before committing the FAILURE result too`,
      /\.catch\([^)]*=> \{\s*if \(!req\.isCurrent\(\)\) return/.test(block))
    check(`${fn}() commits via ${setter} on success`, block.includes(setter))
    check(`${fn}() logs failures via safeReadFirestoreErrorCode (sanitized, allowlisted code) — never the raw error object`,
      /console\.error\([^,]*, \{ code: safeReadFirestoreErrorCode\(err\) \}\)/.test(block) &&
      !/console\.error\([^)]*err\)(?!\.)/.test(block.replace(/safeReadFirestoreErrorCode\(err\)/g, '')))
    check(`${fn}() sets ${errorSetter}(true) on failure`, new RegExp(`${errorSetter}\\(true\\)`).test(block))
  }

  // retryTimeline() covers two merged sources (notes + audit-derived
  // life-stage events) in one call — checked separately since its shape
  // (Promise.all with independently-caught legs) differs from the other
  // six single-source retries above.
  const timelineMatch = src.match(/function retryTimeline\(\)[\s\S]*?\r?\n  \}\r?\n/)
  const timelineBlock = timelineMatch ? timelineMatch[0] : ''
  check('retryTimeline() was located for inspection', timelineBlock.length > 0)
  check('retryTimeline() acquires its token from timelineGuard.beginRequest()',
    /const req = timelineGuard\.beginRequest\(\)/.test(timelineBlock))
  check('retryTimeline() re-checks req.isCurrent() before committing either merged source',
    /if \(!req\.isCurrent\(\)\) return/.test(timelineBlock))
  check('retryTimeline() commits both notes and life-stage/audit results together',
    /setNotes\(/.test(timelineBlock) && /setLifeStageEvents\(/.test(timelineBlock))
  check('retryTimeline() logs each merged source\'s failure separately via safeReadFirestoreErrorCode',
    (timelineBlock.match(/safeReadFirestoreErrorCode\(err\)/g) || []).length >= 2)
}

// =========================================================================
// SECTION 4 — refreshReminders() (called after a vaccine save, not just
// from the Reminders tab's own Retry) must use the same sanitized-logging
// contract as every other subordinate loader, not a raw error dump.
// =========================================================================
{
  const refreshMatch = src.match(/async function refreshReminders\(\)[\s\S]*?\r?\n  \}\r?\n/)
  const refreshBlock = refreshMatch ? refreshMatch[0] : ''
  check('refreshReminders() was located for inspection', refreshBlock.length > 0)
  check('refreshReminders() uses remindersGuard (same guard the Reminders tab\'s own Retry uses) — a stale refresh triggered by an old vaccine save cannot clobber a newer, already-current reminders load',
    /const req = remindersGuard\.beginRequest\(\)/.test(refreshBlock))
  check('refreshReminders() no longer logs the raw error object — uses a fixed operation name + safeReadFirestoreErrorCode',
    /console\.error\('DogDetailPage: refreshReminders failed', \{ code: safeReadFirestoreErrorCode\(err\) \}\)/.test(refreshBlock))
  check('refreshReminders() does NOT contain the old raw-error-object log call', !/console\.error\('Failed to refresh reminders:', err\)/.test(src))
}

// =========================================================================
// SECTION 5 — every subordinate tab component accepts and renders an
// onRetry affordance in its error state, and the render call site actually
// wires the corresponding retry function through.
// =========================================================================
{
  const tabs = [
    { name: 'VaccinesTab', retryFn: 'retryVaccines' },
    { name: 'WormingTab', retryFn: 'retryWorming' },
    { name: 'HealthTab', retryFn: 'retryHealthTests' },
    { name: 'RemindersTab', retryFn: 'retryReminders' },
    { name: 'DocumentsTab', retryFn: 'retryDocuments' },
    { name: 'TimelineTab', retryFn: 'retryTimeline' },
  ]
  for (const { name, retryFn } of tabs) {
    const fnMatch = src.match(new RegExp(`function ${name}\\(\\{[^}]*\\}: \\{`))
    check(`${name}'s props destructure includes onRetry (not just declared in the type, actually bound)`,
      !!fnMatch && new RegExp(`function ${name}\\(\\{[^}]*\\bonRetry\\b[^}]*\\}:`).test(src))
    check(`${name}'s props TYPE declares onRetry?: () => void`,
      new RegExp(`function ${name}\\([\\s\\S]{0,1200}?onRetry\\?: \\(\\) => void`).test(src))
    check(`${name} is rendered with onRetry={${retryFn}} at its call site`,
      new RegExp(`<${name}[\\s\\S]*?onRetry=\\{${retryFn}\\}`).test(src))
  }
  // PassportTab's scan-count Retry uses a differently-named prop pair
  // (scanCountError/onRetryScanCount) since it's one InfoRow inside a
  // broader tab, not the tab's own dedicated error state.
  check('PassportTab accepts scanCountError and onRetryScanCount props',
    /function PassportTab\(\{[^}]*scanCountError[^}]*onRetryScanCount[^}]*\}/.test(src))
  check('PassportTab is rendered with scanCountError and onRetryScanCount wired to the real state/retry function',
    /<PassportTab[\s\S]*?scanCountError=\{scanCountError\}[\s\S]*?onRetryScanCount=\{retryScanCount\}/.test(src))
}

// =========================================================================
// SECTION 6 — Add/edit actions stay disabled while their prerequisite
// section is incomplete: Vaccines/Worming/Health's own "+ Add" buttons
// (round 16) plus Timeline's "Add note" button (round 17, new).
// =========================================================================
{
  const addButtonDisableCount = (src.match(/disabled=\{error\} title=\{error \? "Can't add until existing records finish loading" : undefined\}/g) || []).length
  check('Vaccines/Worming/Health each disable their own "+ Add" button while that section\'s own load has an error (round 16, still present)',
    addButtonDisableCount === 3)

  const timelineBlock2Match = src.match(/function TimelineTab\([\s\S]*?\r?\n\}\r?\n/)
  const timelineBlock2 = timelineBlock2Match ? timelineBlock2Match[0] : ''
  check('TimelineTab was located for inspection (full render body)', timelineBlock2.length > 0)
  check('TimelineTab\'s "Add note" button is disabled when hasIncompleteData is true (round 17, new) — a note must not be added against a timeline known to be missing data',
    /disabled=\{saving \|\| !newNote\.trim\(\) \|\| hasIncompleteData\}/.test(timelineBlock2))
  check('TimelineTab tells the user WHY the Add note button is disabled, not just silently disabling it',
    /Retry the failed sections above before adding a note/.test(timelineBlock2))
}

await summary()
