// scripts/test-showcase-legacy-litterid-fallback.mjs — regression
// coverage for a production incident: a real puppy ("Pink Girl" on
// idogs-app) whose dog document has no `litterId` at all (added to its
// litter only via the litter's own forward-reference `puppyIds` array —
// see src/types/index.ts's own comment on why this can happen: "Absent
// on any dog created before this field existed, and on dogs never added
// via the litter flow (e.g. DogNewPage)") correctly APPEARED on the
// public Showcase (api/showcase-public.js already had the
// isValidShowcasePuppyDoc() fallback), but every one of her photo/video
// fetches and any enquiry naming her specifically 404'd, because
// resolveVisiblePuppyByRef() — shared by api/showcase-media.js and
// api/create-showcase-enquiry.js — still ran its own, separately-
// maintained, STRICT `dog.litterId !== litterId` check with no fallback
// at all. Root cause: two call sites of the same trust boundary drifted
// out of sync when the listing side was fixed in an earlier round.
//
// Fix: resolveVisiblePuppyByRef() now delegates entirely to the single
// source of truth, isValidShowcasePuppyDoc() (api/_lib/showcase-
// schema.js) — the exact function api/showcase-public.js already uses —
// so all three call sites can never drift apart again.
//
// This file directly unit-tests both the pure predicate
// (isValidShowcasePuppyDoc) and the full resolveVisiblePuppyByRef()
// function against a fake Firestore (no real credentials, no emulator).
//
// Usage: node scripts/test-showcase-legacy-litterid-fallback.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import { isValidShowcasePuppyDoc } from '../api/_lib/showcase-schema.js'
import { resolveVisiblePuppyByRef, opaquePuppyRef } from '../api/_lib/showcase-media-access.js'

const { check, checkAsync, summary } = makeChecker()

const TENANT = 'tenant-1'
const LITTER_ID = 'litter-1'
const OTHER_LITTER_ID = 'litter-other'

// =========================================================================
// SECTION 1 — isValidShowcasePuppyDoc(): pure-function unit tests for
// every scenario in the required test matrix (A, C, D, E, G below map
// directly onto this predicate; F is a resolveVisiblePuppyByRef-level
// concern, covered in Section 2).
// =========================================================================

// G — existing normal dog with correct litterId → unchanged/allowed.
check('G: a dog WITH the correct litterId is valid regardless of litterPuppyIds contents (the common case, never touches the fallback)',
  isValidShowcasePuppyDoc('dog-1', { tenantId: TENANT, litterId: LITTER_ID }, TENANT, LITTER_ID, new Set()))

// A/C — legacy dog (no litterId at all): valid ONLY via puppyIds membership.
check('A: a dog with NO litterId at all, but present in litter.puppyIds, is valid (the legacy-puppy fallback)',
  isValidShowcasePuppyDoc('dog-2', { tenantId: TENANT }, TENANT, LITTER_ID, new Set(['dog-2', 'dog-3'])))
check('C: a dog with NO litterId at all, and NOT in litter.puppyIds, is rejected',
  !isValidShowcasePuppyDoc('dog-2', { tenantId: TENANT }, TENANT, LITTER_ID, new Set(['dog-3'])))
check('A/C variant: litterId explicitly undefined (not just omitted) is treated identically to absent',
  isValidShowcasePuppyDoc('dog-2', { tenantId: TENANT, litterId: undefined }, TENANT, LITTER_ID, new Set(['dog-2'])))
check('A/C variant: litterId as an empty string is treated as "no opinion" and falls back to puppyIds (falsy, matches the `if (dog.litterId)` guard)',
  isValidShowcasePuppyDoc('dog-2', { tenantId: TENANT, litterId: '' }, TENANT, LITTER_ID, new Set(['dog-2'])))

// D — explicit WRONG litterId must be rejected even if the dog also
// happens to appear in the CURRENT litter's puppyIds (must never be
// resurfaced by the fallback — the fallback is ONLY for "no opinion").
check('D: a dog with an EXPLICIT but WRONG litterId is rejected even when it also appears in the current litter\'s puppyIds (fallback must never override an explicit, conflicting litterId)',
  !isValidShowcasePuppyDoc('dog-2', { tenantId: TENANT, litterId: OTHER_LITTER_ID }, TENANT, LITTER_ID, new Set(['dog-2'])))
check('D variant: a dog with the correct litterId for the CURRENT check still passes even if a stale litterPuppyIds set does not include it (litterId, when present, is authoritative on its own)',
  isValidShowcasePuppyDoc('dog-2', { tenantId: TENANT, litterId: LITTER_ID }, TENANT, LITTER_ID, new Set()))

// E — wrong tenant must be rejected outright, regardless of litterId/puppyIds.
check('E: wrong tenantId is rejected outright — even with a correct litterId', !isValidShowcasePuppyDoc('dog-1', { tenantId: 'someone-else', litterId: LITTER_ID }, TENANT, LITTER_ID, new Set()))
check('E variant: wrong tenantId is rejected outright — even when the legacy fallback would otherwise match via puppyIds', !isValidShowcasePuppyDoc('dog-2', { tenantId: 'someone-else' }, TENANT, LITTER_ID, new Set(['dog-2'])))

// =========================================================================
// SECTION 2 — resolveVisiblePuppyByRef(): full end-to-end unit tests
// against a fake Firestore, covering the same matrix through the actual
// function api/showcase-media.js and api/create-showcase-enquiry.js call.
// =========================================================================

function makeShowcase(puppies) {
  return { tenantId: TENANT, puppies }
}

await checkAsync('A: resolveVisiblePuppyByRef() resolves a legacy dog (no litterId) that IS a member of litter.puppyIds — media/enquiry access allowed', async () => {
  const dogId = 'legacy-puppy'
  const db = createFakeFirestore({ dogs: { [dogId]: { tenantId: TENANT } } }) // no litterId at all
  const showcase = makeShowcase({ [dogId]: { visible: true } })
  const puppyRef = opaquePuppyRef(LITTER_ID, dogId)
  const litterPuppyIds = new Set([dogId])
  const result = await resolveVisiblePuppyByRef(db, showcase, LITTER_ID, puppyRef, litterPuppyIds)
  return result !== null && result.dogId === dogId
})

await checkAsync('B: the SAME legacy-dog resolution path is what api/create-showcase-enquiry.js uses for a puppy-specific enquiry — proven by using the identical call shape (dogId, litterPuppyIds) that endpoint now passes', async () => {
  const dogId = 'legacy-puppy'
  const db = createFakeFirestore({ dogs: { [dogId]: { tenantId: TENANT, name: 'Pink Girl' } } })
  const showcase = makeShowcase({ [dogId]: { visible: true } })
  const puppyRef = opaquePuppyRef(LITTER_ID, dogId)
  const litterPuppyIds = new Set([dogId])
  const result = await resolveVisiblePuppyByRef(db, showcase, LITTER_ID, puppyRef, litterPuppyIds)
  // create-showcase-enquiry.js uses result.dogId (stored as puppyId on the
  // enquiry doc) and result.dog.name (for the notification email subject)
  return result !== null && result.dogId === dogId && result.dog.name === 'Pink Girl'
})

await checkAsync('C: resolveVisiblePuppyByRef() rejects a legacy dog (no litterId) that is NOT a member of litter.puppyIds', async () => {
  const dogId = 'orphan-puppy'
  const db = createFakeFirestore({ dogs: { [dogId]: { tenantId: TENANT } } })
  const showcase = makeShowcase({ [dogId]: { visible: true } })
  const puppyRef = opaquePuppyRef(LITTER_ID, dogId)
  const litterPuppyIds = new Set(['some-other-dog']) // does NOT include dogId
  const result = await resolveVisiblePuppyByRef(db, showcase, LITTER_ID, puppyRef, litterPuppyIds)
  return result === null
})

await checkAsync('D: resolveVisiblePuppyByRef() rejects a dog with an EXPLICIT but WRONG litterId, even if it is also (incorrectly) listed in the current litter\'s puppyIds', async () => {
  const dogId = 'cross-litter-puppy'
  const db = createFakeFirestore({ dogs: { [dogId]: { tenantId: TENANT, litterId: OTHER_LITTER_ID } } })
  const showcase = makeShowcase({ [dogId]: { visible: true } })
  const puppyRef = opaquePuppyRef(LITTER_ID, dogId)
  const litterPuppyIds = new Set([dogId]) // stale/incorrect membership — must not override the explicit litterId
  const result = await resolveVisiblePuppyByRef(db, showcase, LITTER_ID, puppyRef, litterPuppyIds)
  return result === null
})

await checkAsync('E: resolveVisiblePuppyByRef() rejects a dog belonging to a different tenant, regardless of litterId/puppyIds', async () => {
  const dogId = 'wrong-tenant-puppy'
  const db = createFakeFirestore({ dogs: { [dogId]: { tenantId: 'someone-else' } } })
  const showcase = makeShowcase({ [dogId]: { visible: true } })
  const puppyRef = opaquePuppyRef(LITTER_ID, dogId)
  const litterPuppyIds = new Set([dogId])
  const result = await resolveVisiblePuppyByRef(db, showcase, LITTER_ID, puppyRef, litterPuppyIds)
  return result === null
})

await checkAsync('F: resolveVisiblePuppyByRef() rejects a puppy whose Showcase entry has visible:false, even though the dog itself would otherwise resolve correctly (hidden puppy stays inaccessible)', async () => {
  const dogId = 'hidden-puppy'
  const db = createFakeFirestore({ dogs: { [dogId]: { tenantId: TENANT, litterId: LITTER_ID } } })
  const showcase = makeShowcase({ [dogId]: { visible: false } }) // hidden
  const puppyRef = opaquePuppyRef(LITTER_ID, dogId)
  const result = await resolveVisiblePuppyByRef(db, showcase, LITTER_ID, puppyRef, new Set([dogId]))
  return result === null
})

await checkAsync('F variant (forged puppyRef): a puppyRef that does not correspond to any visible entry in this Showcase is rejected', async () => {
  const db = createFakeFirestore({ dogs: {} })
  const showcase = makeShowcase({ 'real-dog': { visible: true } })
  const forgedRef = 'a'.repeat(24) // well-formed shape, matches nothing
  const result = await resolveVisiblePuppyByRef(db, showcase, LITTER_ID, forgedRef, new Set(['real-dog']))
  return result === null
})

await checkAsync('G: resolveVisiblePuppyByRef() behavior is UNCHANGED for a normal dog with the correct litterId (the common case)', async () => {
  const dogId = 'normal-puppy'
  const db = createFakeFirestore({ dogs: { [dogId]: { tenantId: TENANT, litterId: LITTER_ID, name: 'Normal Puppy' } } })
  const showcase = makeShowcase({ [dogId]: { visible: true } })
  const puppyRef = opaquePuppyRef(LITTER_ID, dogId)
  // Deliberately pass an EMPTY litterPuppyIds set — a normal dog with a
  // correct litterId must resolve on that basis alone, never needing the
  // fallback set at all.
  const result = await resolveVisiblePuppyByRef(db, showcase, LITTER_ID, puppyRef, new Set())
  return result !== null && result.dogId === dogId && result.dog.name === 'Normal Puppy'
})

// =========================================================================
// SECTION 3 — call-site source verification: both endpoints pass
// litterPuppyIds built from their ALREADY-fetched litter document — no
// new Firestore read introduced by this fix.
// =========================================================================

{
  const mediaSrc = readFileSync(new URL('../api/showcase-media.js', import.meta.url), 'utf8')
  const enquirySrc = readFileSync(new URL('../api/create-showcase-enquiry.js', import.meta.url), 'utf8')
  const accessSrc = readFileSync(new URL('../api/_lib/showcase-media-access.js', import.meta.url), 'utf8')

  check('api/showcase-media.js passes litterPuppyIds built from the already-fetched litterSnap (no new Firestore read)',
    /const litterPuppyIds = new Set\(litterSnap\.data\(\)\.puppyIds \|\| \[\]\)/.test(mediaSrc) &&
    /resolveVisiblePuppyByRef\(db, showcase, litterId, puppyRef, litterPuppyIds\)/.test(mediaSrc))
  check('api/showcase-media.js does not add any additional db.collection(...).get() call beyond what already existed (litterShowcases, users, litters — the dog read itself lives inside resolveVisiblePuppyByRef, a different file)',
    (mediaSrc.match(/await db\.collection\(/g) || []).length === 3)
  check('api/create-showcase-enquiry.js passes litterPuppyIds built from the already-fetched litterSnap (no new Firestore read)',
    /const litterPuppyIds = new Set\(litterSnap\.data\(\)\.puppyIds \|\| \[\]\)/.test(enquirySrc) &&
    /resolveVisiblePuppyByRef\(db, showcase, litterId, sanitized\.puppyRef, litterPuppyIds\)/.test(enquirySrc))

  check('resolveVisiblePuppyByRef() imports and delegates to isValidShowcasePuppyDoc() — single source of truth, no separately-maintained duplicate check remains',
    /import \{ isValidShowcasePuppyDoc \} from '\.\/showcase-schema\.js'/.test(accessSrc) &&
    /isValidShowcasePuppyDoc\(dogId, dog, showcase\.tenantId, litterId, litterPuppyIds\)/.test(accessSrc) &&
    !/dog\.litterId !== litterId/.test(accessSrc)) // the old, now-removed stale inline check
}

await summary()
