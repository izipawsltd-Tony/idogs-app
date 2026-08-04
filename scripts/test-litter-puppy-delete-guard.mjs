// scripts/test-litter-puppy-delete-guard.mjs — fix round (promoted-puppy
// delete bug). The server-side transaction behavior itself (hard delete
// vs unlink, the new PROMOTED_ACTIVE_IN_MY_DOGS guard, membership/history
// protections) is covered end-to-end against the Firestore emulator in
// scripts/test-atomic-transactions.mjs (SECTION 5/5b/9) — this file
// covers what that emulator suite can't: the CLIENT wiring (LittersPage.
// tsx's UI guard, confirm copy, success-only refresh event, allowlisted
// error display) via source inspection, the same established pattern
// scripts/test-dog-usage-refresh.mjs and scripts/test-litter-showcase-
// public.mjs already use for React component logic that isn't a plain
// importable function. Also confirms the dog-count and Showcase
// projection integrity claims made in api/remove-litter-puppy.js's own
// header comment using the REAL exported functions, not a
// reimplementation.
//
// Usage: node scripts/test-litter-puppy-delete-guard.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { isEligibleForCap } from '../api/_lib/dog-cap.js'

const { check, summary } = makeChecker()

const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
const serverSrc = readFileSync(new URL('../api/remove-litter-puppy.js', import.meta.url), 'utf8')
const showcasePublicSrc = readFileSync(new URL('../api/showcase-public.js', import.meta.url), 'utf8')
const showcaseSchemaSrc = readFileSync(new URL('../api/_lib/showcase-schema.js', import.meta.url), 'utf8')

// ── Server: retainedByBreeder guard exists, checked before isDogSafeToDetach,
// and the eligible path hard-deletes rather than unlinking. ──
check(
  'api/remove-litter-puppy.js rejects a promoted puppy (retainedByBreeder === true) with PROMOTED_ACTIVE_IN_MY_DOGS',
  /dog\.retainedByBreeder === true/.test(serverSrc) && /PROMOTED_ACTIVE_IN_MY_DOGS/.test(serverSrc)
)
check(
  'the promoted-puppy guard runs BEFORE isDogSafeToDetach (more specific message wins when both would apply)',
  serverSrc.indexOf('PROMOTED_ACTIVE_IN_MY_DOGS') < serverSrc.indexOf('isDogSafeToDetach(dog, uid)')
)
check(
  'an eligible litter-only puppy is HARD-DELETED (tx.delete(dogRef)), not unlinked',
  /tx\.delete\(dogRef\)/.test(serverSrc)
)
check(
  'the old unlink-only write (clearing dog.litterId while keeping the Dog document) is gone',
  !/litterId:\s*FieldValue\.delete\(\)/.test(serverSrc)
)
check(
  'litter.puppyIds is still cleaned up in the same transaction as the delete',
  /tx\.update\(litterRef,\s*\{\s*puppyIds:\s*FieldValue\.arrayRemove\(puppyId\)\s*\}\)/.test(serverSrc)
)
check(
  'existing isDogSafeToDetach protection (transferred/pending-claim/claimed/history-bearing/not-controlled) is untouched',
  /if \(!isDogSafeToDetach\(dog, uid\)\)/.test(serverSrc)
)

// ── Client: db.ts propagates the machine-readable reason code safely. ──
check(
  'db.ts attaches the server reason code onto the thrown Error (for safe allowlisted display, never raw text blindly)',
  /thrown\.reason\s*=\s*err\.reason/.test(dbSrc)
)

// ── Client: LittersPage.tsx guards, wording, and success-only refresh. ──
check(
  'handleDeletePuppy pre-checks retainedByBreeder BEFORE ever showing the confirm dialog or calling the API',
  /puppy\?\.retainedByBreeder === true/.test(littersSrc) &&
    littersSrc.indexOf('puppy?.retainedByBreeder === true') < littersSrc.indexOf("confirm('Permanently delete this puppy record?")
)
check(
  'the confirm dialog now reflects permanent deletion, not the old "remove from litter" unlink copy',
  /Permanently delete this puppy record\? This cannot be undone\./.test(littersSrc) &&
    !/confirm\('Remove this puppy from the litter\?'\)/.test(littersSrc)
)
check(
  'the exact required rejection wording is present client-side',
  littersSrc.includes('This puppy is currently in My Dogs. Return it to litter-only before deleting, or archive it from My Dogs to retain its history.')
)
check(
  'a rejected/failed deletion never calls emitDogUsageChanged — only the success path inside the try block does',
  /await removePuppyFromLitter\(litter\.id, puppyId\)[\s\S]*?if \(user\?\.uid\) emitDogUsageChanged\(user\.uid\)[\s\S]*?catch \(err\)/.test(littersSrc)
)
check(
  'the catch block uses the allowlisted describePuppyDeleteFailure(err), never err.message directly',
  /catch \(err\) \{\s*toast\(describePuppyDeleteFailure\(err\), 'error'\)/.test(littersSrc) &&
    !/toast\(err\.message/.test(littersSrc)
)
check(
  'the delete button is visually disabled for a promoted puppy (matching UI guard, not just a reactive error)',
  /disabled=\{isPuppyPromoted\}/.test(littersSrc)
)
check(
  'the allowlist maps ONLY known server reason codes to fixed copy — no fallback that echoes an arbitrary message',
  /function describePuppyDeleteFailure/.test(littersSrc) &&
    /PUPPY_DELETE_KNOWN_MESSAGES\[reason\]/.test(littersSrc) &&
    /return PUPPY_DELETE_GENERIC_MESSAGE/.test(littersSrc)
)

// ── Dog count integrity: a litter-only (unpromoted) puppy was never cap-
// counted while alive, so deleting it (its removal from the working set)
// cannot change any OTHER dog's eligibility — using the REAL server-
// authoritative isEligibleForCap, not a reimplementation. ──
{
  const breederUid = 'breeder-count-guard'
  const otherActiveDog = { id: 'kept1', status: 'active', currentOwnerId: breederUid, tenantId: breederUid }
  const litterOnlyPuppy = { id: 'litterpup1', status: 'active', currentOwnerId: breederUid, tenantId: breederUid, litterId: 'litterX', retainedByBreeder: false }
  const beforeDelete = [otherActiveDog, litterOnlyPuppy]
  const afterDelete = [otherActiveDog] // the puppy no longer exists at all post-delete

  check(
    'a litter-only (unpromoted) puppy is NOT counted toward the cap before deletion',
    !isEligibleForCap(litterOnlyPuppy)
  )
  const eligibleCountBefore = beforeDelete.filter(isEligibleForCap).length
  const eligibleCountAfter = afterDelete.filter(isEligibleForCap).length
  check(
    'deleting a litter-only puppy never changes the eligible dog count (no cap drift)',
    eligibleCountBefore === eligibleCountAfter && eligibleCountBefore === 1
  )

  // A promoted puppy IS cap-counted — which is exactly why deletion of a
  // promoted puppy must be rejected outright (a successful delete of a
  // counted dog would silently free a cap slot with no user-visible
  // "why", a drift the reject-first design prevents by construction).
  const promotedPuppy = { id: 'promoted1', status: 'active', currentOwnerId: breederUid, tenantId: breederUid, litterId: 'litterX', retainedByBreeder: true }
  check(
    'a promoted puppy IS counted toward the cap — confirms why its deletion must be rejected, not silently allowed',
    isEligibleForCap(promotedPuppy)
  )
}

// ── Showcase projection: self-heals via existing, unchanged filtering —
// no explicit cleanup write was added or needed. ──
check(
  'api/showcase-public.js still filters out any puppy whose dog document no longer exists (snap.exists) — a deleted puppy silently drops out, no separate Showcase cleanup required',
  /validPuppyDocs = puppyDocs\.filter\(snap =>\s*snap\.exists && isValidShowcasePuppyDoc/.test(showcasePublicSrc)
)
check(
  'that filter also re-validates tenant + litter chain via isValidShowcasePuppyDoc() (api/_lib/showcase-schema.js), not just existence — a deleted-then-recreated id under a different tenant/litter still can\'t leak through',
  /if \(dog\.tenantId !== showcaseTenantId\) return false/.test(showcaseSchemaSrc) &&
  /if \(dog\.litterId\) return dog\.litterId === litterId/.test(showcaseSchemaSrc)
)

summary()
