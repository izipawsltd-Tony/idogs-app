// scripts/test-heat-cycle-client-dto.mjs — Bug 1 regression coverage for
// "Cannot Create/Update Dam Heat Cycle" (production: Heat form failed on
// Save with "Unknown field(s): tenantId, updatedAt, dogId, createdAt").
//
// ROOT CAUSE: DogDetailPage.tsx's saveHeatCycle() did
// `const { id: cycleId, ...cycleFields } = cycle` — stripping only `id`
// before POSTing to /api/save-heat-cycle. On EDIT, `cycle` originates
// from heatCycles state ({ id: d.id, ...d.data() } — the Firestore read
// path), which carries dogId/tenantId/createdAt/updatedAt alongside the
// editable fields. Those four rode straight through the spread into the
// request body, and api/_lib/heat-cycle-schema.js's sanitizeHeatCycleInput
// (already correctly tested in test-round5-schemas.mjs — see its own
// Section 5) rejected the whole request via its allowlist, exactly
// producing the reported error. CREATE was unaffected (its initial form
// object — { heatNumber, heatStartDate: '' } — never carries those
// fields), so this was specifically an UPDATE (edit) bug.
//
// The server-side schema was never the bug and needed no change — its
// strict rejection is precisely why this failed safely (no partial
// write, no corrupted document) instead of corrupting data. This file
// covers the CLIENT-side fix only: an explicit writable-fields DTO
// builder (HEAT_CYCLE_WRITABLE_FIELDS / toWritableHeatCycleFields) that
// replaces the old spread, plus its exact parity with the server's own
// allowlist.
//
// Same source-pattern-against-the-real-file approach as
// test-round16-dogdetail-subordinate-reads.mjs / test-round17-
// dogdetail-completeness.mjs, for the same reason (DogDetailPage.tsx is
// too large/deeply-nested to practically mount whole in a test harness
// within this project's current setup).
//
// Usage: node scripts/test-heat-cycle-client-dto.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { ALL_FIELDS as SERVER_HEAT_CYCLE_FIELDS } from '../api/_lib/heat-cycle-schema.js'

const { check, summary } = makeChecker()

const src = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

// =========================================================================
// SECTION 1 — HEAT_CYCLE_WRITABLE_FIELDS exists and excludes every
// identity/server-managed field, matching the server's own allowlist
// exactly (both lists must be kept in sync by hand — this check is what
// would catch future drift between them).
// =========================================================================
{
  const constMatch = src.match(/const HEAT_CYCLE_WRITABLE_FIELDS = \[([\s\S]*?)\] as const/)
  check('HEAT_CYCLE_WRITABLE_FIELDS was actually located for inspection', !!constMatch)
  const listBody = constMatch ? constMatch[1] : ''
  const clientFields = [...listBody.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1])

  check('HEAT_CYCLE_WRITABLE_FIELDS is non-empty', clientFields.length > 0)
  for (const forbidden of ['id', 'dogId', 'tenantId', 'createdAt', 'updatedAt']) {
    check(`HEAT_CYCLE_WRITABLE_FIELDS does NOT include '${forbidden}'`, !clientFields.includes(forbidden))
  }

  const clientSet = new Set(clientFields)
  const serverSet = new Set(SERVER_HEAT_CYCLE_FIELDS)
  const missingFromClient = SERVER_HEAT_CYCLE_FIELDS.filter(f => !clientSet.has(f))
  const extraOnClient = clientFields.filter(f => !serverSet.has(f))
  check('Every server-allowed field is present in the client writable-fields list', missingFromClient.length === 0, JSON.stringify(missingFromClient))
  check('The client writable-fields list has no extra fields beyond the server allowlist', extraOnClient.length === 0, JSON.stringify(extraOnClient))
}

// =========================================================================
// SECTION 2 — toWritableHeatCycleFields() builds an explicit DTO (copies
// only allowlisted fields), rather than spreading the input object.
// =========================================================================
{
  const fnMatch = src.match(/function toWritableHeatCycleFields\(cycle: HeatCycle\)[\s\S]*?\n\}/)
  check('toWritableHeatCycleFields() was located for inspection', !!fnMatch)
  const fnBody = fnMatch ? fnMatch[0] : ''
  check('toWritableHeatCycleFields() iterates HEAT_CYCLE_WRITABLE_FIELDS, not a raw spread of `cycle`', fnBody.includes('for (const field of HEAT_CYCLE_WRITABLE_FIELDS)'))
  check('toWritableHeatCycleFields() does not spread the whole cycle object into its result (no "...cycle" in its body)', !fnBody.includes('...cycle'))
}

// =========================================================================
// SECTION 3 — saveHeatCycle() actually uses the new DTO builder, and the
// old buggy destructure-and-spread pattern is gone for good.
// =========================================================================
{
  const fnMatch = src.match(/async function saveHeatCycle\(cycle: HeatCycle\)[\s\S]*?\n  \}\r?\n/)
  check('saveHeatCycle() was located for inspection', !!fnMatch)
  const fnBody = fnMatch ? fnMatch[0] : ''

  check('saveHeatCycle() calls toWritableHeatCycleFields(cycle)', fnBody.includes('toWritableHeatCycleFields(cycle)'))
  check('saveHeatCycle() no longer destructures-and-spreads the full cycle object (the original bug shape)', !fnBody.includes('...cycleFields } = cycle') && !/const \{ id: cycleId, \.\.\.\w+ \} = cycle/.test(fnBody))
  check('saveHeatCycle() sends the sanitized cycleFields (not the raw cycle) as the request body\'s `cycle`', /cycle:\s*cycleFields/.test(fnBody))

  // The optimistic local-state update after a successful save must set
  // dogId/tenantId explicitly (never trust whatever cycleFields happens
  // to carry, since it deliberately excludes both) and must preserve
  // createdAt from the ORIGINAL fetched record, not silently drop it.
  check('The post-save optimistic update explicitly sets dogId (not sourced from cycleFields)', /savedData = \{[\s\S]*?dogId,/.test(fnBody))
  check('The post-save optimistic update explicitly sets tenantId from the current dog record', /savedData = \{[\s\S]*?tenantId: dog\.tenantId/.test(fnBody))
  check('The post-save optimistic update preserves createdAt from the original cycle argument', /savedData = \{[\s\S]*?createdAt: cycle\.createdAt/.test(fnBody))
}

// =========================================================================
// SECTION 4 — CREATE path's initial form object stays minimal (no
// identity/server-managed fields ever seeded into it) — confirms CREATE
// was never actually affected by this bug and stays that way.
// =========================================================================
{
  check('The "+ Add Heat Cycle" button seeds a minimal object (heatNumber + empty heatStartDate only)',
    /setEditingCycle\(\{ heatNumber: heatCycles\.length \+ 1, heatStartDate: '' \}\)/.test(src))
}

await summary()
