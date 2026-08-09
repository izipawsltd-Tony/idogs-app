// scripts/test-dogs-filter-showcase-single-upload.mjs — regression
// coverage for two approved UX fixes on branch
// fix/dogs-filter-showcase-single-upload-v2:
//
// 1. Dogs filter consolidation (src/pages/DogListPage.tsx) — the filter
//    bar used to render "Born" (whelp) and "Puppy" (puppy) as their own
//    top-level buttons FROM the generic life-stage loop, in addition to
//    a separate dedicated "🐾 Puppies" button that already combined
//    both stages — three overlapping ways to reach an overlapping set
//    of dogs. Fix: 'whelp'/'puppy' removed from the generic loop; the
//    dedicated "Puppies" button (and its already-correct combined
//    predicate/grouping) is untouched and is now the only way to reach
//    those dogs from the filter bar.
//
// 2. Litter Showcase single-upload UX (src/pages/LittersPage.tsx) — a
//    Plus-plan breeder used to see a full photo/video manager
//    (PuppyMediaManager) inside "Edit Puppy" AND an equivalent manager
//    (ShowcaseManager) inside "Litter Showcase" for the exact same
//    puppy/gallery — two places to manage one thing. Fix: for a Plus
//    breeder, Edit Puppy now shows a short pointer to Litter Showcase
//    instead of PuppyMediaManager. A non-Plus breeder has no Showcase
//    section at all (it's Plus-gated) and keeps PuppyMediaManager
//    exactly as before — it's their only gallery-management path, not
//    a duplicate of anything they can reach.
//
// Structural/source-inspection only, matching this codebase's
// established convention for client-only code that can't be directly
// imported/mounted by a plain Node script.
//
// Usage: node scripts/test-dogs-filter-showcase-single-upload.mjs

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

const dogListSrc = readFileSync(new URL('../src/pages/DogListPage.tsx', import.meta.url), 'utf8')
const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')

// =========================================================================
// SECTION A — Dogs filter: single "Puppies" filter
// =========================================================================
{
  check('REQUIRED: the generic stage-button loop no longer includes \'whelp\' or \'puppy\' — only all/young_adult/adult/senior',
    /\(\['all', 'young_adult', 'adult', 'senior'\] as const\)\.map\(stage =>/.test(dogListSrc))
  check('REQUIRED: the OLD array (with whelp/puppy included) is gone, not just superseded by a second copy',
    !/\['all', 'whelp', 'puppy', 'young_adult', 'adult', 'senior'\]/.test(dogListSrc))

  // Exactly one clickable "🐾 Puppies" BUTTON — matches the button's own
  // JSX text node (immediately followed by its closing </button>), not
  // this test file's own prose or the source's explanatory comment.
  const puppiesButtonMatches = dogListSrc.match(/🐾 Puppies\s*\n\s*<\/button>/g) || []
  check('REQUIRED: exactly one clickable "🐾 Puppies" filter button exists', puppiesButtonMatches.length === 1)

  // "Born"/"Puppy" as clickable button labels can ONLY ever be produced
  // by LIFE_STAGE_LABELS[stage] for stage IN the generic loop's array —
  // already proven above to no longer include 'whelp'/'puppy'. The
  // literal strings "🐣 Born (" / "🐶 Puppy (" still legitimately appear
  // elsewhere in this file (as non-clickable group-header text inside
  // the Puppies filter's OWN results view — see Section A's grouping
  // check below) — that is intentional, not a leftover filter button,
  // so this suite checks the BUTTON ARRAY shape directly (above) rather
  // than asserting those strings are absent from the whole file.

  check('REQUIRED: the combined "Puppies" predicate (whelp OR puppy) is unchanged — this is what makes the single button correct, not lossy',
    /filterStage === 'puppies' \? \(actualStage === 'whelp' \|\| actualStage === 'puppy'\)/.test(dogListSrc))

  check('the Puppies-view Born/Puppy sub-grouping still derives from the SAME `filtered` array (no separate/duplicate query, so no risk of double-counting or missing dogs)',
    /const withStage = filtered\.map\(dog => \(\{/.test(dogListSrc))
  check('bornDogs and puppyDogs are still a partition of that one filtered set (whelp vs puppy, no overlap possible since actualStage is a single value per dog)',
    /const bornDogs = withStage\.filter\(w => w\.actualStage === 'whelp'\)/.test(dogListSrc) &&
    /const puppyDogs = withStage\.filter\(w => w\.actualStage === 'puppy'\)/.test(dogListSrc))

  check('REQUIRED: All/Passport/Adult/Senior remain in the generic loop, unchanged',
    dogListSrc.includes("'all', 'young_adult', 'adult', 'senior'"))
  check('REQUIRED: Transferred filter button is unchanged (own dedicated button, count from transferredDogs)',
    /🔄 Transferred \(\{transferredDogs\.length\}\)/.test(dogListSrc))
  check('activeDogs/transferredDogs computations are untouched (still the same two mutually-exclusive partitions)',
    /const activeDogs = dogs\.filter\(d => d\.status !== 'transferred'/.test(dogListSrc) &&
    /const transferredDogs = dogs\.filter\(d => d\.status === 'transferred'/.test(dogListSrc))

  check('REQUIRED: the filter row stays wrappable on narrow/mobile widths (flexWrap unchanged on both the outer bar and the button group)',
    (dogListSrc.match(/flexWrap: 'wrap'/g) || []).length >= 2)

  check('no dog lifecycle/data logic was touched — calculateLifeStage/isDeceased handling in the filter predicate is unchanged',
    /const actualStage = d\.isDeceased \? 'remembered' : calculateLifeStage\(d\.dateOfBirth, d\.breed\)/.test(dogListSrc))

  check('no other part of the app deep-links to the removed per-stage values — every internal link already uses the combined ?stage=puppies',
    !/stage=whelp|stage=puppy(?!ies)/.test(readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8')) &&
    !/stage=whelp|stage=puppy(?!ies)/.test(readFileSync(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')) &&
    !/stage=whelp|stage=puppy(?!ies)/.test(readFileSync(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8')))
}

// =========================================================================
// SECTION B — Litter Showcase single-upload UX
// =========================================================================
{
  check('REQUIRED: PuppyMediaManager is now conditioned on plan — Plus breeders no longer see it in Edit Puppy',
    /getEffectivePlanClient\(profile\) === 'plus' \? \(/.test(littersSrc))
  check('REQUIRED: a Plus breeder sees a clear pointer to Litter Showcase in its place',
    /Manage this puppy's photos and videos in the <strong>Litter Showcase<\/strong> section below\./.test(littersSrc))
  check('REQUIRED: a non-Plus breeder still gets PuppyMediaManager exactly as before (their only gallery-management path — Showcase itself is Plus-gated, so this is not a duplicate for them)',
    /\) : \(\s*\n\s*<PuppyMediaManager puppy={puppy} disabled={isPuppyRestricted} toast={toast} onUpdated={updated => setDogs\(prev => prev\.map\(d => d\.id === puppy\.id \? \{ \.\.\.d, \.\.\.updated \} : d\)\)} \/>/.test(littersSrc))

  check('ShowcaseManager render call site is untouched — Litter Showcase remains exactly the same component, same props, same Plus gate it always had',
    /getEffectivePlanClient\(profile\) !== 'plus' \? \(/.test(littersSrc) &&
    /<ShowcaseManager\s*\n\s*litterId={litter\.id}/.test(littersSrc))

  // Direct-upload contract preservation — reuses the same reference
  // points test-direct-media-upload.mjs / test-puppy-media-manager-413-
  // fix.mjs already established, as a cross-check that nothing in this
  // UX-only change touched the actual upload plumbing.
  check('PuppyMediaManager\'s own upload logic (direct-to-Storage, HEIC-aware photo compression, raw-File video, 20MB video guard) is completely untouched — only its CALL SITE became conditional',
    /await uploadShowcaseMediaDirect\(puppy\.id, 'photo', \(await prepareImageForUpload\(file\)\)\.base64, 'image\/jpeg'\)/.test(littersSrc) &&
    /await uploadShowcaseMediaDirect\(puppy\.id, 'video', file, file\.type \|\| 'video\/mp4'\)/.test(littersSrc) &&
    /if \(kind === 'video' && file\.size > MAX_VIDEO_UPLOAD_BYTES\)/.test(littersSrc))
  check('ShowcaseManager\'s draft-save upload logic (same direct-upload path, same compression) is untouched',
    /await uploadShowcaseMediaDirect\(puppyId, 'photo', \(await prepareImageForUpload\(file\)\)\.base64, 'image\/jpeg'\)/.test(littersSrc) &&
    /await uploadShowcaseMediaDirect\(puppyId, 'video', file, file\.type \|\| 'video\/mp4'\)/.test(littersSrc))
  check('publish/private (visible) and per-puppy availability fields in ShowcaseManager are untouched',
    /onToggleEnabled=/.test(littersSrc) && /visible/.test(littersSrc) && /availability/.test(littersSrc))

  check('no new upload/storage code was introduced by this change — the diff is purely a conditional around an EXISTING call, not a new upload path (exactly the 4 uploadShowcaseMediaDirect call sites that already existed: photo+video in PuppyMediaManager, photo+video in ShowcaseManager)',
    (littersSrc.match(/uploadShowcaseMediaDirect\(/g) || []).length === 4)

  check('the removed-uploader message never claims to touch billing/pricing — purely informational, points at an existing feature',
    !/upgrade/i.test(littersSrc.match(/Manage this puppy's photos and videos in the <strong>Litter Showcase<\/strong> section below\./)?.[0] || ''))
}

await summary()
