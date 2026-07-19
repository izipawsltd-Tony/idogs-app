// scripts/test-round15-dognew-single-flight.mjs — Codex round 15,
// Blocker 3: DogNewPage's create/submit path must be single-flight — a
// synchronous ref-based lock acquired at the FIRST line of every entry
// point, before getDogs() or any other await, so two near-simultaneous
// submissions (double-click, double Enter, a click racing a duplicate
// Enter-key submit, or a double click on "Add anyway") can never both
// reach createDog().
//
// DogNewPage is a React component with JSX/hooks that can't be rendered
// in this plain-Node script (no test renderer configured — see
// CLAUDE.md). The lock's control flow is mirrored exactly here — same
// acquire/release call sites, same order of operations relative to the
// awaited duplicate-check and create calls — combined with source-pattern
// checks against the real file (Section 5) so the mirror can't silently
// drift from what's actually shipped.
//
// Usage: node scripts/test-round15-dognew-single-flight.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, summary } = makeChecker()

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

// ── Mirror of DogNewPage's single-flight lock + handleSubmit/
// proceedWithCreate control flow ──
function makeDogNewPageMirror({ getDogsImpl, createDogImpl, form }) {
  let submittingRef = false
  const events = []

  function acquireSubmitLock() {
    if (submittingRef) return false
    submittingRef = true
    return true
  }
  function releaseSubmitLock() {
    submittingRef = false
  }

  async function proceedWithCreate() {
    // Assumes the lock is ALREADY held by the caller (handleSubmit's
    // no-duplicate path, or the "Add anyway" click) — this is the one
    // function that calls createDog(), and releases the lock on every
    // terminal outcome.
    try {
      const dogId = await createDogImpl(form)
      events.push({ type: 'created', dogId })
      return dogId
    } catch {
      events.push({ type: 'create-failed' })
    } finally {
      releaseSubmitLock()
    }
  }

  async function handleSubmit() {
    if (!acquireSubmitLock()) { events.push({ type: 'blocked-by-lock' }); return }
    if (!form.name || !form.breed || !form.dateOfBirth) {
      events.push({ type: 'validation-error' })
      releaseSubmitLock()
      return
    }
    let duplicateFound = null
    try {
      const existingDogs = await getDogsImpl()
      const active = existingDogs.filter(d => d.status !== 'transferred')
      const microchipMatch = form.microchip && active.find(d => d.microchip === form.microchip)
      if (microchipMatch) duplicateFound = { matchedBy: 'microchip', existingDogName: microchipMatch.name }
    } catch {
      events.push({ type: 'duplicate-check-failed' })
      releaseSubmitLock()
      return
    }
    if (duplicateFound) {
      events.push({ type: 'duplicate-warning-shown' })
      releaseSubmitLock()
      return
    }
    await proceedWithCreate()
  }

  function clickAddAnyway() {
    if (!acquireSubmitLock()) { events.push({ type: 'add-anyway-blocked-by-lock' }); return Promise.resolve() }
    return proceedWithCreate()
  }

  return { handleSubmit, clickAddAnyway, events, isLocked: () => submittingRef }
}

// =========================================================================
// SECTION 1 — two simultaneous handleSubmit() calls (double-click):
// createDog must be called exactly once
// =========================================================================
await checkAsync('two simultaneous handleSubmit() calls (double-click) result in exactly ONE createDog() call',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      getDogsImpl: async () => { await sleep(5); return [] }, // no duplicates
      createDogImpl: async () => { createCalls++; await sleep(5); return 'dog-1' },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    // Simulate a double-click: both calls fire essentially simultaneously.
    await Promise.all([mirror.handleSubmit(), mirror.handleSubmit()])
    const blockedEvents = mirror.events.filter(e => e.type === 'blocked-by-lock')
    return createCalls === 1 && blockedEvents.length === 1
  })())

await checkAsync('three simultaneous handleSubmit() calls still result in exactly ONE createDog() call',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      getDogsImpl: async () => { await sleep(5); return [] },
      createDogImpl: async () => { createCalls++; await sleep(5); return 'dog-1' },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await Promise.all([mirror.handleSubmit(), mirror.handleSubmit(), mirror.handleSubmit()])
    return createCalls === 1
  })())

// =========================================================================
// SECTION 2 — double "Add anyway" click: createDog must be called
// exactly once even when both clicks fire before the first async
// continuation runs
// =========================================================================
await checkAsync('two simultaneous "Add anyway" clicks result in exactly ONE createDog() call',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; await sleep(5); return 'dog-1' },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await Promise.all([mirror.clickAddAnyway(), mirror.clickAddAnyway()])
    const blocked = mirror.events.filter(e => e.type === 'add-anyway-blocked-by-lock')
    return createCalls === 1 && blocked.length === 1
  })())

// =========================================================================
// SECTION 3 — a submit racing an "Add anyway" click (e.g. the duplicate
// modal is open and the user manages to also re-submit the form somehow)
// must still only create one dog
// =========================================================================
await checkAsync('handleSubmit() and clickAddAnyway() racing each other still result in at most ONE createDog() call',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      getDogsImpl: async () => { await sleep(3); return [] },
      createDogImpl: async () => { createCalls++; await sleep(5); return 'dog-1' },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await Promise.all([mirror.handleSubmit(), mirror.clickAddAnyway()])
    return createCalls === 1
  })())

// =========================================================================
// SECTION 4 — lock release paths: every non-success exit must release
// the lock so a SUBSEQUENT, sequential submission can proceed
// =========================================================================
await checkAsync('lock releases on a validation error, so a corrected resubmit can proceed',
  (async () => {
    const mirror = makeDogNewPageMirror({
      getDogsImpl: async () => [],
      createDogImpl: async () => 'dog-1',
      form: { name: '', breed: '', dateOfBirth: '' }, // fails validation
    })
    await mirror.handleSubmit()
    const releasedAfterValidationError = !mirror.isLocked()
    mirror.events.length = 0
    return releasedAfterValidationError && mirror.events.filter(e => e.type === 'validation-error').length === 0 // sanity: fresh events array
  })())

await checkAsync('lock releases when the duplicate check itself fails (fail-closed load failure), so a retry submit can proceed',
  (async () => {
    const mirror = makeDogNewPageMirror({
      getDogsImpl: async () => { throw new Error('network error') },
      createDogImpl: async () => 'dog-1',
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    return !mirror.isLocked() && mirror.events.some(e => e.type === 'duplicate-check-failed')
  })())

await checkAsync('lock releases when a duplicate warning is shown (cancel/back path), so "Go back & check" then a fresh submit works',
  (async () => {
    const mirror = makeDogNewPageMirror({
      getDogsImpl: async () => [{ status: 'active', microchip: 'CHIP123', name: 'Existing Dog' }],
      createDogImpl: async () => 'dog-1',
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: 'CHIP123' },
    })
    await mirror.handleSubmit()
    return !mirror.isLocked() && mirror.events.some(e => e.type === 'duplicate-warning-shown')
  })())

await checkAsync('lock releases on a terminal createDog() failure, so a retry submit can proceed',
  (async () => {
    const mirror = makeDogNewPageMirror({
      getDogsImpl: async () => [],
      createDogImpl: async () => { throw new Error('server error') },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    return !mirror.isLocked() && mirror.events.some(e => e.type === 'create-failed')
  })())

await checkAsync('after a successful create, a SEQUENTIAL second submit (not concurrent) is allowed to proceed — the lock is per-attempt, not permanent',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return `dog-${createCalls}` },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    await mirror.handleSubmit() // sequential, not concurrent — e.g. adding a second, different dog afterwards
    return createCalls === 2
  })())

// =========================================================================
// SECTION 5 — source-pattern checks against the REAL DogNewPage.tsx
// =========================================================================
{
  const src = readFileSync(new URL('../src/pages/DogNewPage.tsx', import.meta.url), 'utf8')

  check('submittingRef is a useRef (synchronous), not just useState', /const submittingRef = useRef\(false\)/.test(src))
  check('acquireSubmitLock() is defined and checks the ref synchronously', /function acquireSubmitLock\(\)[\s\S]{0,120}if \(submittingRef\.current\) return false/.test(src))

  const handleSubmitMatch = src.match(/async function handleSubmit\(e: FormEvent\)[\s\S]*?\n  \}\r?\n\r?\n  \/\/ Codex round 15: assumes/)
  const handleSubmitBlock = handleSubmitMatch ? handleSubmitMatch[0] : ''
  check('handleSubmit() was actually located for inspection (sanity check on the pattern above)', handleSubmitBlock.length > 0)
  check('handleSubmit() acquires the submit lock as its very first statement, right after e.preventDefault() (only comments may sit between them)',
    /e\.preventDefault\(\)(?:\s*\/\/[^\n]*\n)*\s*if \(!acquireSubmitLock\(\)\) return/.test(handleSubmitBlock))
  check('handleSubmit() acquires the lock BEFORE the duplicate check\'s getDogs() call',
    handleSubmitBlock.indexOf('acquireSubmitLock()') < handleSubmitBlock.indexOf('await getDogs()'))

  // Locate the ACTUAL "Add anyway" button JSX (not an earlier comment
  // mentioning the same phrase) by anchoring on its onClick handler,
  // which is uniquely identified by setDuplicateWarning(null) followed
  // by proceedWithCreate().
  const addAnywayMatch = src.match(/onClick=\{\(\) => \{[\s\S]*?setDuplicateWarning\(null\)[\s\S]*?proceedWithCreate\(\)[\s\S]*?\}\}/)
  const addAnywayBlock = addAnywayMatch ? addAnywayMatch[0] : ''
  check('"Add anyway" onClick was actually located for inspection (sanity check on the pattern above)', addAnywayBlock.length > 0)
  check('"Add anyway" onClick acquires the submit lock before calling proceedWithCreate()',
    /if \(!acquireSubmitLock\(\)\) return[\s\S]*?proceedWithCreate\(\)/.test(addAnywayBlock))
  check('"Add anyway" button is disabled while submitting', /disabled=\{submitting\}[\s\S]{0,300}Add anyway/.test(src))

  check('proceedWithCreate() releases the lock in a finally block', /releaseSubmitLock\(\)/.test(src) && /\} finally \{\s*setLoading\(false\)\s*releaseSubmitLock\(\)/.test(src))
  check('the submit button is disabled while submitting', /disabled=\{loading \|\| submitting\}/.test(src))
}

await summary()
