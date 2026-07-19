// scripts/test-get-dogs-partial-data-safety.mjs — regression coverage
// for getDogs()'s fail-closed guarantee (Codex round 13, Blocker 1).
//
// Root cause recap: round 12 changed getDogs() (src/lib/db.ts) — the
// canonical source EVERY "My Dogs"/Sire/Dam selector/sidebar count/
// reminders/reports/buyers/documents/exports view in this app relies on
// — from Promise.all to Promise.allSettled, so that a transient failure
// on ONE of the two ownership queries (tenantId, currentOwnerId) didn't
// blank the whole list. Well-intentioned, but it meant a caller had NO
// way to tell "genuinely zero/fewer dogs" apart from "some of the data
// failed to load" — a PARTIAL array presented itself as a perfectly
// normal COMPLETE one. That's worse than the outage it softened: a real
// dog silently missing from My Dogs or a Sire dropdown, with no error
// anywhere, is exactly the "missing Sire" symptom this whole
// remediation effort was trying to explain.
//
// Round 13 reverts getDogs() to Promise.all (fail-closed): either BOTH
// queries succeed and the full, deduplicated list is returned, or the
// call rejects with a sanitized GetDogsError — never a partial array
// silently standing in for a complete one.
//
// This file mirrors getDogs()'s actual current logic (merge/dedup by
// doc id, the tenantId-vs-currentOwnerId "transferred" override, the
// fail-closed try/catch) as a standalone testable function, since the
// real getDogs() is a TypeScript function using the Firebase Web SDK —
// unlike the Admin-SDK emulator tests elsewhere in this suite,
// simulating "one Firestore query fails while a sibling query for the
// same collection/user succeeds" against a real emulator isn't
// something Firestore Rules evaluation can be coaxed into deterministically
// (both queries normally succeed or fail together for the same
// user/rules). Mirroring the algorithm with injected mock query
// functions is the established pattern this test suite already uses
// for src/lib/db.ts logic (see test-sire-eligibility.mjs's mergeDedup
// mirror) and is combined with source-pattern checks against the real
// file so the mirror can't silently drift from what's actually shipped.
//
// Usage: node scripts/test-get-dogs-partial-data-safety.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, summary } = makeChecker()

// ── Mirror of getDogs()'s actual current logic ──
class GetDogsErrorMirror extends Error {
  constructor(message = 'Failed to load dogs. Please try again.') {
    super(message)
    this.name = 'GetDogsError'
  }
}

async function getDogsMirror(currentUid, queryTenant, queryOwner) {
  if (!currentUid) return []

  let breederSnap, ownerSnap
  try {
    [breederSnap, ownerSnap] = await Promise.all([queryTenant(), queryOwner()])
  } catch {
    throw new GetDogsErrorMirror()
  }

  const dogMap = new Map()
  breederSnap.docs.forEach(d => { dogMap.set(d.id, { ...d.data(), id: d.id }) })
  ownerSnap.docs.forEach(d => { dogMap.set(d.id, { ...d.data(), id: d.id }) })

  return Array.from(dogMap.values()).map(dog => {
    if (dog.tenantId === currentUid && dog.currentOwnerId !== currentUid) {
      return { ...dog, status: 'transferred' }
    }
    return dog
  })
}

function fakeSnap(docs) {
  return { docs: docs.map(data => ({ id: data.id, data: () => data })) }
}

// =========================================================================
// SECTION 1 — both queries succeed
// =========================================================================
await checkAsync('both queries succeed: returns the full merged list',
  (async () => {
    const dogs = await getDogsMirror(
      'breeder-1',
      async () => fakeSnap([{ id: 'a', tenantId: 'breeder-1', currentOwnerId: 'breeder-1', name: 'A' }]),
      async () => fakeSnap([{ id: 'b', tenantId: 'other', currentOwnerId: 'breeder-1', name: 'B' }]),
    )
    return dogs.length === 2 && dogs.some(d => d.id === 'a') && dogs.some(d => d.id === 'b')
  })())

// =========================================================================
// SECTION 2 — tenant query fails: the WHOLE call rejects, never a
// partial (owner-only) array
// =========================================================================
await checkAsync('tenant query fails: rejects rather than returning the owner-only partial results',
  (async () => {
    let threw = false
    try {
      await getDogsMirror(
        'breeder-1',
        async () => { throw new Error('permission-denied') },
        async () => fakeSnap([{ id: 'b', tenantId: 'other', currentOwnerId: 'breeder-1', name: 'B' }]),
      )
    } catch (err) {
      threw = err instanceof GetDogsErrorMirror
    }
    return threw
  })())

// =========================================================================
// SECTION 3 — owner query fails: the WHOLE call rejects, never a
// partial (tenant-only) array
// =========================================================================
await checkAsync('owner query fails: rejects rather than returning the tenant-only partial results',
  (async () => {
    let threw = false
    try {
      await getDogsMirror(
        'breeder-1',
        async () => fakeSnap([{ id: 'a', tenantId: 'breeder-1', currentOwnerId: 'breeder-1', name: 'A' }]),
        async () => { throw new Error('permission-denied') },
      )
    } catch (err) {
      threw = err instanceof GetDogsErrorMirror
    }
    return threw
  })())

// =========================================================================
// SECTION 4 — one query resolves EMPTY while the other rejects: still a
// full rejection, never treated as "0 dogs from that side, N from the
// other" (the specific shape that would otherwise let a real account
// with zero originally-created dogs but several transferred-in ones look
// like it has zero dogs at all, or vice versa)
// =========================================================================
await checkAsync('one query resolves empty while the other rejects: still rejects, not a false "0 dogs" or silent partial result',
  (async () => {
    let threw = false
    try {
      await getDogsMirror(
        'breeder-1',
        async () => fakeSnap([]), // genuinely zero originally-created dogs
        async () => { throw new Error('network error') },
      )
    } catch (err) {
      threw = err instanceof GetDogsErrorMirror
    }
    return threw
  })())

// =========================================================================
// SECTION 5 — deduplication: a dog matching BOTH queries (the common
// case — a breeder's own still-owned dog) appears exactly once
// =========================================================================
await checkAsync('a dog matching both tenantId and currentOwnerId queries is deduplicated to one entry',
  (async () => {
    const shared = { id: 'dup1', tenantId: 'breeder-1', currentOwnerId: 'breeder-1', name: 'Rex' }
    const dogs = await getDogsMirror(
      'breeder-1',
      async () => fakeSnap([shared]),
      async () => fakeSnap([shared]),
    )
    return dogs.length === 1 && dogs[0].id === 'dup1'
  })())

// =========================================================================
// SECTION 6 — failure can never become a normal empty/partial result:
// exhaustively confirms every failure combination rejects with the SAME
// sanitized error type, never resolves at all
// =========================================================================
{
  const scenarios = [
    ['both reject', async () => { throw new Error('boom') }, async () => { throw new Error('boom') }],
    ['tenant rejects, owner resolves non-empty', async () => { throw new Error('boom') }, async () => fakeSnap([{ id: 'x', tenantId: 'other', currentOwnerId: 'breeder-1' }])],
    ['owner rejects, tenant resolves non-empty', async () => fakeSnap([{ id: 'x', tenantId: 'breeder-1', currentOwnerId: 'breeder-1' }]), async () => { throw new Error('boom') }],
    ['tenant rejects, owner resolves empty', async () => { throw new Error('boom') }, async () => fakeSnap([])],
    ['owner rejects, tenant resolves empty', async () => fakeSnap([]), async () => { throw new Error('boom') }],
  ]
  for (const [label, qTenant, qOwner] of scenarios) {
    await checkAsync(`failure never resolves as a normal result (${label})`,
      (async () => {
        let resolved = false
        let rejectedWithSanitizedError = false
        try {
          await getDogsMirror('breeder-1', qTenant, qOwner)
          resolved = true
        } catch (err) {
          rejectedWithSanitizedError = err instanceof GetDogsErrorMirror
        }
        return !resolved && rejectedWithSanitizedError
      })())
  }
}

// =========================================================================
// SECTION 7 — the sanitized error never leaks the raw underlying cause
// (no Firestore internals, no query/index details) into the message a
// UI-facing catch block might display
// =========================================================================
await checkAsync('the thrown error message is the fixed, sanitized string — never the raw underlying Firestore error text',
  (async () => {
    let message = ''
    try {
      await getDogsMirror(
        'breeder-1',
        async () => { throw new Error('FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/...&secret=xyz') },
        async () => fakeSnap([]),
      )
    } catch (err) {
      message = err.message
    }
    return message === 'Failed to load dogs. Please try again.' && !message.includes('secret') && !message.includes('console.firebase.google.com')
  })())

// =========================================================================
// SECTION 8 — source-pattern checks against the REAL src/lib/db.ts, so
// the mirror above can never silently drift from what's actually shipped
// =========================================================================
{
  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  const getDogsBlockMatch = dbSrc.match(/export async function getDogs\(\)[\s\S]*?\r?\n}\r?\n/)
  const getDogsBlock = getDogsBlockMatch ? getDogsBlockMatch[0] : ''

  check('getDogs() source was actually located for inspection (sanity check on the pattern above)', getDogsBlock.length > 0)
  check('getDogs() uses Promise.all (fail-closed), not Promise.allSettled, for its two ownership queries',
    /Promise\.all\(\[/.test(getDogsBlock) && !/Promise\.allSettled/.test(getDogsBlock))
  check('getDogs() throws a typed GetDogsError on failure, not the raw Firestore error',
    /throw new GetDogsError\(\)/.test(getDogsBlock))
  check('getDogs() logs the raw error to console for debugging (full detail is not lost, only kept out of the thrown message)',
    /console\.error\(['"]getDogs\(\)/.test(getDogsBlock))
  check('GetDogsError is exported (so UI consumers can distinguish it from other failures if they choose to)',
    /export class GetDogsError extends Error/.test(dbSrc))
  check('getDogs() still merges results through a Map keyed by doc id (dedup preserved)',
    /const dogMap = new Map<string, Dog>\(\)/.test(getDogsBlock) && /dogMap\.set\(d\.id,/.test(getDogsBlock))
  check('getDogs() still queries by tenantId (UID-scoped, unchanged)',
    /where\('tenantId', '==', currentUid\)/.test(getDogsBlock))
  check('getDogs() still queries by currentOwnerId (UID-scoped, unchanged)',
    /where\('currentOwnerId', '==', currentUid\)/.test(getDogsBlock))
  check('getDogs() still re-derives "transferred" for the former breeder viewpoint (ownership/tenant behavior preserved)',
    /dog\.tenantId === currentUid && dog\.currentOwnerId !== currentUid/.test(getDogsBlock))
}

// =========================================================================
// SECTION 9 — UI consumers show an explicit load/retry error on a
// getDogs() failure, never a misleading "no Dogs"/"no eligible Sire"
// that's indistinguishable from a genuinely empty result. Source-pattern
// checks against the three consumers actually changed this round; the
// other ~11 consumers already had adequate error handling from before
// round 12 ever changed getDogs()'s contract (see the round-13 report's
// consumer audit) and were left untouched.
// =========================================================================
{
  const listSrc = readFileSync(new URL('../src/pages/DogListPage.tsx', import.meta.url), 'utf8')
  check('DogListPage (My Dogs) tracks a distinct loadError state, separate from a genuinely empty dogs array',
    /const \[loadError, setLoadError\] = useState/.test(listSrc))
  check('DogListPage shows an explicit retry UI on load failure, not the "No dogs yet" empty state',
    /loadError \?/.test(listSrc) && /Couldn't load your dogs/.test(listSrc))
  check('DogListPage\'s retry button re-invokes the load function',
    /onClick=\{loadDogs\}/.test(listSrc))

  const layoutSrc = readFileSync(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')
  check('AppLayout dog count uses number | null (null = unknown/failed), never defaulting a failure to 0',
    /useState<number \| null>\(null\)/.test(layoutSrc.match(/dogCount,\s*setDogCount[\s\S]{0,80}/)?.[0] || ''))
  check('AppLayout no longer sets dogCount to 0 on a getDogs() failure',
    !/setDogCount\(0\)/.test(layoutSrc))
  check('AppLayout renders a neutral placeholder ("—") instead of a numeric dogCount when it is null',
    /dogCount === null \? .—.\s*:\s*dogCount/.test(layoutSrc))

  const detailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
  check('DogDetailPage BreedingTab tracks a distinct sireLoadError state, separate from genuinely zero eligible Sires',
    /const \[sireLoadError, setSireLoadError\] = useState/.test(detailSrc))
  check('The Sire dropdown\'s empty state distinguishes a load failure from "no eligible Sire" and from "no male dogs at all"',
    /sireLoadError \? .[^:]*Could not load your dogs/.test(detailSrc))
}

await summary()
