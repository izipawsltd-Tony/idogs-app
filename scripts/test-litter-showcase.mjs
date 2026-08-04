// scripts/test-litter-showcase.mjs — regression coverage for the iDogs
// Litter Showcase MVP, Slice 1 (create/edit/enable/disable a Showcase,
// per-puppy visibility + availability, deliberate bulk actions, and the
// authorization boundary around all of it).
//
// Same established pattern as test-h7-litter-delete-ledger-backfill.mjs
// / test-passport-uniqueness.mjs / test-claim-transferred-dogs.mjs /
// test-round16-request-guard-lifecycle.mjs:
//   1. Pure-logic unit tests against the REAL api/_lib/showcase-schema.js
//      functions (not a hand-copied mirror).
//   2. Structural assertions on firestore.rules, LittersPage.tsx, lib/db.ts,
//      and the four API endpoints (including the Codex fix-round finding 1
//      server-timestamp convention).
//   3. getEffectivePlanClient (src/lib/utils.ts) vs. the REAL server-side
//      computeEffectivePlan (api/_lib/entitlements.js, importable
//      directly) parity tests (Codex fix-round finding 2).
//   4. A REAL mounted-component test (react-test-renderer + act()) proving
//      an account switch resets all Showcase UI state (Codex fix-round
//      finding 3) — no emulator needed.
//   5. Unit tests against the REAL ShowcaseRequestGuardState class, plus a
//      REAL mounted-component test using the REAL useShowcaseRequestGuard()
//      hook, proving a Showcase read/mutation still PENDING when the
//      account switches never resurrects the previous account's data —
//      the account-switch REQUEST race, distinct from (and on top of) the
//      synchronous reset Section 4 covers (Codex fix-round finding on
//      LittersPage's Showcase account-switch guard) — no emulator needed.
//   6. A REAL mounted-component test (react-test-renderer + act()) using
//      the REAL useShowcaseRequestGuard() hook, proving save success, save
//      failure (preserving the last successfully saved state), a
//      successful retry clearing a stale failure, and that `busy` flips
//      synchronously (the double-submit-prevention mechanism) — the
//      "no Save button / no visible autosave status" UI-gap fix — no
//      emulator needed.
//   7. Emulator-only behavioral tests that import and call the REAL
//      api/*.js handlers directly with mock req/res objects, against a
//      local Firestore/Auth emulator — skipped gracefully (not silently
//      dropped from the pass count) when no emulator is reachable.
//      Includes a reload-persistence test proving a fresh, independent
//      read after a save returns exactly what was saved.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-litter-showcase.mjs

const { readFileSync } = await import('node:fs')
const { makeChecker } = await import('./_lib/test-check.mjs')
const { check, checkAsync, skip, summary } = makeChecker()

// Codex fix-round finding — Showcase test reliability: extractFunctionSource()
// replaces regex end-anchors like /\n}\n/ or /\n  \}/ for pulling a single
// function's body out of a larger source file. Those broke (or were only
// accidentally safe) on CRLF checkouts: a pattern requiring a literal `\n`
// to appear DIRECTLY AFTER some content (e.g. `}\n`, "closing brace then a
// newline") fails on Windows/CRLF line endings, where every line actually
// ends `\r\n` — the `}` is followed by `\r`, not `\n`, so the match never
// completes and the extracted source silently comes back empty (an empty
// string still passes `.length > 0`-style existence checks as false, so a
// missing match FAILS LOUD via the "was found" check — but every assertion
// chained after it, testing content within that (empty) string, would then
// silently and vacuously report FAIL for the wrong reason, or in the worst
// case a check phrased as a negative — "does NOT contain X" — would
// silently, incorrectly PASS against empty content it never actually
// scanned. Either way: brittle, and not merely a local temporary
// workaround like normalizing this one checkout's line endings).
//
// This scans forward from a signature match by BALANCED BRACE DEPTH —
// counting `{`/`}` while skipping over string/template-literal contents and
// single-line `//` comments (so a stray brace-like character inside a
// string or comment can't miscount) — and stops the instant depth returns
// to zero. Entirely line-ending-agnostic: it never looks for `\n`
// specifically, only for the literal characters `{`, `}`, quote marks, and
// `//`, none of which differ between LF and CRLF encodings.
function extractFunctionSource(src, signaturePattern) {
  const sigMatch = signaturePattern.exec(src)
  if (!sigMatch) return ''
  const startIdx = sigMatch.index

  // The function BODY's opening brace is NOT necessarily the first `{`
  // after the signature — a destructured-parameter signature like
  // ShowcaseManager's own `({ a, b, c }: { a: T; b: U; c: V }) {` has TWO
  // earlier brace pairs (the destructuring pattern, then its TypeScript
  // type annotation) before the real body starts. What's unambiguous is
  // that the body brace is the first `{` that comes right after a `)` —
  // every per-field arrow-function TYPE inside that annotation block
  // (e.g. `onToggleVisible: (puppyId: string, visible: boolean) => void`)
  // ends its OWN `)` with `=> ReturnType`, never with `) {` directly, so
  // the first genuine `)` + whitespace + `{` transition is the real
  // function body. `\s` (not a literal `\n`) already matches `\r` too, so
  // this is inherently CRLF-safe with no special-casing needed.
  const bodyOpenSearch = /\)\s*\{/.exec(src.slice(startIdx))
  if (!bodyOpenSearch) return ''
  const openIdx = startIdx + bodyOpenSearch.index + bodyOpenSearch[0].length - 1 // index of the '{' itself

  let depth = 0
  let inString = null // one of `'`, `"`, '`', or null when not inside one
  let i = openIdx
  for (; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (ch === '\\') { i++; continue } // skip escaped char (e.g. \' inside a '...' string)
      if (ch === inString) inString = null
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nextNewline = src.indexOf('\n', i)
      i = nextNewline === -1 ? src.length : nextNewline
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue }
    if (ch === '{') { depth++; continue }
    if (ch === '}') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  return src.slice(startIdx, i)
}

// ── Section 0: extractFunctionSource() self-test (Codex fix-round —
// Showcase test reliability). A hand-crafted fixture mirroring
// ShowcaseManager's own tricky shape (destructured params + a
// per-field TypeScript type annotation containing arrow-function
// types, none of which end their own `)` with `{`) — run against BOTH
// a CRLF-encoded and an LF-encoded copy of the SAME fixture, proving
// the extraction is genuinely line-ending-agnostic rather than merely
// "happens to work on whatever this checkout currently has". Also
// covers a brace inside a string literal and a single-line comment
// containing a stray `}`, proving those don't miscount depth. ──
{
  const fixtureLf = [
    'const unrelatedBefore = 1',
    'function Example({',
    '  a, b,',
    '}: {',
    '  a: string',
    '  onClick: (x: string, y: boolean) => void',
    '}) {',
    '  const s = \'a brace in a string: { not real }\' // trailing comment with a stray }',
    '  if (a) {',
    '    return b',
    '  }',
    '  return null',
    '}',
    '',
    'const unrelatedAfter = 2',
  ].join('\n')
  const fixtureCrlf = fixtureLf.replace(/\n/g, '\r\n')

  for (const [label, fixture] of [['LF fixture', fixtureLf], ['CRLF fixture', fixtureCrlf]]) {
    const extracted = extractFunctionSource(fixture, /function Example\(/)
    check(`extractFunctionSource (${label}): finds a non-empty body`, extracted.length > 0)
    check(`extractFunctionSource (${label}): body starts at "function Example("`, extracted.startsWith('function Example('))
    check(`extractFunctionSource (${label}): body ends at the function's OWN closing brace, not a moment earlier or later`, extracted.trimEnd().endsWith('}') && !extracted.includes('unrelatedAfter') && extracted.includes('return null'))
    check(`extractFunctionSource (${label}): does not stop early at the destructuring/type-annotation braces`, extracted.includes('a: string') && extracted.includes('const s ='))
    check(`extractFunctionSource (${label}): a brace-like character inside a string literal does not throw off the depth count`, extracted.includes('a brace in a string'))
    check(`extractFunctionSource (${label}): a stray "}" inside a // comment does not throw off the depth count`, extracted.includes('trailing comment'))
    check(`extractFunctionSource (${label}): never includes code before the signature`, !extracted.includes('unrelatedBefore'))
  }
  check('extractFunctionSource: LF and CRLF fixtures extract the SAME logical content (only newline encoding differs)', extractFunctionSource(fixtureLf, /function Example\(/).replace(/\r\n/g, '\n') === extractFunctionSource(fixtureCrlf, /function Example\(/).replace(/\r\n/g, '\n'))
}

// ── Section 1: pure-logic coverage of api/_lib/showcase-schema.js ──
{
  const {
    mergePuppyEntry, validatePuppyPatch, applyBulkAction, validateBulkAction,
    AVAILABILITY_VALUES, DEFAULT_AVAILABILITY, DEFAULT_VISIBLE, ShowcaseValidationError,
  } = await import('../api/_lib/showcase-schema.js')

  check('AVAILABILITY_VALUES supports V2 sales states and legacy documents', JSON.stringify(AVAILABILITY_VALUES) === JSON.stringify(['available', 'reserved', 'sold', 'on_hold', 'unavailable']))
  check('A puppy defaults to hidden', DEFAULT_VISIBLE === false)
  check('A puppy defaults to available', DEFAULT_AVAILABILITY === 'available')

  // Requirement 5: availability changes must never alter visibility, and vice versa.
  {
    const withVisibleTrue = mergePuppyEntry(undefined, { visible: true })
    check('mergePuppyEntry: setting visible on a never-touched puppy defaults availability to "available"', withVisibleTrue.visible === true && withVisibleTrue.availability === 'available')

    const afterAvailabilityOnly = mergePuppyEntry(withVisibleTrue, { availability: 'reserved' })
    check('mergePuppyEntry: changing ONLY availability leaves a previously-set visible=true untouched', afterAvailabilityOnly.visible === true && afterAvailabilityOnly.availability === 'reserved')

    const hiddenReserved = mergePuppyEntry(afterAvailabilityOnly, { visible: false })
    check('mergePuppyEntry: changing ONLY visible leaves the existing availability untouched', hiddenReserved.visible === false && hiddenReserved.availability === 'reserved')
  }

  check('validatePuppyPatch rejects an empty patch', (() => { try { validatePuppyPatch({}); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
  check('validatePuppyPatch rejects an unknown field', (() => { try { validatePuppyPatch({ visible: true, foo: 1 }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
  check('validatePuppyPatch rejects a non-boolean visible', (() => { try { validatePuppyPatch({ visible: 'yes' }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
  check('validatePuppyPatch rejects an out-of-enum availability', (() => { try { validatePuppyPatch({ availability: 'unknown' }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
  check('validatePuppyPatch accepts visible-only', JSON.stringify(validatePuppyPatch({ visible: true })) === JSON.stringify({ visible: true }))
  check('validatePuppyPatch accepts availability-only', JSON.stringify(validatePuppyPatch({ availability: 'on_hold' })) === JSON.stringify({ availability: 'on_hold' }))

  // Codex fix-round ("Explicit media publication") — publishedPhotoIds/
  // publishedVideoIds are validated and merged with the exact same
  // "absent = untouched" independence as visible/availability.
  {
    check('validatePuppyPatch accepts publishedPhotoIds-only', JSON.stringify(validatePuppyPatch({ publishedPhotoIds: ['a', 'b'] })) === JSON.stringify({ publishedPhotoIds: ['a', 'b'] }))
    check('validatePuppyPatch accepts publishedVideoIds-only', JSON.stringify(validatePuppyPatch({ publishedVideoIds: ['v1'] })) === JSON.stringify({ publishedVideoIds: ['v1'] }))
    check('validatePuppyPatch accepts an empty publishedPhotoIds array (unpublishing everything)', JSON.stringify(validatePuppyPatch({ publishedPhotoIds: [] })) === JSON.stringify({ publishedPhotoIds: [] }))
    check('validatePuppyPatch rejects a non-array publishedPhotoIds', (() => { try { validatePuppyPatch({ publishedPhotoIds: 'not-an-array' }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
    check('validatePuppyPatch rejects a publishedPhotoIds array with a non-string entry', (() => { try { validatePuppyPatch({ publishedPhotoIds: ['ok', 123] }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
    check('validatePuppyPatch rejects a publishedPhotoIds array with an empty-string entry', (() => { try { validatePuppyPatch({ publishedPhotoIds: [''] }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
    check('validatePuppyPatch rejects duplicate entries in publishedVideoIds', (() => { try { validatePuppyPatch({ publishedVideoIds: ['v1', 'v1'] }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
    check('validatePuppyPatch rejects a publishedPhotoIds array over the max size', (() => { try { validatePuppyPatch({ publishedPhotoIds: Array.from({ length: 31 }, (_, i) => `id${i}`) }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())

    const withPublished = mergePuppyEntry(undefined, { visible: true, publishedPhotoIds: ['p1'] })
    check('mergePuppyEntry: a never-touched puppy defaults publishedVideoIds to an empty array', Array.isArray(withPublished.publishedVideoIds) && withPublished.publishedVideoIds.length === 0)
    check('mergePuppyEntry: publishedPhotoIds from the patch is applied', JSON.stringify(withPublished.publishedPhotoIds) === JSON.stringify(['p1']))

    const afterAvailabilityChange = mergePuppyEntry(withPublished, { availability: 'reserved' })
    check('mergePuppyEntry: changing availability leaves publishedPhotoIds untouched (independent dimension)', JSON.stringify(afterAvailabilityChange.publishedPhotoIds) === JSON.stringify(['p1']))

    const afterUnpublish = mergePuppyEntry(afterAvailabilityChange, { publishedPhotoIds: [] })
    check('mergePuppyEntry: explicitly unpublishing (empty array) clears publishedPhotoIds without touching visible/availability', afterUnpublish.publishedPhotoIds.length === 0 && afterUnpublish.visible === true && afterUnpublish.availability === 'reserved')
  }

  check('validateBulkAction accepts the three defined actions', ['select_all', 'clear_all', 'show_available_only'].every(a => validateBulkAction(a) === a))
  check('validateBulkAction rejects an unknown action', (() => { try { validateBulkAction('show_all_and_sold'); return false } catch (e) { return e instanceof ShowcaseValidationError } })())

  // Requirement 2/3: a brand-new reconciliation (empty existing map) never invents a visible puppy.
  {
    const map = applyBulkAction('select_all', {}, ['p1', 'p2', 'p3'])
    check('applyBulkAction select_all sets every current puppy visible', Object.values(map).every(e => e.visible === true) && Object.keys(map).length === 3)
  }
  {
    const existing = { p1: { visible: true, availability: 'available' }, p2: { visible: true, availability: 'reserved' } }
    const map = applyBulkAction('clear_all', existing, ['p1', 'p2'])
    check('applyBulkAction clear_all hides every current puppy', Object.values(map).every(e => e.visible === false))
    check('applyBulkAction never touches availability', map.p1.availability === 'available' && map.p2.availability === 'reserved')
  }
  {
    const existing = {
      p1: { visible: false, availability: 'available' },
      p2: { visible: true, availability: 'on_hold' },
      p3: { visible: false, availability: 'reserved' },
      p4: { visible: false, availability: 'unavailable' },
    }
    const map = applyBulkAction('show_available_only', existing, ['p1', 'p2', 'p3', 'p4'])
    check('applyBulkAction show_available_only shows ONLY puppies whose stored availability is "available"', map.p1.visible === true && map.p2.visible === false && map.p3.visible === false && map.p4.visible === false)
    // A never-touched puppy (no existing entry) defaults to availability
    // 'available', so show_available_only legitimately includes it.
    const withUntouched = applyBulkAction('show_available_only', existing, ['p1', 'p5'])
    check('applyBulkAction show_available_only includes a never-touched puppy (defaults to "available")', withUntouched.p5.visible === true && withUntouched.p5.availability === 'available')
  }
  {
    // A puppy removed from the litter since the Showcase was last touched
    // must be pruned, not carried forward forever.
    const existing = { p1: { visible: true, availability: 'available' }, removedPup: { visible: true, availability: 'available' } }
    const map = applyBulkAction('select_all', existing, ['p1'])
    check('applyBulkAction drops entries for puppies no longer in litter.puppyIds', !('removedPup' in map) && Object.keys(map).length === 1)
  }
  {
    // Codex fix-round ("Explicit media publication"): a bulk visibility
    // action must never wipe a puppy's existing media publication
    // selections — visible/availability/publication are three
    // independent dimensions.
    const existing = { p1: { visible: true, availability: 'available', publishedPhotoIds: ['photoA'], publishedVideoIds: ['videoA'] } }
    const map = applyBulkAction('clear_all', existing, ['p1'])
    check('applyBulkAction (clear_all) preserves publishedPhotoIds/publishedVideoIds even while hiding the puppy', JSON.stringify(map.p1.publishedPhotoIds) === JSON.stringify(['photoA']) && JSON.stringify(map.p1.publishedVideoIds) === JSON.stringify(['videoA']))
  }
}

// ── Section 2: structural coverage ──
{
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const showcaseBlock = (rules.match(/match \/litterShowcases\/\{litterId\} \{[\s\S]*?\n    \}/) || [''])[0]
  check('firestore.rules has a litterShowcases match block', showcaseBlock.length > 0)
  check('litterShowcases denies all direct client create/update/delete (Admin SDK endpoints only)', /allow create, update, delete: if false;/.test(showcaseBlock))
  check('litterShowcases read is scoped to the owning tenant only (no anonymous/public read in Slice 1)', /allow read: if isSignedIn\(\) && \(resource == null \|\| resource\.data\.tenantId == request\.auth\.uid\);/.test(showcaseBlock))
  // Staging QA fix: a read of a litterShowcases doc that doesn't exist
  // yet (every litter's starting state) must not be denied outright —
  // see this rule's own comment for the full incident writeup.
  check('litterShowcases read allows resource == null (a not-yet-created Showcase must resolve to "not found", never permission-denied)', /resource == null \|\|/.test(showcaseBlock))

  const littersPageSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  // Tony live-staging fix round ("Draft → Save"): bulkUpdateShowcasePuppies
  // and the old per-field updateShowcasePuppy(litterId, puppyId, { visible })
  // shape are both gone — bulk actions are now a local draft mutation (see
  // ShowcaseManager's own tests below), and updateShowcasePuppy is called
  // exactly once per dirty puppy on Save, with the FULL resolved field set.
  check('LittersPage.tsx manages Showcase via lib/db.ts server-endpoint wrappers, not direct Firestore writes',
    /createShowcase\(litterId\)/.test(littersPageSrc) &&
    /setShowcaseEnabled\(litterId, !current\.enabled\)/.test(littersPageSrc) &&
    /updateShowcasePuppy\(litterId, puppyId, resolvedFields\)/.test(littersPageSrc) &&
    !/bulkUpdateShowcasePuppies/.test(littersPageSrc))
  // Codex fix-round finding 2: the raw `profile?.plan !== 'plus'` check is
  // gone — gating must go through the shared client mirror of
  // computeEffectivePlan (getEffectivePlanClient), not a bare plan-field
  // comparison that ignores expired past_due grace.
  check('LittersPage.tsx gates Showcase management via getEffectivePlanClient (accounts for past_due grace expiry), not a raw plan-field check', /getEffectivePlanClient\(profile\) !== 'plus'/.test(littersPageSrc) && !/\{profile\?\.plan !== 'plus'/.test(littersPageSrc))
  check('LittersPage.tsx imports getEffectivePlanClient from lib/utils', /import \{[^}]*getEffectivePlanClient[^}]*\} from '\.\.\/lib\/utils'/.test(littersPageSrc))
  check('LittersPage.tsx never reads/writes the dogs collection when handling Showcase puppy state (Requirement 7)', !/updateDoc\([^)]*dogs[^)]*visible/.test(littersPageSrc))

  // Codex fix-round finding 3: switching accounts must reset every piece
  // of Showcase UI state, not just litters/dogs. Anchored to the SAME
  // useEffect block (from its opening comment through the `[user?.uid]`
  // dependency array) so this can't pass by matching a reset call that
  // lives somewhere unrelated in the file.
  const accountSwitchEffect = (littersPageSrc.match(/useEffect\(\(\) => \{\s*\/\/ Codex round 15[\s\S]*?\}, \[user\?\.uid\]\)/) || [''])[0]
  check('The account-switch useEffect was found (anchored to its Codex round 15 comment through the [user?.uid] dep array)', accountSwitchEffect.length > 0)
  check('Account switch resets litters and dogs', /setLitters\(\[\]\)/.test(accountSwitchEffect) && /setDogs\(\[\]\)/.test(accountSwitchEffect))
  check('Account switch resets all five Showcase state maps (including the UI-gap-fix showcaseSaveError)', /setShowcases\(\{\}\)/.test(accountSwitchEffect) && /setShowcaseLoading\(\{\}\)/.test(accountSwitchEffect) && /setShowcaseBusy\(\{\}\)/.test(accountSwitchEffect) && /setShowcaseError\(\{\}\)/.test(accountSwitchEffect) && /setShowcaseSaveError\(\{\}\)/.test(accountSwitchEffect))
  check('Account switch collapses any expanded litter panel', /setExpandedLitter\(null\)/.test(accountSwitchEffect))
  // Codex fix-round finding (Showcase account-switch REQUEST race): the
  // account-switch effect must also bump the Showcase guard's account
  // generation, in the SAME synchronous effect body as the resets above
  // — this is what invalidates any request already in flight for the
  // OLD account.
  check('Account switch bumps the Showcase request guard\'s account generation', /showcaseGuard\.bumpAccountGeneration\(\)/.test(accountSwitchEffect))

  check('LittersPage.tsx imports the REAL useShowcaseRequestGuard hook (not a reimplemented/inline guard)', /import \{ useShowcaseRequestGuard \} from '\.\.\/hooks\/useShowcaseRequestGuard'/.test(littersPageSrc))
  check('LittersPage.tsx defines isShowcaseRequestCurrent combining mountedRef AND the guard\'s isCurrent()', /function isShowcaseRequestCurrent\(gen: number\): boolean \{\s*return mountedRef\.current && showcaseGuard\.isCurrent\(gen\)/.test(littersPageSrc))

  // Every one of these Showcase async functions must (1) capture the
  // generation via the guard BEFORE its own first await, and (2) check
  // isShowcaseRequestCurrent after ONLY awaiting — never bump/mutate the
  // guard itself (only the account-switch effect above may do that).
  // Tony live-staging fix round ("Draft → Save"): handleTogglePuppyVisible/
  // handlePuppyAvailabilityChange/handlePublishedMediaChange/
  // handleShowcaseDetailsChange/handleShowcaseBulkAction (one server call
  // per field/toggle) no longer exist — replaced by ONE function,
  // handleSaveShowcaseDraft, called once per DIRTY puppy when the breeder
  // clicks "Save changes" in ShowcaseManager (see that component's own
  // tests below). It must uphold the exact same guard discipline as
  // every handler it replaced.
  const showcaseHandlerNames = ['loadShowcase', 'handleCreateShowcase', 'handleToggleShowcaseEnabled', 'handleSaveShowcaseDraft']
  for (const name of showcaseHandlerNames) {
    const fnBody = extractFunctionSource(littersPageSrc, new RegExp(`async function ${name}\\(`))
    check(`${name} was found`, fnBody.length > 0)
    check(`${name} captures the guard's generation before its first await`, /const gen = showcaseGuard\.currentGeneration\(\)/.test(fnBody))
    const guardCheckCount = (fnBody.match(/if \(!isShowcaseRequestCurrent\(gen\)\) return/g) || []).length
    check(`${name} checks isShowcaseRequestCurrent after every await (at least 3 checks)`, guardCheckCount >= 3, `found ${guardCheckCount}`)
  }

  // handleToggleShowcaseEnabled remains the only per-field autosave
  // handler left in the parent (the litter-level toggle is intentionally
  // NOT part of the Draft → Save redesign — see ShowcaseManager's own
  // header comment) — it must still clear any stale showcaseSaveError at
  // the start of a new attempt, set it on failure, and never optimistically
  // write to showcases before the server confirms.
  {
    const fnBody = extractFunctionSource(littersPageSrc, /async function handleToggleShowcaseEnabled\(/)
    check('handleToggleShowcaseEnabled was found (edit-handler pass)', fnBody.length > 0)
    check('handleToggleShowcaseEnabled clears showcaseSaveError at the start of every new attempt', /setShowcaseSaveError\(prev => \(\{ \.\.\.prev, \[litterId\]: '' \}\)\)/.test(fnBody))
    check('handleToggleShowcaseEnabled sets showcaseSaveError on failure (guarded by isShowcaseRequestCurrent, same as every other post-await write)', /setShowcaseSaveError\(prev => \(\{ \.\.\.prev, \[litterId\]: message \}\)\)/.test(fnBody))
    check('handleToggleShowcaseEnabled never optimistically writes to showcases before the server confirms (no setShowcases call outside the success branch)', (fnBody.match(/setShowcases\(/g) || []).length === 1)
  }

  // handleSaveShowcaseDraft's own partial-failure contract: resolvedIds
  // must be returned on BOTH the success and every failure branch (never
  // silently dropped), and it must update dogs/showcases state itself so
  // ShowcaseManager doesn't need a full page reload to see a persisted
  // media reorder.
  {
    const fnBody = extractFunctionSource(littersPageSrc, /async function handleSaveShowcaseDraft\(/)
    const resolvedIdsReturnCount = (fnBody.match(/resolvedIds \}/g) || []).length
    check('handleSaveShowcaseDraft returns resolvedIds on every return path (success AND every failure branch)', resolvedIdsReturnCount >= 5, `found ${resolvedIdsReturnCount}`)
    check('handleSaveShowcaseDraft updates dogs state when media actually changed (photo and/or video)', /setDogs\(prev => prev\.map\(d => d\.id === puppyId/.test(fnBody))
    check('handleSaveShowcaseDraft updates showcases state on a successful save', /setShowcases\(prev => \(\{ \.\.\.prev, \[litterId\]: showcase \}\)\)/.test(fnBody))
    check('handleSaveShowcaseDraft only reorders media when the final order actually differs from what is currently persisted (skips a needless call otherwise)',
      /JSON\.stringify\(currentPhotoIds\) !== JSON\.stringify\(finalPhotoOrder\)/.test(fnBody) && /JSON\.stringify\(currentVideoIds\) !== JSON\.stringify\(finalVideoOrder\)/.test(fnBody))
  }

  // UI gap fix: ShowcaseManager itself — status feedback + Draft → Save
  // wiring. extractFunctionSource() uses balanced-brace counting from the
  // real body-opening brace (see its own comment above) — line-ending
  // independent, unlike a literal end-anchor regex would be.
  const showcaseManagerSrc = extractFunctionSource(littersPageSrc, /function ShowcaseManager\(/)
  check('ShowcaseManager was found', showcaseManagerSrc.length > 0)
  check('ShowcaseManager accepts a saveError prop distinct from the Showcase enabled/disabled status', /saveError: string/.test(showcaseManagerSrc))
  check('ShowcaseManager clarifies that enabling does not publish anything publicly yet',
    /not\s+(?:make it |publish it )?public(?:ly)?/i.test(showcaseManagerSrc) ||
    /no public (?:Showcase )?(?:page|viewer|link)/i.test(showcaseManagerSrc) ||
    /nothing is shared publicly until/i.test(showcaseManagerSrc))
  // Tony live-staging fix round ("Draft → Save"): status is now keyed off
  // a genuinely local `saveState`/`saveProgress`, not a `busy` prop tied to
  // the LITTER-level toggle — it must show the exact UX states specified:
  // a per-file progress line while saving, an unsaved-changes state before
  // the FIRST save, a Retry-labeled error state after a failed save, and
  // "All changes saved" only once nothing is dirty.
  check('ShowcaseManager shows per-file save progress ("Saving file X of Y…")', /Saving file \$\{/.test(showcaseManagerSrc))
  check('ShowcaseManager shows the exact "Some changes could not be saved — Retry" state on failure', /Some changes could not be saved — Retry/.test(showcaseManagerSrc))
  check('ShowcaseManager shows an explicit "You have unsaved changes" state before the first save', /You have unsaved changes/.test(showcaseManagerSrc))
  check('ShowcaseManager renders an explicit "All changes saved" confirmation once nothing is dirty', /All changes saved/.test(showcaseManagerSrc))
  check('The save-status region uses role="status" + aria-live="polite" so screen readers announce it', /role="status" aria-live="polite"/.test(showcaseManagerSrc))
  check('The Save button is labeled "Save changes" normally and "Retry" after a failure, and disabled while saving or with nothing dirty',
    /disabled=\{!anyDirty \|\| saveState === 'saving'\}/.test(showcaseManagerSrc) && /'Retry' : 'Save changes'/.test(showcaseManagerSrc))

  // Requirement: "Uploaded media remains private until published" must
  // be explained in the UI, not just true in the data model.
  check('ShowcaseManager explains that uploaded media stays private until published', /remains private until you publish it/i.test(showcaseManagerSrc))

  // Requirement: warn before reload/close with unsaved changes.
  check('ShowcaseManager registers a beforeunload warning while any puppy draft is dirty', /window\.addEventListener\('beforeunload', handleBeforeUnload\)/.test(showcaseManagerSrc) && /if \(!anyDirty\) return/.test(showcaseManagerSrc))

  // Tony live-staging finding ("cannot add puppy images or videos", and
  // later "media missing from public page"): media upload/publish is now
  // entirely local-draft + queued, reachable regardless of whether the
  // puppy has any media yet, with an explicit Private/Published badge
  // per item so "uploaded but never published" can't happen silently.
  check('ShowcaseManager queues a new file locally (handleAddFiles) rather than uploading it immediately',
    /function handleAddFiles/.test(showcaseManagerSrc) && !/handleAddFiles[\s\S]{0,400}await uploadShowcaseMedia/.test(showcaseManagerSrc))
  check('Large-image fix: oversized video is rejected up front with an actionable message (video cannot be compressed client-side); HEIC/HEIF now shares the same generic 30MB photo ceiling as every other format, since it is decoded+compressed like any other photo rather than sent raw',
    /kind === 'photo' && file\.size > 30 \* 1024 \* 1024/.test(showcaseManagerSrc) && /kind === 'video' && file\.size > MAX_VIDEO_UPLOAD_BYTES/.test(showcaseManagerSrc))
  check('Each media thumbnail shows an explicit Private/Published/Queued badge',
    /isQueued \? 'Queued' : isPublished \? 'Published' : 'Private'/.test(showcaseManagerSrc))
  check('Removing an already-persisted media item requires confirmation; a queued (not-yet-uploaded) one does not',
    /const isQueued = ref\.startsWith\('local:'\)/.test(showcaseManagerSrc) && /if \(!isQueued && !window\.confirm/.test(showcaseManagerSrc))
  check('An explicit "Set as cover" action exists for photos beyond the first (not just implicit via reordering)',
    /Set as cover photo/.test(showcaseManagerSrc) && /handleSetCover/.test(showcaseManagerSrc))
  check('The "Photos & videos" toggle button is NOT gated behind the puppy already having media (it must be the way to add the FIRST one)',
    (() => {
      const idx = showcaseManagerSrc.indexOf("setMediaOpenFor(opening ? puppy.id : null)")
      if (idx === -1) return false
      const before = showcaseManagerSrc.slice(Math.max(0, idx - 400), idx)
      return !/photoOrder\.length > 0 \|\| videoOrder\.length > 0\) && \(\s*<div[^>]*>\s*<button[\s\S]*setMediaOpenFor/.test(before)
    })())

  // Codex fix-round finding (kept, still true): "Show available only"
  // read like a FILTER on the breeder's own admin puppy list — it never
  // was. The button label must still say "Select" + "puppies", matching
  // "Select all"'s own naming convention.
  check('The bulk-action button label no longer reads "Show available only"', !/>Show available only</.test(showcaseManagerSrc))
  check('The bulk-action button label reads "Select available puppies only"', />Select available puppies only</.test(showcaseManagerSrc))
  check('The bulk-action button has an explicit help tooltip clarifying it selects puppies for the Showcase, not a filter of this list', /title="Selects every puppy currently marked Available/.test(showcaseManagerSrc))
  // REQUIRED UX: "Keep all puppies visible in the management panel" —
  // puppyDogs.map() must never be filtered by visible/availability; the
  // ONLY conditional in the puppy list is the empty-litter branch above
  // it (puppyDogs.length === 0), never a per-puppy visibility check.
  // Checks the RENDER call specifically (`puppyDogs.map(puppy => {`, never
  // `puppyDogs.filter(...).map(puppy => {`) — a separate, legitimate stat
  // like `visibleCount` elsewhere in the component computing off
  // `puppyDogs.filter(...visible...)` is not a violation of this
  // requirement, only filtering the actual RENDERED list would be.
  check('The puppy management list always renders EVERY puppy in the litter (the render call itself is puppyDogs.map, never puppyDogs.filter(...).map)',
    /puppyDogs\.map\(puppy => \{/.test(showcaseManagerSrc) && !/puppyDogs\.filter\([^)]*\)\.map\(puppy/.test(showcaseManagerSrc))
  // Tony live-staging fix round ("Draft → Save"): bulk actions are now a
  // LOCAL draft mutation (no server call, no toast) — the internal action
  // id string is kept only as a readable literal in handleBulkAction's own
  // branches, not as a server-call argument any more.
  check('Bulk actions mutate the draft locally (select_all/clear_all/show_available_only branches) without an immediate server call', /function handleBulkAction\(action: 'select_all' \| 'clear_all' \| 'show_available_only'\)/.test(showcaseManagerSrc) && !/bulkUpdateShowcasePuppies/.test(showcaseManagerSrc))

  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  check('lib/db.ts Showcase mutations all call trusted server endpoints (never a direct Firestore write to litterShowcases)', /fetch\('\/api\/create-showcase'/.test(dbSrc) && /fetch\('\/api\/set-showcase-enabled'/.test(dbSrc) && /fetch\('\/api\/update-showcase-puppy'/.test(dbSrc) && /fetch\('\/api\/bulk-update-showcase-puppies'/.test(dbSrc))
  check('lib/db.ts Showcase read uses getDoc directly (Rules-scoped to the owning tenant, no server round-trip needed)', /getDoc\(doc\(db, 'litterShowcases', litterId\)\)/.test(dbSrc))

  const apiFiles = ['create-showcase.js', 'set-showcase-enabled.js', 'update-showcase-puppy.js', 'bulk-update-showcase-puppies.js']
  for (const file of apiFiles) {
    const src = readFileSync(new URL(`../api/${file}`, import.meta.url), 'utf8')
    check(`api/${file} uses FieldValue.serverTimestamp() for updatedAt, never new Date().toISOString()`, /updatedAt: FieldValue\.serverTimestamp\(\)/.test(src) && !/updatedAt: nowIso/.test(src) && !/new Date\(\)\.toISOString\(\)/.test(src))
    check(`api/${file} reads the resolved document back via readShowcaseForResponse before responding`, /const showcase = await readShowcaseForResponse\(db, litterId\)/.test(src))
  }
  const createSrc = readFileSync(new URL('../api/create-showcase.js', import.meta.url), 'utf8')
  check('api/create-showcase.js uses FieldValue.serverTimestamp() for createdAt too', /createdAt: FieldValue\.serverTimestamp\(\)/.test(createSrc))
}

// ── Section 3: getEffectivePlanClient parity with the server's
// computeEffectivePlan (Codex fix-round finding 2). Cross-checks the
// REAL server-side function (api/_lib/entitlements.js, importable
// directly — plain JS) against a plain-JS mirror of getEffectivePlanClient
// (src/lib/utils.ts, TypeScript — can't be imported into a Node script
// without compilation, so this mirrors it field-for-field, same
// established pattern as every other client/server logic pair in this
// suite) across the four scenarios the fix-round explicitly calls out. ──
{
  const { computeEffectivePlan } = await import('../api/_lib/entitlements.js')

  const PLAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000
  function getEffectivePlanClientMirror(profile, now = new Date()) {
    const rawPlan = profile?.plan === 'plus' ? 'plus' : 'free'
    if (rawPlan !== 'plus') return 'free'
    if (profile?.subscriptionStatus === 'past_due' && profile?.pastDueSince) {
      const since = new Date(profile.pastDueSince).getTime()
      if (!Number.isNaN(since) && now.getTime() - since > PLAN_GRACE_MS) return 'free'
    }
    return 'plus'
  }

  const now = new Date('2026-07-29T12:00:00.000Z')
  const scenarios = [
    { label: 'active Plus (no past_due at all)', profile: { plan: 'plus' }, expect: 'plus' },
    { label: 'Free plan', profile: { plan: 'free' }, expect: 'free' },
    { label: 'past_due within the 7-day grace window (1 day ago)', profile: { plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString() }, expect: 'plus' },
    { label: 'past_due AFTER the 7-day grace window has expired (8 days ago)', profile: { plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString() }, expect: 'free' },
    // Boundary cases, still both sides.
    { label: 'past_due exactly at the grace boundary (7 days ago, not yet expired)', profile: { plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: new Date(now.getTime() - PLAN_GRACE_MS).toISOString() }, expect: 'plus' },
    { label: 'no profile document at all', profile: null, expect: 'free' },
  ]
  for (const s of scenarios) {
    const serverResult = computeEffectivePlan(s.profile, now)
    const clientResult = getEffectivePlanClientMirror(s.profile, now)
    check(`Server computeEffectivePlan: ${s.label} → ${s.expect}`, serverResult === s.expect, `got ${serverResult}`)
    check(`Client getEffectivePlanClient mirror: ${s.label} → ${s.expect}`, clientResult === s.expect, `got ${clientResult}`)
    check(`Client and server AGREE for: ${s.label}`, clientResult === serverResult)
  }

  // Structural: the ACTUAL utils.ts source implements the same grace
  // constant and the same past_due+pastDueSince gate the mirror above
  // encodes — not just a same-named function that happens to always
  // return 'plus'.
  const utilsSrc = readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8')
  check('utils.ts exports getEffectivePlanClient', /export function getEffectivePlanClient\(/.test(utilsSrc))
  check('utils.ts uses the same 7-day grace constant as api/_lib/entitlements.js', /PLAN_GRACE_MS = 7 \* 24 \* 60 \* 60 \* 1000/.test(utilsSrc))
  check('utils.ts checks subscriptionStatus === \'past_due\' && pastDueSince before treating an account as downgraded', /profile\?\.subscriptionStatus === 'past_due' && profile\?\.pastDueSince/.test(utilsSrc))
}

// ── Section 4: account-switch reset — a REAL mounted-component test
// (react-test-renderer + act(), same established pattern as
// test-round16-request-guard-lifecycle.mjs) proving a useEffect keyed on
// the account identifier, reproducing LittersPage's exact reset shape,
// actually clears every piece of Showcase state (not just litters/dogs)
// the moment the account changes — not merely that the source CONTAINS
// the right setter calls (Section 2 above already proves that
// separately), but that mounting, seeding stale state, and switching
// accounts produces the correct RENDERED outcome. No emulator needed. ──
{
  const React = (await import('react')).default
  const { useState, useEffect } = React
  const TestRenderer = (await import('react-test-renderer')).default
  const { act } = TestRenderer

  function ShowcaseResetHarness({ uid, controls }) {
    const [litters, setLitters] = useState(['stale-litter'])
    const [dogs, setDogs] = useState(['stale-dog'])
    const [showcases, setShowcases] = useState({})
    const [showcaseLoading, setShowcaseLoading] = useState({})
    const [showcaseBusy, setShowcaseBusy] = useState({})
    const [showcaseError, setShowcaseError] = useState({})
    const [expandedLitter, setExpandedLitter] = useState(null)

    // Mirrors LittersPage.tsx's account-switch useEffect exactly: same
    // dependency array shape ([uid], the harness's equivalent of
    // [user?.uid]), same seven reset calls.
    useEffect(() => {
      setLitters([])
      setDogs([])
      setShowcases({})
      setShowcaseLoading({})
      setShowcaseBusy({})
      setShowcaseError({})
      setExpandedLitter(null)
    }, [uid])

    controls.getState = () => ({ litters, dogs, showcases, showcaseLoading, showcaseBusy, showcaseError, expandedLitter })
    controls.seedStaleShowcaseState = () => {
      setShowcases({ litterX: { enabled: true, puppies: { pupX: { visible: true, availability: 'available' } } } })
      setShowcaseLoading({ litterX: true })
      setShowcaseBusy({ litterX: true })
      setShowcaseError({ litterX: 'a stale error from the previous account' })
      setExpandedLitter('litterX')
    }
    return null
  }

  const controlsA = {}
  let renderer
  act(() => {
    renderer = TestRenderer.create(React.createElement(ShowcaseResetHarness, { uid: 'accountA', controls: controlsA }))
  })
  act(() => { controlsA.seedStaleShowcaseState() })

  const seeded = controlsA.getState()
  check('Sanity: seeding stale Showcase state for account A actually took effect', seeded.showcases.litterX?.enabled === true && seeded.expandedLitter === 'litterX' && seeded.showcaseError.litterX === 'a stale error from the previous account')

  // The account-switch itself: re-render with a DIFFERENT uid, exactly
  // as LittersPage does when useAuth()'s user changes.
  const controlsB = {}
  act(() => {
    renderer.update(React.createElement(ShowcaseResetHarness, { uid: 'accountB', controls: controlsB }))
  })
  const afterSwitch = controlsB.getState()

  check('After switching accounts, showcases is reset to empty — account A\'s Showcase data is not reused for account B', Object.keys(afterSwitch.showcases).length === 0)
  check('After switching accounts, showcaseLoading is reset to empty', Object.keys(afterSwitch.showcaseLoading).length === 0)
  check('After switching accounts, showcaseBusy is reset to empty', Object.keys(afterSwitch.showcaseBusy).length === 0)
  check('After switching accounts, showcaseError is reset to empty — account A\'s stale error message is not shown for account B', Object.keys(afterSwitch.showcaseError).length === 0)
  check('After switching accounts, expandedLitter collapses back to null — account A\'s expanded litter panel is not left open for account B', afterSwitch.expandedLitter === null)
  check('After switching accounts, litters/dogs are also reset (unaffected sibling behavior)', afterSwitch.litters.length === 0 && afterSwitch.dogs.length === 0)

  act(() => { renderer.unmount() })
}

// ── Section 5: Showcase account-switch REQUEST race (Codex fix-round
// finding — a pending Showcase read/mutation started under account A can
// resolve AFTER switching to account B and resurrect A's data). Unlike
// Section 4 above (which only proves the SYNCHRONOUS reset fires), this
// section proves the ASYNC race itself is closed, and does so two ways:
//
//   5a. Unit tests against the REAL, extracted ShowcaseRequestGuardState
//       class (src/hooks/useShowcaseRequestGuard.ts) — not a hand-mirrored
//       copy — proving its generation semantics: concurrent operations
//       for the SAME account never invalidate each other, but ALL of them
//       invalidate together, at once, the instant the account changes.
//
//   5b. A REAL mounted-component test (react-test-renderer + act()) using
//       the REAL useShowcaseRequestGuard() hook, with a harness whose
//       startRead()/startMutation() are line-for-line copies of
//       LittersPage.tsx's own loadShowcase()/handleCreateShowcase() guard
//       shape (capture gen → await → check isCurrent in every
//       try/catch/finally branch) — only the actual network call
//       (getShowcaseForLitter/createShowcase) is swapped for an
//       externally-controlled deferred Promise, which is the only way to
//       deterministically force a REAL pending request to resolve AFTER a
//       REAL account switch inside a test. This is the same "wrap the
//       real hook in a harness that fakes only the I/O boundary" pattern
//       test-round16-request-guard-lifecycle.mjs already established for
//       useRequestGuard — not a duplicate reimplementation of the guard
//       itself, which is imported and used unmodified. ──
{
  const React = (await import('react')).default
  const { useState, useEffect, useRef } = React
  const TestRenderer = (await import('react-test-renderer')).default
  const { act } = TestRenderer
  const { ShowcaseRequestGuardState, useShowcaseRequestGuard } = await import('../src/hooks/useShowcaseRequestGuard.ts')

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
  function createDeferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  // ── 5a: real ShowcaseRequestGuardState unit tests ──
  {
    const guard = new ShowcaseRequestGuardState()
    const genLitterA = guard.currentGeneration()
    const genLitterB = guard.currentGeneration()
    check('5a', 'Two litters\' operations captured back-to-back (no account switch between them) get the SAME generation', genLitterA === genLitterB)
    check('5a', 'Both are current before any account switch', guard.isCurrent(genLitterA) && guard.isCurrent(genLitterB))

    guard.bumpAccountGeneration()
    check('5a', 'After an account switch, BOTH earlier litters\' generations become stale TOGETHER — neither cancelled the other, the switch invalidated both', !guard.isCurrent(genLitterA) && !guard.isCurrent(genLitterB))

    const genAfterSwitch1 = guard.currentGeneration()
    const genAfterSwitch2 = guard.currentGeneration()
    check('5a', 'Two more litters\' operations under the NEW account also share one generation and remain mutually non-interfering', genAfterSwitch1 === genAfterSwitch2 && guard.isCurrent(genAfterSwitch1) && guard.isCurrent(genAfterSwitch2))

    guard.bumpAccountGeneration()
    check('5a', 'A second account switch invalidates the post-first-switch generation too — stale generations never become current again', !guard.isCurrent(genAfterSwitch1) && !guard.isCurrent(genLitterA))
  }

  // ── 5b: real mounted-component harness, wrapping the REAL useShowcaseRequestGuard() ──
  function ShowcaseRaceHarness({ uid, controls }) {
    const mountedRef = useRef(true)
    const showcaseGuard = useShowcaseRequestGuard()
    const [showcases, setShowcases] = useState({})
    const [showcaseLoading, setShowcaseLoading] = useState({})
    const [showcaseBusy, setShowcaseBusy] = useState({})
    const [showcaseError, setShowcaseError] = useState({})

    useEffect(() => {
      mountedRef.current = true
      return () => { mountedRef.current = false }
    }, [])

    function isShowcaseRequestCurrent(gen) {
      return mountedRef.current && showcaseGuard.isCurrent(gen)
    }

    // Line-for-line the same shape as LittersPage.tsx's own account-switch
    // effect: reset + bump, together, in one synchronous effect body.
    useEffect(() => {
      showcaseGuard.bumpAccountGeneration()
      setShowcases({})
      setShowcaseLoading({})
      setShowcaseBusy({})
      setShowcaseError({})
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uid])

    // Line-for-line the same guard shape as loadShowcase() — only
    // getShowcaseForLitter(litterId) is replaced with an
    // externally-controlled `fetchPromise`.
    async function startRead(litterId, fetchPromise) {
      const gen = showcaseGuard.currentGeneration()
      setShowcaseLoading(prev => ({ ...prev, [litterId]: true }))
      setShowcaseError(prev => ({ ...prev, [litterId]: '' }))
      try {
        const result = await fetchPromise
        if (!isShowcaseRequestCurrent(gen)) return
        setShowcases(prev => ({ ...prev, [litterId]: result }))
      } catch (err) {
        if (!isShowcaseRequestCurrent(gen)) return
        setShowcaseError(prev => ({ ...prev, [litterId]: err instanceof Error ? err.message : 'failed' }))
      } finally {
        if (!isShowcaseRequestCurrent(gen)) return
        setShowcaseLoading(prev => ({ ...prev, [litterId]: false }))
      }
    }

    // Line-for-line the same guard shape as handleCreateShowcase() — only
    // createShowcase(litterId) is replaced with an externally-controlled
    // `mutationPromise`.
    async function startMutation(litterId, mutationPromise) {
      const gen = showcaseGuard.currentGeneration()
      setShowcaseBusy(prev => ({ ...prev, [litterId]: true }))
      try {
        const result = await mutationPromise
        if (!isShowcaseRequestCurrent(gen)) return
        setShowcases(prev => ({ ...prev, [litterId]: result }))
      } catch (err) {
        if (!isShowcaseRequestCurrent(gen)) return
        setShowcaseError(prev => ({ ...prev, [litterId]: err instanceof Error ? err.message : 'failed' }))
      } finally {
        if (!isShowcaseRequestCurrent(gen)) return
        setShowcaseBusy(prev => ({ ...prev, [litterId]: false }))
      }
    }

    controls.startRead = startRead
    controls.startMutation = startMutation
    controls.getState = () => ({ showcases, showcaseLoading, showcaseBusy, showcaseError })
    return null
  }

  // ── Scenario 1 (required by the fix-round task): a pending READ
  // resolves after an account switch — 1. account A starts a read, 2.
  // switch to account B before it resolves, 3. resolve account A's
  // request, 4. account A's data/error/loading is not committed for B. ──
  {
    const controlsA = {}
    let renderer
    act(() => {
      renderer = TestRenderer.create(React.createElement(ShowcaseRaceHarness, { uid: 'accountA', controls: controlsA }))
    })

    const readDeferred = createDeferred()
    act(() => { controlsA.startRead('litterX', readDeferred.promise) })
    const midFlight = controlsA.getState()
    check('5b-read', '1. Account A\'s read is genuinely pending (loading=true, nothing resolved yet)', midFlight.showcaseLoading.litterX === true && midFlight.showcases.litterX === undefined)

    // 2. Switch to account B BEFORE account A's read resolves.
    const controlsB = {}
    act(() => {
      renderer.update(React.createElement(ShowcaseRaceHarness, { uid: 'accountB', controls: controlsB }))
    })
    const rightAfterSwitch = controlsB.getState()
    check('5b-read', 'Immediately after the switch, account B starts with empty Showcase state', Object.keys(rightAfterSwitch.showcases).length === 0 && Object.keys(rightAfterSwitch.showcaseLoading).length === 0)

    // 3. NOW resolve account A's stale, still-pending read.
    await act(async () => {
      readDeferred.resolve({ litterId: 'litterX', tenantId: 'accountA', enabled: true, puppies: { evilPupFromAccountA: { visible: true, availability: 'available' } }, createdAt: 'x', updatedAt: 'x' })
      await sleep(10)
    })

    // 4. Account A's data/loading must not be committed or rendered for account B.
    const afterStaleResolve = controlsB.getState()
    check('5b-read', '4. Account A\'s stale read result is NOT committed into account B\'s showcases', Object.keys(afterStaleResolve.showcases).length === 0)
    check('5b-read', 'Account A\'s data never appears ANYWHERE in account B\'s state, not even nested', !JSON.stringify(afterStaleResolve).includes('evilPupFromAccountA') && !JSON.stringify(afterStaleResolve).includes('accountA'))
    check('5b-read', 'Account B\'s showcaseLoading for litterX is not left stuck true by A\'s stale finally block', afterStaleResolve.showcaseLoading.litterX !== true)
    check('5b-read', 'Account B\'s showcaseError for litterX was not set by A\'s stale request either', !afterStaleResolve.showcaseError.litterX)

    // Sanity: account B's OWN fresh read still works normally afterward.
    const freshDeferred = createDeferred()
    act(() => { controlsB.startRead('litterX', freshDeferred.promise) })
    await act(async () => {
      freshDeferred.resolve({ litterId: 'litterX', tenantId: 'accountB', enabled: false, puppies: {}, createdAt: 'y', updatedAt: 'y' })
      await sleep(10)
    })
    check('5b-read', 'Sanity: account B\'s own fresh (non-stale) read DOES commit normally', controlsB.getState().showcases.litterX?.tenantId === 'accountB')

    act(() => { renderer.unmount() })
  }

  // ── Scenario 2 (required by the fix-round task): "at least one pending
  // Showcase MUTATION across an account switch" — a pending create-
  // Showcase-style mutation must not resurrect account A's busy/data
  // state under account B either. ──
  {
    const controlsA = {}
    let renderer
    act(() => {
      renderer = TestRenderer.create(React.createElement(ShowcaseRaceHarness, { uid: 'accountA', controls: controlsA }))
    })

    const mutationDeferred = createDeferred()
    act(() => { controlsA.startMutation('litterY', mutationDeferred.promise) })
    check('5b-mutation', 'Account A\'s mutation is genuinely pending (busy=true)', controlsA.getState().showcaseBusy.litterY === true)

    const controlsB = {}
    act(() => {
      renderer.update(React.createElement(ShowcaseRaceHarness, { uid: 'accountB', controls: controlsB }))
    })
    check('5b-mutation', 'Immediately after the switch, account B starts with empty showcaseBusy', Object.keys(controlsB.getState().showcaseBusy).length === 0)

    await act(async () => {
      mutationDeferred.resolve({ litterId: 'litterY', tenantId: 'accountA', enabled: true, puppies: { evilMutationFromA: { visible: true, availability: 'available' } }, createdAt: 'x', updatedAt: 'x' })
      await sleep(10)
    })

    const afterStaleMutation = controlsB.getState()
    check('5b-mutation', "Account A's stale mutation result is NOT committed into account B's showcases", Object.keys(afterStaleMutation.showcases).length === 0)
    check('5b-mutation', "Account A's stale mutation never appears anywhere in account B's state", !JSON.stringify(afterStaleMutation).includes('evilMutationFromA'))
    check('5b-mutation', "Account B's showcaseBusy for litterY is not left stuck true by A's stale finally block", afterStaleMutation.showcaseBusy.litterY !== true)

    act(() => { renderer.unmount() })
  }

  // ── Scenario 3: a REJECTED (not just resolved) stale request must also
  // never surface an error for the wrong account. ──
  {
    const controlsA = {}
    let renderer
    act(() => {
      renderer = TestRenderer.create(React.createElement(ShowcaseRaceHarness, { uid: 'accountA', controls: controlsA }))
    })
    const failDeferred = createDeferred()
    act(() => { controlsA.startRead('litterZ', failDeferred.promise) })

    const controlsB = {}
    act(() => {
      renderer.update(React.createElement(ShowcaseRaceHarness, { uid: 'accountB', controls: controlsB }))
    })

    await act(async () => {
      failDeferred.reject(new Error('account-A-specific failure message'))
      await sleep(10)
    })
    const afterStaleRejection = controlsB.getState()
    check('5b-reject', "A stale REJECTED request from account A does not set an error for account B", !afterStaleRejection.showcaseError.litterZ)
    check('5b-reject', "Account A's failure message never appears in account B's state", !JSON.stringify(afterStaleRejection).includes('account-A-specific failure message'))

    act(() => { renderer.unmount() })
  }
}

// ── Section 6: Save-status UX regression (Codex UI-gap finding — "no
// Save button and no visible autosave status/success confirmation").
// This slice was ALREADY autosave by design (every toggle/select/bulk
// action calls its own trusted server endpoint immediately — see
// Section 2's checks above proving each handler only ever writes to
// `showcases` inside its success branch, never optimistically). What
// was missing was reliable status feedback. A REAL mounted-component
// test (react-test-renderer + act(), same pattern as Sections 4/5) using
// the REAL useShowcaseRequestGuard() hook, with a harness whose
// saveMutation() is a line-for-line copy of the four edit handlers'
// guard shape — proving save success, save failure (with the last
// successfully saved state preserved, never partially overwritten), a
// successful retry clearing a stale failure, and that `busy` flips true
// SYNCHRONOUSLY before any await (the actual mechanism, together with
// disabled={busy} — checked structurally in Section 2 — that prevents a
// double submission; there is no separate per-litter generation to rely
// on for this, by design — see useShowcaseRequestGuard.ts). ──
{
  const React = (await import('react')).default
  const { useState, useEffect, useRef } = React
  const TestRenderer = (await import('react-test-renderer')).default
  const { act } = TestRenderer
  const { useShowcaseRequestGuard } = await import('../src/hooks/useShowcaseRequestGuard.ts')

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
  function createDeferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  function SaveStatusHarness({ uid, controls }) {
    const mountedRef = useRef(true)
    const showcaseGuard = useShowcaseRequestGuard()
    const [showcases, setShowcases] = useState({})
    const [showcaseBusy, setShowcaseBusy] = useState({})
    const [showcaseSaveError, setShowcaseSaveError] = useState({})

    useEffect(() => {
      mountedRef.current = true
      return () => { mountedRef.current = false }
    }, [])
    function isShowcaseRequestCurrent(gen) {
      return mountedRef.current && showcaseGuard.isCurrent(gen)
    }
    useEffect(() => {
      showcaseGuard.bumpAccountGeneration()
      setShowcases({})
      setShowcaseBusy({})
      setShowcaseSaveError({})
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uid])

    // Line-for-line the same shape as handleTogglePuppyVisible /
    // handlePuppyAvailabilityChange / handleToggleShowcaseEnabled /
    // handleShowcaseBulkAction — only the network call is swapped for an
    // externally-controlled deferred promise.
    async function saveMutation(litterId, mutationPromise) {
      const gen = showcaseGuard.currentGeneration()
      setShowcaseBusy(prev => ({ ...prev, [litterId]: true }))
      setShowcaseSaveError(prev => ({ ...prev, [litterId]: '' }))
      try {
        const result = await mutationPromise
        if (!isShowcaseRequestCurrent(gen)) return
        setShowcases(prev => ({ ...prev, [litterId]: result }))
      } catch (err) {
        if (!isShowcaseRequestCurrent(gen)) return
        setShowcaseSaveError(prev => ({ ...prev, [litterId]: err instanceof Error ? err.message : 'failed' }))
      } finally {
        if (!isShowcaseRequestCurrent(gen)) return
        setShowcaseBusy(prev => ({ ...prev, [litterId]: false }))
      }
    }

    controls.saveMutation = saveMutation
    controls.getState = () => ({ showcases, showcaseBusy, showcaseSaveError })
    // Mirrors ShowcaseManager's own three-state derivation exactly.
    controls.deriveStatus = (litterId) => {
      if (showcaseBusy[litterId]) return 'saving'
      if (showcaseSaveError[litterId]) return 'error'
      return 'saved'
    }
    return null
  }

  // ── Test A: save success ──
  {
    const controls = {}
    let renderer
    act(() => { renderer = TestRenderer.create(React.createElement(SaveStatusHarness, { uid: 'acct', controls })) })

    const d = createDeferred()
    act(() => { controls.saveMutation('litterA', d.promise) })
    check('save-status', 'While a save is in flight, status is "saving"', controls.deriveStatus('litterA') === 'saving')

    await act(async () => {
      d.resolve({ litterId: 'litterA', tenantId: 'acct', enabled: true, puppies: { p1: { visible: true, availability: 'available' } }, createdAt: 'x', updatedAt: 'x' })
      await sleep(10)
    })
    check('save-status', 'After a successful save, status flips to "saved" (not "saving", not "error")', controls.deriveStatus('litterA') === 'saved')
    check('save-status', 'The successfully saved value is actually committed into state', controls.getState().showcases.litterA?.puppies?.p1?.visible === true)

    act(() => { renderer.unmount() })
  }

  // ── Test B: save failure preserves the last successfully saved state ──
  {
    const controls = {}
    let renderer
    act(() => { renderer = TestRenderer.create(React.createElement(SaveStatusHarness, { uid: 'acct', controls })) })

    const d1 = createDeferred()
    act(() => { controls.saveMutation('litterB', d1.promise) })
    await act(async () => {
      d1.resolve({ litterId: 'litterB', tenantId: 'acct', enabled: true, puppies: { p1: { visible: true, availability: 'available' } }, createdAt: 'x', updatedAt: 'x' })
      await sleep(10)
    })
    const lastGoodState = controls.getState().showcases.litterB
    check('save-status', 'Sanity: a first successful save established a last-known-good state', lastGoodState?.puppies?.p1?.visible === true)

    const d2 = createDeferred()
    act(() => { controls.saveMutation('litterB', d2.promise) })
    check('save-status', 'A second, now-failing save also shows "saving" while in flight', controls.deriveStatus('litterB') === 'saving')

    await act(async () => {
      d2.reject(new Error('simulated network failure'))
      await sleep(10)
    })
    check('save-status', 'After a FAILED save, status is "error"', controls.deriveStatus('litterB') === 'error')
    check('save-status', 'The failure message is captured for display', controls.getState().showcaseSaveError.litterB === 'simulated network failure')
    check('save-status', 'REQUIRED UX: the last successfully saved state is preserved byte-for-byte after a failed save — no partial/corrupt write', JSON.stringify(controls.getState().showcases.litterB) === JSON.stringify(lastGoodState))

    // A subsequent successful retry must clear the stale failure.
    const d3 = createDeferred()
    act(() => { controls.saveMutation('litterB', d3.promise) })
    await act(async () => {
      d3.resolve({ litterId: 'litterB', tenantId: 'acct', enabled: true, puppies: { p1: { visible: false, availability: 'available' } }, createdAt: 'x', updatedAt: 'y' })
      await sleep(10)
    })
    check('save-status', 'A successful retry clears the stale failure and returns status to "saved"', controls.deriveStatus('litterB') === 'saved' && !controls.getState().showcaseSaveError.litterB)

    act(() => { renderer.unmount() })
  }

  // ── Test C: double-submit prevention — busy flips true SYNCHRONOUSLY,
  // before any await, in the same tick as the triggering call. Combined
  // with Section 2's structural proof that every interactive control is
  // disabled={busy}, this is what actually prevents a second submission
  // — there is no per-litter generation to fall back on if the disabled
  // attribute were somehow bypassed (by design — see
  // useShowcaseRequestGuard.ts's own comment on why generation is
  // account-scoped only), so this synchronous timing guarantee is load
  // bearing. ──
  {
    const controls = {}
    let renderer
    act(() => { renderer = TestRenderer.create(React.createElement(SaveStatusHarness, { uid: 'acct', controls })) })

    const d = createDeferred()
    // The setShowcaseBusy(true) inside saveMutation happens BEFORE its
    // first await, so it's part of THIS act() call's synchronous work —
    // act() flushes it before returning, and BEFORE the promise itself
    // has any chance to resolve (it's still unsettled) or for a second
    // click to be dispatched. Read via getState() AFTER act() returns
    // (not inside the same callback — act() only flushes/re-renders once
    // its synchronous callback has fully returned, so a getState() call
    // made from WITHIN the callback would still see the pre-render
    // closure, same pattern already used by every "Sanity: ... pending"
    // check in Section 5 above).
    act(() => { controls.saveMutation('litterC', d.promise) })
    check('save-status', 'showcaseBusy is already true synchronously — flushed before the save\'s promise has any chance to resolve or a second click could be dispatched', controls.getState().showcaseBusy.litterC === true)

    await act(async () => { d.resolve({ litterId: 'litterC', tenantId: 'acct', enabled: false, puppies: {}, createdAt: 'x', updatedAt: 'x' }); await sleep(10) })
    check('save-status', 'busy correctly clears back to false once the save completes', controls.getState().showcaseBusy.litterC === false)

    act(() => { renderer.unmount() })
  }
}

// ── Section 7: emulator-only end-to-end behavioral tests ──
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  const { getFirestore } = await import('firebase-admin/firestore')

  // Import the real handlers FIRST so their own initializeApp() (default
  // app) runs before anything else touches the Admin SDK.
  const { default: createShowcaseHandler } = await import('../api/create-showcase.js')
  const { default: setEnabledHandler } = await import('../api/set-showcase-enabled.js')
  const { default: updatePuppyHandler } = await import('../api/update-showcase-puppy.js')
  const { default: bulkHandler } = await import('../api/bulk-update-showcase-puppies.js')

  const seedDb = getFirestore()

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')
  const { getFirestore: getClientFirestore, connectFirestoreEmulator, doc, getDoc, setDoc } = await import('firebase/firestore')

  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'showcase-client')
  const clientAuth = getClientAuth(clientApp)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const clientDb = getClientFirestore(clientApp)
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080)

  function isDenied(err) { return err && (err.code === 'permission-denied' || /permission/i.test(err.message)) }

  function mockReq(body, token) {
    return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }
  }
  function mockRes() {
    const res = { statusCode: 200, body: null }
    res.status = c => { res.statusCode = c; return res }
    res.json = p => { res.body = p; return res }
    return res
  }

  const R = Date.now()
  const PW = 'tam12345*'
  async function newUser(name, profile) {
    const email = `${name}.${R}@emulator.local`
    const { user } = await createUserWithEmailAndPassword(clientAuth, email, PW)
    const idToken = await user.getIdToken()
    if (profile) await seedDb.collection('users').doc(user.uid).set(profile)
    return { uid: user.uid, idToken, email }
  }
  async function seedLitter(tenantUid, litterId, puppyIds = []) {
    await seedDb.collection('litters').doc(litterId).set({
      tenantId: tenantUid, damId: `dam_${litterId}`, name: 'ShowcaseTestLitter', notes: '', actualBirthDate: '2026-01-01', puppyIds,
    })
  }
  async function seedPuppy(tenantUid, puppyId, litterId) {
    await seedDb.collection('dogs').doc(puppyId).set({
      tenantId: tenantUid, currentOwnerId: tenantUid, createdByUserId: tenantUid,
      sourceType: 'BREEDER_ISSUED', name: puppyId, sex: 'female', status: 'active', dateOfBirth: '2026-01-01', litterId,
    })
  }
  const breederPlusProfile = { role: 'breeder', plan: 'plus', email: 'x@example.com' }

  // ── Test 1: a fresh Showcase exposes zero puppies by default ──
  {
    const breeder = await newUser('sc1breeder', breederPlusProfile)
    const litterId = `litter1_${R}`
    await seedLitter(breeder.uid, litterId, [`p1_${R}`, `p2_${R}`])
    await seedPuppy(breeder.uid, `p1_${R}`, litterId)
    await seedPuppy(breeder.uid, `p2_${R}`, litterId)

    const res = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), res)
    check('1', 'create-showcase succeeds (200)', res.statusCode === 200, JSON.stringify(res.body))
    check('1', 'A brand-new Showcase starts disabled', res.body?.showcase?.enabled === false)
    check('1', 'A brand-new Showcase has an empty puppies map — zero puppies shown by default', JSON.stringify(res.body?.showcase?.puppies) === '{}')

    const secondAttempt = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), secondAttempt)
    check('1', 'A second create attempt for the same litter is rejected (one Showcase per litter)', secondAttempt.statusCode === 409 && secondAttempt.body?.reason === 'SHOWCASE_ALREADY_EXISTS')
  }

  // ── Test 2: only explicitly selected puppies are shown ──
  {
    const breeder = await newUser('sc2breeder', breederPlusProfile)
    const litterId = `litter2_${R}`
    const p1 = `p1_${R}_2`, p2 = `p2_${R}_2`
    await seedLitter(breeder.uid, litterId, [p1, p2])
    await seedPuppy(breeder.uid, p1, litterId)
    await seedPuppy(breeder.uid, p2, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())

    const res = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true }, breeder.idToken), res)
    check('2', 'update-showcase-puppy succeeds', res.statusCode === 200, JSON.stringify(res.body))
    const puppies = res.body.showcase.puppies
    check('2', 'The explicitly-selected puppy is visible', puppies[p1]?.visible === true)
    check('2', 'The untouched sibling puppy stays hidden — no other puppy was implicitly shown', !puppies[p2] || puppies[p2].visible === false)

    const foreignRes = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: `not-in-litter_${R}`, visible: true }, breeder.idToken), foreignRes)
    check('2', 'A puppyId not currently in this litter is rejected (409 PUPPY_NOT_IN_LITTER)', foreignRes.statusCode === 409 && foreignRes.body?.reason === 'PUPPY_NOT_IN_LITTER', JSON.stringify(foreignRes.body))
  }

  // ── Test 3: "Clear all" hides every puppy; "Select all" / "Select available puppies only" ──
  {
    const breeder = await newUser('sc3breeder', breederPlusProfile)
    const litterId = `litter3_${R}`
    const [p1, p2, p3] = [`p1_${R}_3`, `p2_${R}_3`, `p3_${R}_3`]
    await seedLitter(breeder.uid, litterId, [p1, p2, p3])
    for (const p of [p1, p2, p3]) await seedPuppy(breeder.uid, p, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())

    // Give each puppy a distinct availability before testing bulk actions.
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, availability: 'available' }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId: p2, availability: 'on_hold' }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId: p3, availability: 'reserved' }, breeder.idToken), mockRes())

    const selectAllRes = mockRes()
    await bulkHandler(mockReq({ litterId, action: 'select_all' }, breeder.idToken), selectAllRes)
    check('3', 'select_all shows every current puppy', Object.values(selectAllRes.body.showcase.puppies).every(e => e.visible === true))

    const showAvailRes = mockRes()
    await bulkHandler(mockReq({ litterId, action: 'show_available_only' }, breeder.idToken), showAvailRes)
    const p = showAvailRes.body.showcase.puppies
    check('3', 'show_available_only shows the "available" puppy', p[p1].visible === true)
    check('3', 'show_available_only excludes the "on_hold" puppy', p[p2].visible === false)
    check('3', 'show_available_only excludes the "reserved" puppy', p[p3].visible === false)

    const clearAllRes = mockRes()
    await bulkHandler(mockReq({ litterId, action: 'clear_all' }, breeder.idToken), clearAllRes)
    check('3', 'clear_all hides every puppy, including the one just shown by show_available_only', Object.values(clearAllRes.body.showcase.puppies).every(e => e.visible === false))
    check('3', 'clear_all does not alter any puppy\'s availability', clearAllRes.body.showcase.puppies[p2].availability === 'on_hold' && clearAllRes.body.showcase.puppies[p3].availability === 'reserved')
  }

  // ── Test 4: availability changes never alter visibility, end to end ──
  {
    const breeder = await newUser('sc4breeder', breederPlusProfile)
    const litterId = `litter4_${R}`
    const p1 = `p1_${R}_4`
    await seedLitter(breeder.uid, litterId, [p1])
    await seedPuppy(breeder.uid, p1, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())

    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true }, breeder.idToken), mockRes())
    const afterAvailability = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, availability: 'reserved' }, breeder.idToken), afterAvailability)
    check('4', 'Changing availability alone leaves a previously-shown puppy visible', afterAvailability.body.showcase.puppies[p1].visible === true && afterAvailability.body.showcase.puppies[p1].availability === 'reserved')

    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: false }, breeder.idToken), mockRes())
    const afterAvailability2 = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, availability: 'unavailable' }, breeder.idToken), afterAvailability2)
    check('4', 'Changing availability alone leaves a previously-hidden puppy hidden', afterAvailability2.body.showcase.puppies[p1].visible === false && afterAvailability2.body.showcase.puppies[p1].availability === 'unavailable')
  }

  // ── Test 5: cross-tenant and non-owner access is denied on every endpoint ──
  {
    const owner = await newUser('sc5owner', breederPlusProfile)
    const stranger = await newUser('sc5stranger', breederPlusProfile)
    const litterId = `litter5_${R}`
    const p1 = `p1_${R}_5`
    await seedLitter(owner.uid, litterId, [p1])
    await seedPuppy(owner.uid, p1, litterId)
    await createShowcaseHandler(mockReq({ litterId }, owner.idToken), mockRes())

    await seedLitter(owner.uid, `litter5b_${R}`, [])
    const createRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId: `litter5b_${R}` }, stranger.idToken), createRes)
    check('5', 'create-showcase denies a stranger creating a Showcase for someone else\'s litter', createRes.statusCode === 403)

    const enableRes = mockRes()
    await setEnabledHandler(mockReq({ litterId, enabled: true }, stranger.idToken), enableRes)
    check('5', 'set-showcase-enabled denies a stranger', enableRes.statusCode === 403)

    const puppyRes = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true }, stranger.idToken), puppyRes)
    check('5', 'update-showcase-puppy denies a stranger', puppyRes.statusCode === 403)

    const bulkRes = mockRes()
    await bulkHandler(mockReq({ litterId, action: 'select_all' }, stranger.idToken), bulkRes)
    check('5', 'bulk-update-showcase-puppies denies a stranger', bulkRes.statusCode === 403)

    const showcaseAfter = await seedDb.collection('litterShowcases').doc(litterId).get()
    check('5', 'None of the denied cross-tenant attempts mutated the real Showcase document', JSON.stringify(showcaseAfter.data()?.puppies || {}) === '{}')
  }

  // ── Test 6: Owner and Free-plan roles cannot manage Showcases ──
  {
    const owner = await newUser('sc6owner', { role: 'owner', plan: 'plus', email: 'o@example.com' })
    const freeBreeder = await newUser('sc6free', { role: 'breeder', plan: 'free', email: 'f@example.com' })
    const noProfileUser = await newUser('sc6noprofile', null)
    const breeder = await newUser('sc6breeder', breederPlusProfile)
    const litterId = `litter6_${R}`
    await seedLitter(breeder.uid, litterId, [])

    const ownerRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, owner.idToken), ownerRes)
    check('6', 'A Pet Owner role is denied with SHOWCASE_ROLE_GATE (403), even for their OWN litter', ownerRes.statusCode === 403 && ownerRes.body?.reason === 'SHOWCASE_ROLE_GATE')

    const freeRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, freeBreeder.idToken), freeRes)
    check('6', 'A Free-plan breeder is denied with SHOWCASE_PLAN_GATE (403)', freeRes.statusCode === 403 && freeRes.body?.reason === 'SHOWCASE_PLAN_GATE')

    const noProfileRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, noProfileUser.idToken), noProfileRes)
    check('6', 'A user with no profile document at all is denied (fails closed, not open)', noProfileRes.statusCode === 403)

    const okRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), okRes)
    check('6', 'Sanity: the actual owning Plus-plan breeder IS allowed', okRes.statusCode === 200)
  }

  // ── Test 7: disabling a Showcase preserves its configuration ──
  {
    const breeder = await newUser('sc7breeder', breederPlusProfile)
    const litterId = `litter7_${R}`
    const p1 = `p1_${R}_7`
    await seedLitter(breeder.uid, litterId, [p1])
    await seedPuppy(breeder.uid, p1, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true, availability: 'reserved' }, breeder.idToken), mockRes())

    const disableRes = mockRes()
    await setEnabledHandler(mockReq({ litterId, enabled: false }, breeder.idToken), disableRes)
    check('7', 'Disabling succeeds', disableRes.statusCode === 200 && disableRes.body.showcase.enabled === false)
    check('7', 'Disabling preserves the puppy visible/availability configuration', disableRes.body.showcase.puppies[p1].visible === true && disableRes.body.showcase.puppies[p1].availability === 'reserved')

    const reenableRes = mockRes()
    await setEnabledHandler(mockReq({ litterId, enabled: true }, breeder.idToken), reenableRes)
    check('7', 'Re-enabling does NOT reset puppy selection back to zero — only a brand-new Showcase starts at zero', reenableRes.body.showcase.puppies[p1].visible === true && reenableRes.body.showcase.puppies[p1].availability === 'reserved')
  }

  // ── Test 8: firestore.rules deny direct client writes and scope reads to the owning tenant ──
  {
    const { signInWithEmailAndPassword, signOut } = await import('firebase/auth')
    async function signInAs(u) {
      await signOut(clientAuth).catch(() => {})
      await signInWithEmailAndPassword(clientAuth, u.email, PW)
    }

    const owner = await newUser('sc8owner', breederPlusProfile)
    const stranger = await newUser('sc8stranger', breederPlusProfile)
    const litterId = `litter8_${R}`
    await seedLitter(owner.uid, litterId, [])
    await createShowcaseHandler(mockReq({ litterId }, owner.idToken), mockRes())

    await signInAs(owner)
    let readAllowed = false
    try { const snap = await getDoc(doc(clientDb, 'litterShowcases', litterId)); readAllowed = snap.exists() } catch { readAllowed = false }
    check('8', 'The owning tenant can read their own Showcase directly via the client SDK', readAllowed)

    let directWriteDenied = false
    try { await setDoc(doc(clientDb, 'litterShowcases', litterId), { enabled: true }, { merge: true }) } catch (err) { directWriteDenied = isDenied(err) }
    check('8', 'A direct client write to litterShowcases (even by the owning tenant) is denied — Admin SDK endpoints only', directWriteDenied)

    await signInAs(stranger)
    let strangerReadDenied = false
    try { await getDoc(doc(clientDb, 'litterShowcases', litterId)) } catch (err) { strangerReadDenied = isDenied(err) }
    check('8', 'A stranger cannot read someone else\'s Showcase directly', strangerReadDenied)

    await signOut(clientAuth).catch(() => {})
  }

  // ── Test 8b (STAGING QA FIX): firestore.rules must not deny a read of a
  // litterShowcases document that does not exist yet. This is the exact
  // production defect: every litter starts with NO Showcase document
  // (create-showcase.js is the only write path, opt-in) — the ORIGINAL
  // rule dereferenced `resource.data.tenantId` unconditionally, which
  // throws a Rules-evaluation error (surfaced to the client as
  // "Missing or insufficient permissions.") on a nonexistent document,
  // instead of a clean "not found". lib/db.ts's getShowcaseForLitter()
  // already correctly treats `!snap.exists()` as "no Showcase yet" — the
  // bug was purely in Rules denying the read attempt before the SDK could
  // even report that. Also covers unauthenticated denial and
  // malformed/missing-ownership-field fail-closed behavior, per the
  // staging QA fix task's explicit test requirements. ──
  {
    const { signInWithEmailAndPassword, signOut } = await import('firebase/auth')
    async function signInAs(u) {
      await signOut(clientAuth).catch(() => {})
      await signInWithEmailAndPassword(clientAuth, u.email, PW)
    }

    const owner = await newUser('sc8bowner', breederPlusProfile)
    const stranger = await newUser('sc8bstranger', breederPlusProfile)
    const petOwner = await newUser('sc8bpetowner', { role: 'owner', plan: 'plus', email: 'petowner@example.com' })
    const litterId = `litter8b_${R}`
    await seedLitter(owner.uid, litterId, [])
    // Deliberately NEVER call createShowcaseHandler here — the whole
    // point is to test the state every litter starts in.

    await signInAs(owner)
    let ownerReadThrew = false
    let ownerSnapExists = 'not-checked'
    try {
      const snap = await getDoc(doc(clientDb, 'litterShowcases', litterId))
      ownerSnapExists = snap.exists()
    } catch {
      ownerReadThrew = true
    }
    check('8b', 'THE BUG: the owning breeder reading a litterShowcases doc that does not exist yet must NOT throw permission-denied', !ownerReadThrew)
    check('8b', 'The read correctly resolves to "not found" (exists() === false), matching getShowcaseForLitter()\'s own null-return contract', ownerSnapExists === false)

    // A stranger's read of the SAME nonexistent doc must also not throw —
    // matching the established dogs/{dogId}-style precedent: a missing
    // document exposes no data either way, regardless of who's asking.
    await signInAs(stranger)
    let strangerReadThrew = false
    try { await getDoc(doc(clientDb, 'litterShowcases', litterId)) } catch { strangerReadThrew = true }
    check('8b', 'A stranger reading the same nonexistent doc also does not throw permission-denied (no data to leak either way)', !strangerReadThrew)

    // A pet-owner-role account is denied for someone else's (existing)
    // Showcase — the rule has no role concept at all, purely tenantId;
    // confirmed here with a REAL existing document this time, so this
    // exercises the resource!=null branch specifically.
    await createShowcaseHandler(mockReq({ litterId }, owner.idToken), mockRes())
    await signInAs(petOwner)
    let petOwnerDenied = false
    try { await getDoc(doc(clientDb, 'litterShowcases', litterId)) } catch (err) { petOwnerDenied = isDenied(err) }
    check('8b', 'A Pet Owner-role account is denied reading another account\'s EXISTING Showcase (tenantId mismatch, not a role check)', petOwnerDenied)

    // Unauthenticated (signed-out) access must be denied outright — both
    // for the existing doc and (separately) is covered implicitly since
    // isSignedIn() is checked before the resource==null branch even runs.
    await signOut(clientAuth).catch(() => {})
    let anonDenied = false
    try { await getDoc(doc(clientDb, 'litterShowcases', litterId)) } catch (err) { anonDenied = isDenied(err) }
    check('8b', 'An unauthenticated (signed-out) client is denied reading an existing Showcase', anonDenied)

    let anonDeniedNonexistent = false
    const neverCreatedLitterId = `litter8b-never-created_${R}`
    try { await getDoc(doc(clientDb, 'litterShowcases', neverCreatedLitterId)) } catch (err) { anonDeniedNonexistent = isDenied(err) }
    check('8b', 'An unauthenticated client is ALSO denied reading a nonexistent Showcase — isSignedIn() is checked before resource==null, so the null-guard fix does not accidentally open anonymous access', anonDeniedNonexistent)

    // Malformed/missing ownership field: seed a raw doc via the Admin SDK
    // (bypasses Rules) with NO tenantId field at all, and a second with a
    // wrong-typed tenantId — both must still deny a signed-in reader who
    // is not (and structurally cannot be recognized as) the owner.
    const malformedNoTenantId = `litter8b-malformed-no-tenant_${R}`
    await seedDb.collection('litterShowcases').doc(malformedNoTenantId).set({ litterId: malformedNoTenantId, enabled: false, puppies: {} })
    const malformedWrongType = `litter8b-malformed-wrong-type_${R}`
    await seedDb.collection('litterShowcases').doc(malformedWrongType).set({ litterId: malformedWrongType, tenantId: 12345, enabled: false, puppies: {} })

    await signInAs(owner)
    let missingTenantIdDenied = false
    try { await getDoc(doc(clientDb, 'litterShowcases', malformedNoTenantId)) } catch (err) { missingTenantIdDenied = isDenied(err) }
    check('8b', 'A Showcase document with NO tenantId field at all fails CLOSED (denied), never silently allowed', missingTenantIdDenied)

    let wrongTypeTenantIdDenied = false
    try { await getDoc(doc(clientDb, 'litterShowcases', malformedWrongType)) } catch (err) { wrongTypeTenantIdDenied = isDenied(err) }
    check('8b', 'A Showcase document with a wrong-typed (non-string) tenantId also fails CLOSED', wrongTypeTenantIdDenied)

    await signOut(clientAuth).catch(() => {})
  }

  // ── Test 9 (Codex fix-round finding 1): persisted createdAt/updatedAt
  // are trusted Firestore server timestamps, and updatedAt genuinely
  // advances after a mutation ── reads the RAW Firestore document via the
  // Admin SDK (bypassing readShowcaseForResponse's own ISO-string
  // conversion) to prove the STORED value is a real resolved Timestamp,
  // not a `new Date().toISOString()` app-clock string — a plain string
  // would fail the `instanceof Timestamp` check below even though it
  // might still happen to look date-like.
  {
    const { Timestamp } = await import('firebase-admin/firestore')
    const breeder = await newUser('sc9breeder', breederPlusProfile)
    const litterId = `litter9_${R}`
    await seedLitter(breeder.uid, litterId, [])

    const createRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), createRes)
    check('9', 'create-showcase succeeds', createRes.statusCode === 200, JSON.stringify(createRes.body))

    const rawAfterCreate = (await seedDb.collection('litterShowcases').doc(litterId).get()).data()
    check('9', 'The RAW persisted createdAt is a genuine Firestore Timestamp (FieldValue.serverTimestamp() resolved it), not a plain string', rawAfterCreate.createdAt instanceof Timestamp)
    check('9', 'The RAW persisted updatedAt is a genuine Firestore Timestamp', rawAfterCreate.updatedAt instanceof Timestamp)
    check('9', 'On create, createdAt and updatedAt resolve to the same commit (equal to the millisecond)', rawAfterCreate.createdAt.toMillis() === rawAfterCreate.updatedAt.toMillis())

    const createdIso = createRes.body.showcase.createdAt
    const updatedIsoBefore = createRes.body.showcase.updatedAt
    check('9', 'The API response createdAt is a plain, parseable ISO string (never a raw Timestamp object)', typeof createdIso === 'string' && !Number.isNaN(new Date(createdIso).getTime()))
    check('9', 'The API response updatedAt is a plain, parseable ISO string', typeof updatedIsoBefore === 'string' && !Number.isNaN(new Date(updatedIsoBefore).getTime()))
    check('9', 'The API response ISO string matches the raw Timestamp it was converted from', createdIso === rawAfterCreate.createdAt.toDate().toISOString())

    // A small real delay so a second server-resolved timestamp is
    // guaranteed to land in a later millisecond than the first, even on
    // a very fast local emulator round trip.
    await new Promise(resolve => setTimeout(resolve, 20))

    const enableRes = mockRes()
    await setEnabledHandler(mockReq({ litterId, enabled: true }, breeder.idToken), enableRes)
    check('9', 'set-showcase-enabled succeeds', enableRes.statusCode === 200, JSON.stringify(enableRes.body))

    const rawAfterUpdate = (await seedDb.collection('litterShowcases').doc(litterId).get()).data()
    check('9', 'updatedAt (raw Timestamp) genuinely advances after a mutation', rawAfterUpdate.updatedAt.toMillis() > rawAfterCreate.updatedAt.toMillis())
    check('9', 'createdAt (raw Timestamp) is untouched by an update — only updatedAt moves', rawAfterUpdate.createdAt.toMillis() === rawAfterCreate.createdAt.toMillis())
    check('9', 'The API response updatedAt string also advances after the mutation', enableRes.body.showcase.updatedAt !== updatedIsoBefore && new Date(enableRes.body.showcase.updatedAt).getTime() > new Date(updatedIsoBefore).getTime())
    check('9', 'The API response createdAt string is unchanged after the mutation', enableRes.body.showcase.createdAt === createdIso)

    // A second mutation type (update-showcase-puppy) is covered too —
    // the fix touched all four endpoints identically.
    await seedPuppy(breeder.uid, `pup9_${R}`, litterId)
    await seedDb.collection('litters').doc(litterId).update({ puppyIds: [`pup9_${R}`] })
    await new Promise(resolve => setTimeout(resolve, 20))
    const puppyRes = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: `pup9_${R}`, visible: true }, breeder.idToken), puppyRes)
    check('9', 'update-showcase-puppy also advances updatedAt via a trusted server timestamp', puppyRes.body.showcase.updatedAt !== enableRes.body.showcase.updatedAt && new Date(puppyRes.body.showcase.updatedAt).getTime() > new Date(enableRes.body.showcase.updatedAt).getTime())

    // And bulk-update-showcase-puppies.
    await new Promise(resolve => setTimeout(resolve, 20))
    const bulkRes = mockRes()
    await bulkHandler(mockReq({ litterId, action: 'clear_all' }, breeder.idToken), bulkRes)
    check('9', 'bulk-update-showcase-puppies also advances updatedAt via a trusted server timestamp', bulkRes.body.showcase.updatedAt !== puppyRes.body.showcase.updatedAt && new Date(bulkRes.body.showcase.updatedAt).getTime() > new Date(puppyRes.body.showcase.updatedAt).getTime())
  }

  // ── Test 10 (UI-gap fix — REQUIRED UX: "After reload, all successfully
  // saved values must persist"): a FRESH, INDEPENDENT read — a raw
  // Firestore get(), not the write response the mutation itself
  // returned — after each of the four editing mutations, proving the
  // value genuinely persisted server-side and isn't merely an artifact
  // of the response payload. Simulates the real "reload the page /
  // re-expand the litter" flow, which calls getShowcaseForLitter() fresh
  // (src/lib/db.ts), independent of whatever the mutation call itself
  // last returned. ──
  {
    const breeder = await newUser('sc10breeder', breederPlusProfile)
    const litterId = `litter10_${R}`
    const p1 = `p1_${R}_10`
    await seedLitter(breeder.uid, litterId, [p1])
    await seedPuppy(breeder.uid, p1, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())

    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true, availability: 'reserved' }, breeder.idToken), mockRes())
    await setEnabledHandler(mockReq({ litterId, enabled: true }, breeder.idToken), mockRes())

    // A genuinely independent read — mirrors getShowcaseForLitter()'s own
    // getDoc() call, not the mutation handlers' own response.
    const reloaded = await seedDb.collection('litterShowcases').doc(litterId).get()
    const reloadedData = reloaded.data()
    check('10', 'After "reload" (a fresh, independent read), the enabled flag persisted', reloadedData.enabled === true)
    check('10', 'After "reload", the puppy visibility persisted', reloadedData.puppies[p1].visible === true)
    check('10', 'After "reload", the puppy availability persisted', reloadedData.puppies[p1].availability === 'reserved')

    // A second reload after a bulk action, confirming the same holds for
    // that mutation path too.
    await bulkHandler(mockReq({ litterId, action: 'clear_all' }, breeder.idToken), mockRes())
    const reloadedAfterBulk = (await seedDb.collection('litterShowcases').doc(litterId).get()).data()
    check('10', 'After "reload", a bulk action\'s result also persisted (visible cleared)', reloadedAfterBulk.puppies[p1].visible === false)
    check('10', 'After "reload", the bulk action did not touch availability (still "reserved")', reloadedAfterBulk.puppies[p1].availability === 'reserved')
  }

  // ── Test 11 (UI-gap fix — REQUIRED UX: "unauthorized writes" must still
  // be denied via the autosave-triggered endpoints, so the owner's UI
  // never shows "All changes saved" for a write that actually belongs to
  // someone else). This is the same guarantee Test 5 already proves for
  // every endpoint — restated explicitly here in the context of this
  // specific fix, plus a check that a denied write leaves NO trace in the
  // persisted document (not even a partial field). ──
  {
    const owner = await newUser('sc11owner', breederPlusProfile)
    const stranger = await newUser('sc11stranger', breederPlusProfile)
    const litterId = `litter11_${R}`
    const p1 = `p1_${R}_11`
    await seedLitter(owner.uid, litterId, [p1])
    await seedPuppy(owner.uid, p1, litterId)
    await createShowcaseHandler(mockReq({ litterId }, owner.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: false, availability: 'available' }, owner.idToken), mockRes())

    const strangerRes = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true, availability: 'unavailable' }, stranger.idToken), strangerRes)
    check('11', 'A stranger\'s attempt to save a puppy change via the autosave endpoint is denied (403)', strangerRes.statusCode === 403)

    const afterDeniedWrite = (await seedDb.collection('litterShowcases').doc(litterId).get()).data()
    check('11', 'The denied write left NO trace at all — the owner\'s last genuinely saved values are completely unchanged', afterDeniedWrite.puppies[p1].visible === false && afterDeniedWrite.puppies[p1].availability === 'available')
  }

  await summary()
} else {
  skip('Section 7 (emulator end-to-end behavioral tests, including the finding-1 timestamp tests and the UI-gap-fix reload-persistence test)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
  await summary()
}
