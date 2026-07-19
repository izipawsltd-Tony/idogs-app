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

// ── Mirror of DogNewPage's single-flight lock + UID binding +
// handleSubmit/proceedWithCreate control flow (round 16 adds the UID
// binding: getUid() supplies the "currently authenticated uid", settable
// mid-test via setUid() to simulate an account switch while an operation
// is in flight — same shape as useRequestGuard's beginRequest()/
// isCurrent(), just inlined here since DogNewPage can't be rendered
// without a test framework this project doesn't have configured) ──
function makeDogNewPageMirror({ getDogsImpl, createDogImpl, form, initialUid }) {
  let submittingRef = false
  let trackedUid = initialUid
  let generation = 0
  const events = []

  function setUid(newUid) {
    if (newUid !== trackedUid) { trackedUid = newUid; generation++ }
  }
  function beginRequest() {
    const gen = ++generation
    const requestUid = trackedUid
    return { isCurrent: () => trackedUid === requestUid && generation === gen }
  }

  function acquireSubmitLock() {
    if (submittingRef) return false
    submittingRef = true
    return true
  }
  function releaseSubmitLock() {
    submittingRef = false
  }

  async function proceedWithCreate(req) {
    // Assumes the lock is ALREADY held by the caller (handleSubmit's
    // no-duplicate path, or the "Add anyway" click) — this is the one
    // function that calls createDog(), and releases the lock on every
    // terminal outcome.
    try {
      if (!req.isCurrent()) { events.push({ type: 'aborted-before-create' }); return }
      const dogId = await createDogImpl(form)
      if (!req.isCurrent()) { events.push({ type: 'aborted-after-create-follow-up-skipped', dogId }); return }
      events.push({ type: 'created', dogId })
      return dogId
    } catch {
      events.push({ type: 'create-failed' })
    } finally {
      releaseSubmitLock()
    }
  }

  async function handleSubmit() {
    if (!trackedUid) { events.push({ type: 'blocked-no-uid' }); return }
    if (!acquireSubmitLock()) { events.push({ type: 'blocked-by-lock' }); return }
    const req = beginRequest()
    if (!form.name || !form.breed || !form.dateOfBirth) {
      events.push({ type: 'validation-error' })
      releaseSubmitLock()
      return
    }
    let duplicateFound = null
    try {
      const existingDogs = await getDogsImpl()
      if (!req.isCurrent()) {
        events.push({ type: 'aborted-after-duplicate-check' })
        releaseSubmitLock()
        return
      }
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
    await proceedWithCreate(req)
  }

  function clickAddAnyway() {
    if (!trackedUid) { events.push({ type: 'add-anyway-blocked-no-uid' }); return Promise.resolve() }
    if (!acquireSubmitLock()) { events.push({ type: 'add-anyway-blocked-by-lock' }); return Promise.resolve() }
    const req = beginRequest()
    return proceedWithCreate(req)
  }

  return { handleSubmit, clickAddAnyway, events, isLocked: () => submittingRef, setUid, getTrackedUid: () => trackedUid }
}

// =========================================================================
// SECTION 1 — two simultaneous handleSubmit() calls (double-click):
// createDog must be called exactly once
// =========================================================================
await checkAsync('two simultaneous handleSubmit() calls (double-click) result in exactly ONE createDog() call',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
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
      initialUid: 'account-A',
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
      initialUid: 'account-A',
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
      initialUid: 'account-A',
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
      initialUid: 'account-A',
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
      initialUid: 'account-A',
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
      initialUid: 'account-A',
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
      initialUid: 'account-A',
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
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return `dog-${createCalls}` },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    await mirror.handleSubmit() // sequential, not concurrent — e.g. adding a second, different dog afterwards
    return createCalls === 2
  })())

// =========================================================================
// SECTION 4b (round 16, Blocker 3) — UID-binding / account-switch
// concurrency: account A's limit/duplicate-check result must NEVER create
// a dog under account B, even if the account switches mid-operation.
// =========================================================================
await checkAsync('A\'s duplicate check in flight → account switches to B before it resolves → the operation aborts and does NOT create a dog under B',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => { await sleep(10); return [] }, // slow — gives us time to switch mid-flight
      createDogImpl: async () => { createCalls++; return 'dog-1' },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    const submitPromise = mirror.handleSubmit()
    await sleep(2) // let handleSubmit acquire the lock and start awaiting getDogs()
    mirror.setUid('account-B') // account switch while the duplicate check is still in flight
    await submitPromise
    const aborted = mirror.events.some(e => e.type === 'aborted-after-duplicate-check')
    return createCalls === 0 && aborted && !mirror.isLocked()
  })())

await checkAsync('A\'s createDog() is in flight → account switches to B before it resolves → follow-up actions (would-be uploads/toast/navigate) are skipped, but the create itself already targeted A correctly',
  (async () => {
    let createCalls = 0
    let capturedUidAtCreateTime = null
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => {
        // Mirrors db.ts round-16 fix: uid captured ONCE, synchronously,
        // before createDog()'s own internal await — see the dedicated
        // createDog uid-capture test below for the isolated version of
        // this specific fix.
        capturedUidAtCreateTime = mirror.getTrackedUid()
        createCalls++
        await sleep(10) // simulates reservePassportId()'s real Firestore transaction latency
        return 'dog-1'
      },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    const submitPromise = mirror.handleSubmit()
    await sleep(2) // let it pass the duplicate check and enter proceedWithCreate → createDog()
    mirror.setUid('account-B') // switch while createDog() itself is in flight
    await submitPromise
    const followUpSkipped = mirror.events.some(e => e.type === 'aborted-after-create-follow-up-skipped')
    return createCalls === 1 && capturedUidAtCreateTime === 'account-A' && followUpSkipped
  })())

await checkAsync('no authenticated UID at all: handleSubmit() blocks immediately, never acquires the lock, never creates',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: null,
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return 'dog-1' },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    return createCalls === 0 && mirror.events.some(e => e.type === 'blocked-no-uid') && !mirror.isLocked()
  })())

await checkAsync('no authenticated UID at all: "Add anyway" also blocks immediately',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: null,
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return 'dog-1' },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.clickAddAnyway()
    return createCalls === 0 && mirror.events.some(e => e.type === 'add-anyway-blocked-no-uid')
  })())

// =========================================================================
// SECTION 4c (round 16) — the createDog() uid-capture-before-await fix in
// src/lib/db.ts, isolated: uid MUST be read once, before
// reservePassportId()'s own await, not re-read afterwards when building
// the addDoc() payload.
// =========================================================================
{
  // Mirrors the BUGGY (pre-round-16) shape: reads uid() again after the
  // await, so a uid change during the await changes the attributed owner.
  async function createDogBuggyMirror(reservePassportIdImpl, getCurrentUid) {
    await reservePassportIdImpl()
    return { tenantId: getCurrentUid(), currentOwnerId: getCurrentUid() } // BUG: re-read after await
  }
  // Mirrors the FIXED (round-16) shape: uid captured once, before the await.
  async function createDogFixedMirror(reservePassportIdImpl, getCurrentUid) {
    const creatorUid = getCurrentUid()
    await reservePassportIdImpl()
    return { tenantId: creatorUid, currentOwnerId: creatorUid }
  }

  await checkAsync('BUGGY shape (for contrast): a uid switch during reservePassportId()\'s await DOES leak into tenantId — demonstrates the bug this round fixes actually existed',
    (async () => {
      let currentUid = 'account-A'
      const result = await createDogBuggyMirror(async () => {
        await sleep(5)
        currentUid = 'account-B' // account switches mid-reservation
      }, () => currentUid)
      return result.tenantId === 'account-B' // proves the bug: dog attributed to the WRONG (later) account
    })())

  await checkAsync('FIXED shape: a uid switch during reservePassportId()\'s await does NOT leak into tenantId — always attributed to the account that initiated the create',
    (async () => {
      let currentUid = 'account-A'
      const result = await createDogFixedMirror(async () => {
        await sleep(5)
        currentUid = 'account-B' // account switches mid-reservation
      }, () => currentUid)
      return result.tenantId === 'account-A' && result.currentOwnerId === 'account-A'
    })())

  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  const createDogMatch = dbSrc.match(/export async function createDog\([\s\S]*?\n}\r?\n/)
  const createDogBlock = createDogMatch ? createDogMatch[0] : ''
  check('createDog() source was actually located for inspection', createDogBlock.length > 0)
  check('createDog() captures uid() into creatorUid BEFORE calling reservePassportId() (before its own internal await)',
    createDogBlock.indexOf('const creatorUid = uid()') > -1 &&
    createDogBlock.indexOf('const creatorUid = uid()') < createDogBlock.indexOf('await reservePassportId('))
  check('createDog() uses creatorUid (not a fresh uid() call) for tenantId', /tenantId: creatorUid/.test(createDogBlock))
  check('createDog() uses creatorUid (not a fresh uid() call) for currentOwnerId', /currentOwnerId: creatorUid/.test(createDogBlock))
  check('createDog() uses creatorUid (not a fresh uid() call) for createdByUserId', /createdByUserId: creatorUid/.test(createDogBlock))
  check('createDog() no longer calls uid() again inside the addDoc() payload (only the one captured value is used)',
    (() => {
      const addDocMatch = createDogBlock.match(/addDoc\(collection\(db, 'dogs'\), \{[\s\S]*?\}\)/)
      const addDocBlock = addDocMatch ? addDocMatch[0] : ''
      return addDocBlock.length > 0 && !/uid\(\)/.test(addDocBlock)
    })())
  check('reservePassportId() now takes the caller\'s captured uid as a parameter, rather than reading uid() itself inside its own transaction',
    /async function reservePassportId\(namePart: string, yearPart: string, createdByUid: string\)/.test(dbSrc) &&
    /createdBy: createdByUid/.test(dbSrc))
}

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
  check('handleSubmit() acquires the submit lock right after e.preventDefault() — only comments and a synchronous (no-await) UID-presence guard may sit between them (round 16: "if no authenticated UID, block creation")',
    /e\.preventDefault\(\)(?:\s*\/\/[^\n]*\n|\s*if \(!user\?\.uid\)[\s\S]*?return\r?\n\s*\}\r?\n)*\s*if \(!acquireSubmitLock\(\)\) return/.test(handleSubmitBlock))
  check('handleSubmit() does not await anything before acquiring the submit lock',
    !/await[\s\S]*?acquireSubmitLock/.test(handleSubmitBlock.slice(0, handleSubmitBlock.indexOf('acquireSubmitLock()') + 1)))
  check('handleSubmit() acquires the lock BEFORE the duplicate check\'s getDogs() call',
    handleSubmitBlock.indexOf('acquireSubmitLock()') < handleSubmitBlock.indexOf('await getDogs()'))
  check('handleSubmit() captures a beginRequest() token (UID binding) right after acquiring the lock, before any await',
    handleSubmitBlock.indexOf('beginRequest()') > handleSubmitBlock.indexOf('acquireSubmitLock()') &&
    handleSubmitBlock.indexOf('beginRequest()') < handleSubmitBlock.indexOf('await getDogs()'))
  check('handleSubmit() re-verifies req.isCurrent() after the duplicate check\'s await, before proceeding',
    /await getDogs\(\)[\s\S]*?if \(!req\.isCurrent\(\)\)/.test(handleSubmitBlock))

  // Locate the ACTUAL "Add anyway" button JSX (not an earlier comment
  // mentioning the same phrase) by anchoring on its onClick handler,
  // which is uniquely identified by setDuplicateWarning(null) followed
  // by proceedWithCreate().
  const addAnywayMatch = src.match(/onClick=\{\(\) => \{[\s\S]*?setDuplicateWarning\(null\)[\s\S]*?proceedWithCreate\([^)]*\)[\s\S]*?\}\}/)
  const addAnywayBlock = addAnywayMatch ? addAnywayMatch[0] : ''
  check('"Add anyway" onClick was actually located for inspection (sanity check on the pattern above)', addAnywayBlock.length > 0)
  check('"Add anyway" onClick checks for an authenticated UID before doing anything else',
    /if \(!user\?\.uid\)/.test(addAnywayBlock))
  check('"Add anyway" onClick acquires the submit lock AND a fresh beginRequest() token before calling proceedWithCreate()',
    /if \(!acquireSubmitLock\(\)\) return[\s\S]*?const req = beginRequest\(\)[\s\S]*?proceedWithCreate\(req\)/.test(addAnywayBlock))
  check('"Add anyway" button is disabled while submitting', /disabled=\{submitting\}[\s\S]{0,300}Add anyway/.test(src))

  check('proceedWithCreate() releases the lock in a finally block', /releaseSubmitLock\(\)/.test(src) && /\} finally \{\s*setLoading\(false\)\s*releaseSubmitLock\(\)/.test(src))
  check('the submit button is disabled while submitting', /disabled=\{loading \|\| submitting\}/.test(src))
}

await summary()
