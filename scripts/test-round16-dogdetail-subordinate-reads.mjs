// scripts/test-round16-dogdetail-subordinate-reads.mjs — Codex round 16,
// Blocker 5: DogDetailPage's subordinate reads (vaccines, worming, health
// tests, activity notes, scan count, documents, audit logs/life-stage
// events) must each track their own load-failure state — a failure must
// never convert to []/null presented as genuinely empty data.
//
// DogDetailPage is a huge, deeply-nested component that can't practically
// be rendered end-to-end without a much larger test-harness investment
// than this round's scope — react-test-renderer (added this round for
// useRequestGuard's lifecycle tests) needs a real DOM-free render tree,
// and DogDetailPage pulls in QRCode generation, Firebase Storage uploads,
// and a dozen sub-tab components. Source-pattern checks against the real
// file are used instead, combined with the behavioral aggregator-failure
// coverage already in test-round15-aggregator-fail-closed.mjs and
// test-get-dogs-partial-data-safety.mjs for the underlying db.ts contract
// each of these reads depends on.
//
// Usage: node scripts/test-round16-dogdetail-subordinate-reads.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const src = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

// =========================================================================
// SECTION 1 — every subordinate query now has its own dedicated error
// state, not just reminders (which already had one from round 13/14)
// =========================================================================
{
  const errorStates = [
    'vaccinesError', 'wormingError', 'healthTestsError',
    'notesError', 'auditError', 'scanCountError', 'documentsError',
  ]
  for (const name of errorStates) {
    check(`${name} state is declared`, new RegExp(`const \\[${name}, set${name[0].toUpperCase()}${name.slice(1)}\\] = useState`).test(src))
  }
}

// =========================================================================
// SECTION 2 — the main loader's safeLoad() helper wraps EVERY subordinate
// query (not just reminders) in an {ok, data} result instead of a bare
// .catch(() => fallback) that's indistinguishable from success
// =========================================================================
{
  const loadEffectMatch = src.match(/useEffect\(\(\) => \{\s*\/\/ Clear the previous dog's state[\s\S]*?\n  \}, \[dogId, user\?\.uid\]\)/)
  const loadEffect = loadEffectMatch ? loadEffectMatch[0] : ''
  check('the main load effect was actually located for inspection (sanity check on the pattern above)', loadEffect.length > 0)

  check('a safeLoad() helper is defined that wraps a promise into {ok, data}', /function safeLoad<T>\(promise: Promise<T>, fallback: T\)/.test(loadEffect))
  check('safeLoad() logs only a sanitized code on failure (operation name + allowlisted code, not the raw error)',
    /console\.error\('DogDetailPage: subordinate query failed', \{ code: safeReadFirestoreErrorCode\(err\) \}\)/.test(loadEffect))

  const wrappedQueries = [
    'getVaccineRecords(dogId!)', 'getWormingRecords(dogId!)', 'getHealthTests(dogId!)',
    'getActivityNotes(dogId!)', 'getScanCount(dogId!)', 'getDogDocuments(dogId!)',
    "getAuditLogs(d.tenantId, dogId!)",
  ]
  for (const q of wrappedQueries) {
    check(`${q} is routed through safeLoad(), not a bare .catch(() => fallback)`,
      loadEffect.includes(`safeLoad(${q}`))
  }

  check('no subordinate query in the main loader still uses the old bare .catch(() => [...]) pattern',
    !/getVaccineRecords\(dogId!\)\.catch\(/.test(loadEffect) &&
    !/getWormingRecords\(dogId!\)\.catch\(/.test(loadEffect) &&
    !/getHealthTests\(dogId!\)\.catch\(/.test(loadEffect) &&
    !/getActivityNotes\(dogId!\)\.catch\(/.test(loadEffect) &&
    !/getDogDocuments\(dogId!\)\.catch\(/.test(loadEffect))

  check('each result sets its own error flag from the {ok} field (vaccines)', /setVaccines\(vRes\.data\); setVaccinesError\(!vRes\.ok\)/.test(loadEffect))
  check('each result sets its own error flag from the {ok} field (worming)', /setWormings\(wRes\.data\); setWormingError\(!wRes\.ok\)/.test(loadEffect))
  check('each result sets its own error flag from the {ok} field (health tests)', /setHealthTests\(hRes\.data\); setHealthTestsError\(!hRes\.ok\)/.test(loadEffect))
  check('each result sets its own error flag from the {ok} field (notes)', /setNotes\(nRes\.data\); setNotesError\(!nRes\.ok\)/.test(loadEffect))
  check('each result sets its own error flag from the {ok} field (scan count)', /setScanCount\(scRes\.data\); setScanCountError\(!scRes\.ok\)/.test(loadEffect))
  check('each result sets its own error flag from the {ok} field (documents)', /setDocuments\(docsRes\.data\); setDocumentsError\(!docsRes\.ok\)/.test(loadEffect))
  check('each result sets its own error flag from the {ok} field (audit/life-stage events)', /setAuditError\(!auditRes\.ok\)/.test(loadEffect))

  check('all subordinate queries run inside a single Promise.all — one section failing does not block the others from loading',
    /await Promise\.all\(\[/.test(loadEffect))
  check('every write from the resolved Promise.all is still guarded by req.isCurrent() (stale dogId/account switch protection preserved)',
    (() => {
      const destructureIdx = loadEffect.indexOf('remindersResult] = await Promise.all')
      if (destructureIdx === -1) return false
      // The NEXT isCurrent() check after the destructure (not the first
      // one in the whole effect, which guards an earlier await) must
      // appear before any of the setVaccines/setWormings/etc. writes.
      const nextGuardIdx = loadEffect.indexOf('if (!req.isCurrent()) return', destructureIdx)
      const firstWriteIdx = loadEffect.indexOf('setVaccines(vRes.data)')
      return nextGuardIdx !== -1 && nextGuardIdx > destructureIdx && nextGuardIdx < firstWriteIdx
    })())
}

// =========================================================================
// SECTION 3 — each tab renders a distinct "couldn't load" state, never
// its genuinely-empty copy, when its section's error flag is set
// =========================================================================
{
  const tabChecks = [
    { name: 'VaccinesTab', errorTitle: "Couldn't load vaccine records", emptyTitle: 'No vaccine records' },
    { name: 'WormingTab', errorTitle: "Couldn't load worming records", emptyTitle: 'No worming records' },
    { name: 'HealthTab', errorTitle: "Couldn't load health tests", emptyTitle: 'No health tests recorded' },
    { name: 'DocumentsTab', errorTitle: "Couldn't load documents", emptyTitle: 'No documents yet' },
  ]
  for (const { name, errorTitle, emptyTitle } of tabChecks) {
    const fnMatch = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\r?\\n\\r?\\n`))
    const fnBlock = fnMatch ? fnMatch[0] : ''
    check(`${name} was actually located for inspection (sanity check on the pattern above)`, fnBlock.length > 0)
    check(`${name} accepts an optional 'error' prop`, /error\?: boolean/.test(fnBlock))
    check(`${name} renders "${errorTitle}" when error is true, checked BEFORE the genuinely-empty branch`,
      fnBlock.includes(errorTitle) && fnBlock.indexOf(errorTitle) < fnBlock.indexOf(emptyTitle))
  }

  // RemindersTab already had this from round 13/14 — re-verify it wasn't
  // regressed by this round's changes to the surrounding file.
  const remindersTabMatch = src.match(/function RemindersTab\([\s\S]*?\n\}\r?\n/)
  const remindersTabBlock = remindersTabMatch ? remindersTabMatch[0] : ''
  check('RemindersTab still checks error before its "All clear" empty state (pre-existing, re-verified)',
    remindersTabBlock.includes("Couldn't load reminders") && remindersTabBlock.indexOf("Couldn't load reminders") < remindersTabBlock.indexOf('All clear'))
}

// =========================================================================
// SECTION 4 — "+ Add" actions on Vaccines/Worming/Health are disabled
// while their section has a load error (adding blind, without being able
// to see the current list, risks an undetected duplicate/inconsistency)
// =========================================================================
{
  const addButtonChecks = [
    { name: 'VaccinesTab', label: '+ Add vaccine' },
    { name: 'WormingTab', label: '+ Add manually' },
    { name: 'HealthTab', label: '+ Add manually' },
  ]
  for (const { name, label } of addButtonChecks) {
    const fnMatch = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\r?\\n\\r?\\n`))
    const fnBlock = fnMatch ? fnMatch[0] : ''
    check(`${name}'s "${label}" button is disabled while error is true`,
      /disabled=\{error\}/.test(fnBlock))
  }
}

// =========================================================================
// SECTION 5 — the Overview tab's "Health summary" counts (the very first
// thing a visitor sees) show "Unavailable" instead of a misleading 0/list
// on a load failure — this was a genuine gap found during the round-16
// audit, not one of the task's named examples
// =========================================================================
{
  const overviewMatch = src.match(/function OverviewTab\([\s\S]*?Health summary[\s\S]*?<\/InfoSection>/)
  const overviewBlock = overviewMatch ? overviewMatch[0] : ''
  check('OverviewTab\'s Health summary section was actually located for inspection', overviewBlock.length > 0)
  check('OverviewTab accepts vaccinesError/wormingError/healthTestsError props',
    /vaccinesError\?: boolean; wormingError\?: boolean; healthTestsError\?: boolean/.test(src))
  check('"Vaccines recorded" count shows "Unavailable" on vaccinesError, not vaccines.length',
    /vaccinesError \? 'Unavailable' : String\(vaccines\.length\)/.test(overviewBlock))
  check('"Worming records" count shows "Unavailable" on wormingError', /wormingError \? 'Unavailable' : String\(wormings\.length\)/.test(overviewBlock))
  check('"Health tests" count shows "Unavailable" on healthTestsError', /healthTestsError \? 'Unavailable' : String\(healthTests\.length\)/.test(overviewBlock))
}

// =========================================================================
// SECTION 6 — the tab bar's own count badges ("Vaccines (0)", "Worming
// (0)", "Reminders (0)", "Documents (0)") — the FIRST thing a visitor
// sees for each section — also distinguish a load failure from a
// genuine 0, using "?" instead of silently showing 0
// =========================================================================
{
  const tabsMatch = src.match(/const TABS: \{ id: Tab; label: string \}\[\] = \[[\s\S]*?\]/)
  const tabsBlock = tabsMatch ? tabsMatch[0] : ''
  check('TABS array was actually located for inspection', tabsBlock.length > 0)
  check('Vaccines tab label shows "?" instead of 0 on vaccinesError', /Vaccines \(\$\{vaccinesError \? '\?' : vaccines\.length\}\)/.test(tabsBlock))
  check('Worming tab label shows "?" instead of 0 on wormingError', /Worming \(\$\{wormingError \? '\?' : wormings\.length\}\)/.test(tabsBlock))
  check('Reminders tab label shows "?" instead of 0 on remindersError', /Reminders \(\$\{remindersError \? '\?' :/.test(tabsBlock))
  check('Documents tab label shows "?" instead of 0 on documentsError', /Documents \(\$\{documentsError \? '\?' : documents\.length\}\)/.test(tabsBlock))
}

// =========================================================================
// SECTION 7 — the Timeline tab surfaces incompleteness across its FIVE
// merged sources (notes, life-stage/audit events, vaccines, worming,
// health tests) as one clear banner, rather than silently rendering a
// merged story that's missing entries with no indication
// =========================================================================
{
  const timelineMatch = src.match(/function TimelineTab\([\s\S]*?hasIncompleteData = !!\([\s\S]*?\)/)
  const timelineBlock = timelineMatch ? timelineMatch[0] : ''
  check('TimelineTab computes hasIncompleteData from all five subordinate error flags', timelineBlock.length > 0 &&
    /notesError \|\| auditError \|\| vaccinesError \|\| wormingError \|\| healthTestsError/.test(timelineBlock))
  check('TimelineTab renders a warning banner when hasIncompleteData is true',
    /hasIncompleteData && \(/.test(src) && /may be incomplete/.test(src))
  check('TimelineTab\'s genuinely-empty "No story yet" is distinguished from an incomplete-data empty state',
    /Couldn't load \{dog\.name\}'s story/.test(src) && /No story yet/.test(src))
}

await summary()
