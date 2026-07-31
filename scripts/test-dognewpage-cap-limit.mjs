// scripts/test-dognewpage-cap-limit.mjs — Codex fix-round, Finding 1
// (HIGH): src/pages/DogNewPage.tsx's checkLimit() used to count every dog
// whose status !== 'transferred' — including litter puppies, restricted,
// and archived dogs, none of which actually consume a plan slot. Fixed to
// use isDogEligibleForCap() (the same client-side mirror AppLayout's
// sidebar count already uses — see src/lib/utils.ts), which itself
// mirrors the server's real enforcement (api/_lib/dog-cap.js's
// isEligibleForCap()).
//
// DogNewPage is a React component with JSX/hooks that can't be rendered
// in this plain-Node script (no test renderer configured — see
// CLAUDE.md, and this repo's own established precedent in
// test-round15-dognew-single-flight.mjs). checkLimit()'s actual counting
// logic, though, is a simple, pure computation once you have the dogs
// array — `dogs.filter(isDogEligibleForCap).length`, then
// `isFreePlan && active.length >= FREE_DOG_LIMIT` — so this mirrors that
// exact computation using the REAL isDogEligibleForCap import (not a
// reimplementation, same pattern as test-litter-puppy-cap-v1.2.mjs's
// Section 1), plus a structural check (Section 2) proving the real file
// actually calls it, so the mirror can't silently drift from what's
// shipped.
//
// Usage: node scripts/test-dognewpage-cap-limit.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const { isDogEligibleForCap } = await import('../src/lib/utils.ts')

const FREE_DOG_LIMIT = 2
const FREE_PLANS = ['free', 'trial']

// Mirrors DogNewPage.tsx's checkLimit() computation exactly.
function checkLimitMirror(dogs, plan) {
  const active = dogs.filter(isDogEligibleForCap)
  const isFreePlan = FREE_PLANS.includes(plan ?? 'free')
  return { activeDogCount: active.length, blocked: isFreePlan && active.length >= FREE_DOG_LIMIT }
}

function adult(id, overrides = {}) {
  return { id, status: 'active', isDeceased: false, currentOwnerId: 'u1', tenantId: 'u1', ...overrides }
}
function litterPuppy(id, overrides = {}) {
  return adult(id, { litterId: 'litter-1', ...overrides })
}

// ── Required: 2 litter puppies do not block a Free user from adding an adult dog ──

{
  const dogs = [litterPuppy('p1'), litterPuppy('p2')]
  const result = checkLimitMirror(dogs, 'free')
  check('2 unpromoted litter puppies do not count toward the Free plan\'s 2-dog limit', result.activeDogCount === 0)
  check('A Free user with only 2 litter puppies is NOT blocked from adding an adult dog', result.blocked === false)
}

// ── Required: archived/restricted/deceased dogs do not consume UI slots ──

{
  const dogs = [
    adult('a1', { status: 'archived' }),
    adult('a2', { status: 'restricted' }),
    adult('a3', { isDeceased: true }),
  ]
  const result = checkLimitMirror(dogs, 'free')
  check('Archived, restricted, and deceased dogs are all excluded from the Free plan count', result.activeDogCount === 0)
  check('A Free user with only archived/restricted/deceased dogs is NOT blocked from adding a dog', result.blocked === false)
}

{
  const dogs = [adult('a1'), adult('a2', { status: 'archived' }), adult('a3', { status: 'restricted' }), litterPuppy('p1')]
  const result = checkLimitMirror(dogs, 'free')
  check('Mixed set: only the 1 genuinely active/eligible adult counts, not the archived/restricted/litter-puppy dogs alongside it', result.activeDogCount === 1)
  check('1 eligible adult is still under the Free 2-dog limit — not blocked', result.blocked === false)
}

// ── Required: counted (eligible) adults still enforce Free/Plus caps ──

{
  const dogs = [adult('a1'), adult('a2')]
  const result = checkLimitMirror(dogs, 'free')
  check('2 genuinely eligible adults on Free plan hits the cap exactly', result.activeDogCount === 2)
  check('A Free user at exactly 2 eligible adults IS blocked from adding a 3rd', result.blocked === true)
}

{
  // A litter puppy alongside 2 eligible adults must not itself trigger
  // blocking, but the 2 adults alone already do — proves the puppy isn't
  // accidentally EXCLUDED from being present without affecting the count.
  const dogs = [adult('a1'), adult('a2'), litterPuppy('p1'), litterPuppy('p2'), litterPuppy('p3')]
  const result = checkLimitMirror(dogs, 'free')
  check('3 litter puppies alongside 2 eligible adults: count is still exactly 2 (adults only)', result.activeDogCount === 2)
  check('Free user is correctly blocked once the 2 ELIGIBLE adults are present, regardless of how many litter puppies exist alongside them', result.blocked === true)
}

{
  const dogs = [adult('a1'), adult('a2'), adult('a3'), adult('a4'), adult('a5')]
  const result = checkLimitMirror(dogs, 'plus')
  check('5 eligible adults on Plus plan: checkLimit itself never blocks (Plus has no free-tier block — only the server-side cap applies at creation)', result.blocked === false)
  check('activeDogCount correctly reports 5 for a Plus account regardless of the (Plus-only) blocked flag', result.activeDogCount === 5)
}

// ── Structural: the real file actually calls isDogEligibleForCap, not
// the old status !== 'transferred' check, so this mirror can't drift
// from what's shipped ──

{
  const src = readFileSync(new URL('../src/pages/DogNewPage.tsx', import.meta.url), 'utf8')
  check('DogNewPage.tsx imports isDogEligibleForCap from lib/utils', /import\s*\{[^}]*isDogEligibleForCap[^}]*\}\s*from\s*'\.\.\/lib\/utils'/.test(src))
  check('checkLimit() calls dogs.filter(isDogEligibleForCap) — not the old status !== \'transferred\' check', /const active = dogs\.filter\(isDogEligibleForCap\)/.test(src))
  check('The old, stale status !== \'transferred\' cap-count check no longer appears anywhere in checkLimit()\'s computation', !/const active = dogs\.filter\(\(d: any\) => d\.status !== 'transferred'\)/.test(src))
}

await summary()
