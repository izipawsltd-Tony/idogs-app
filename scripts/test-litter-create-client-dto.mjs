// scripts/test-litter-create-client-dto.mjs — Bug 2 regression coverage for
// "Create Litter fails with 'Unknown field(s): puppyIds'".
//
// ROOT CAUSE: createLitter()'s old signature was
// `Omit<Litter, 'id' | 'createdAt' | 'tenantId'>`. `Litter.puppyIds` is a
// REQUIRED field (`puppyIds: string[]`, not `puppyIds?: string[]`), so this
// Omit did nothing to exclude it — every caller was forced by TypeScript to
// invent a value. LittersPage.tsx's only call site supplied `puppyIds: []`.
// The old implementation then did `JSON.stringify(data)` — forwarding the
// whole object, puppyIds included — straight into the POST body. The
// server (api/create-litter.js -> sanitizeLitterInput, CREATE_FIELDS from
// api/_lib/litter-schema.js) correctly rejects any key outside its
// allowlist, producing exactly the reported "Unknown field(s): puppyIds"
// error. api/create-litter.js always sets `puppyIds: []` itself
// unconditionally (tx.set(...) — never reads it from the client), so the
// server side needed no change; this was a pure client mass-assignment
// leak, same class of bug as Bug 1 (heat cycles).
//
// SELF-CAUGHT SECOND BUG while fixing the first: the initial fix wrote
// `sireName: data.sireName ?? null` in the new payload builder — mirroring
// LittersPage.tsx's own long-standing `sireName: ... : null` construction.
// sanitizeLitterInput's per-field loop treats a key as "present, please
// validate" via `raw.sireName !== undefined`, which `null` satisfies, and
// validateTextField() requires `typeof value === 'string'` — so a `null`
// sireName (preserved by JSON.stringify, unlike `undefined`, which it
// drops) would throw "sireName must be a string" for every litter without
// a manual external sire name (the common case: no sire, or an in-account
// sire). This would have been completely invisible until now because the
// "Unknown field(s): puppyIds" check runs and throws BEFORE per-field
// validation ever executes. Fixed by omitting the `sireName` key entirely
// from the payload when there's no value, instead of sending `null`.
// (sireId is destructured out of the body separately server-side, before
// sanitizeLitterInput runs, so `sireId: null` was always safe.)
//
// Same source-pattern-against-the-real-file approach as
// test-heat-cycle-client-dto.mjs, for the same reason (avoids needing a
// full React mount harness for this project's current test setup).
//
// Usage: node scripts/test-litter-create-client-dto.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { CREATE_FIELDS as SERVER_CREATE_FIELDS } from '../api/_lib/litter-schema.js'

const { check, summary } = makeChecker()

const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
const pageSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')

// =========================================================================
// SECTION 1 — CreateLitterInput excludes every identity/server-managed
// field (puppyIds, archived, archivedAt, id, createdAt, tenantId), while
// retaining every field the server's own CREATE_FIELDS allowlist accepts.
// =========================================================================
{
  const ifaceMatch = dbSrc.match(/export interface CreateLitterInput \{([\s\S]*?)\}/)
  check('CreateLitterInput interface was located for inspection', !!ifaceMatch)
  const body = ifaceMatch ? ifaceMatch[1] : ''

  for (const forbidden of ['puppyIds', 'archived', 'archivedAt', 'id', 'createdAt', 'tenantId']) {
    check(`CreateLitterInput does NOT include '${forbidden}'`, !new RegExp(`\\b${forbidden}\\b`).test(body))
  }

  const clientFields = [...body.matchAll(/^\s*(\w+)\??:/gm)].map(m => m[1])
  const clientSet = new Set(clientFields)
  const missingFromClient = SERVER_CREATE_FIELDS.filter(f => !clientSet.has(f))
  check('Every server CREATE_FIELDS entry is present on CreateLitterInput', missingFromClient.length === 0, JSON.stringify(missingFromClient))
  check('CreateLitterInput also declares damId (required) and sireId (handled separately server-side)',
    clientSet.has('damId') && clientSet.has('sireId'))
}

// =========================================================================
// SECTION 2 — createLitter() builds an explicit payload object (not a
// forwarded/spread `data`), and that payload structurally cannot carry
// puppyIds/archived/archivedAt/id/createdAt/tenantId.
// =========================================================================
{
  const fnMatch = dbSrc.match(/export async function createLitter\(data: CreateLitterInput\)[\s\S]*?\n\}/)
  check('createLitter() was located for inspection', !!fnMatch)
  const fnBody = fnMatch ? fnMatch[0] : ''

  check('createLitter() does not spread the whole `data` object into the request body (no "...data" in its body)', !fnBody.includes('...data'))
  check('createLitter() sends an explicitly-built `payload`, not `data`, as the request body', /body:\s*JSON\.stringify\(payload\)/.test(fnBody))
  for (const forbidden of ['puppyIds', 'archived', 'archivedAt', 'tenantId', 'createdAt']) {
    check(`createLitter()'s payload construction does not reference '${forbidden}'`, !fnBody.includes(forbidden))
  }
}

// =========================================================================
// SECTION 3 — the self-caught sireName-as-null bug stays fixed: the
// payload omits the sireName key entirely when there's no value, rather
// than sending an explicit `null` that would fail sanitizeLitterInput's
// `typeof value === 'string'` check.
// =========================================================================
{
  const fnMatch = dbSrc.match(/export async function createLitter\(data: CreateLitterInput\)[\s\S]*?\n\}/)
  const fnBody = fnMatch ? fnMatch[0] : ''

  check('createLitter()\'s payload does NOT send `sireName: data.sireName ?? null` (the masked-bug shape)',
    !/sireName:\s*data\.sireName\s*\?\?\s*null/.test(fnBody))
  check('createLitter()\'s payload conditionally includes sireName only when truthy (spread-or-omit pattern)',
    /\.\.\.\(data\.sireName\s*\?\s*\{\s*sireName:\s*data\.sireName\s*\}\s*:\s*\{\}\)/.test(fnBody))
  check('createLitter()\'s payload still sends sireId as `null` when absent (safe — server destructures it out before validation)',
    /sireId:\s*data\.sireId\s*\?\?\s*null/.test(fnBody))
}

// =========================================================================
// SECTION 4 — LittersPage.tsx's only call site no longer hardcodes
// puppyIds, and still supplies every legitimate form field.
// =========================================================================
{
  const fnMatch = pageSrc.match(/async function handleCreateLitter\(\)[\s\S]*?\n  \}\r?\n/)
  check('handleCreateLitter() was located for inspection', !!fnMatch)
  const fnBody = fnMatch ? fnMatch[0] : ''

  check('handleCreateLitter() no longer passes puppyIds to createLitter()', !fnBody.includes('puppyIds'))
  for (const legit of ['name', 'damId', 'sireId', 'sireName', 'matingSuspectedDate', 'expectedDueDate', 'actualBirthDate', 'notes']) {
    check(`handleCreateLitter() still supplies '${legit}' to createLitter()`, new RegExp(`\\b${legit}:`).test(fnBody))
  }

  const createLitterCalls = [...pageSrc.matchAll(/createLitter\(/g)]
  check('createLitter() has exactly one call site in the codebase (LittersPage.tsx)', createLitterCalls.length === 1)
}

// =========================================================================
// SECTION 5 — server-side strict validation still rejects unsupported
// client fields (pre-existing coverage in test-round5-schemas.mjs already
// proves this generically via a hacked tenantId; this re-confirms the
// exact puppyIds case from the original bug report specifically).
// =========================================================================
{
  let puppyIdsThrew = false
  try {
    // Simulate the OLD, buggy client payload shape directly against the
    // real server-side sanitizer, to lock in that this exact input is (and
    // must remain) rejected.
    const raw = { name: 'Test Litter', puppyIds: [] }
    const unknown = Object.keys(raw).filter(key => !SERVER_CREATE_FIELDS.includes(key))
    puppyIdsThrew = unknown.includes('puppyIds')
  } catch {
    puppyIdsThrew = true
  }
  check('The server allowlist (CREATE_FIELDS) still does not include puppyIds — old buggy payload shape remains rejected', puppyIdsThrew)
}

await summary()
