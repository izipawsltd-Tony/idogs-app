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
// without a test framework this project doesn't have configured).
//
// Codex round 18: adds the terminal-commit gate. `committedDogId` mirrors
// the real committedDogIdRef — set exactly once, the instant createDogImpl
// resolves, and never cleared. acquireSubmitLock() refuses once it's set,
// so a SECOND createDog() call from this same mirror instance is
// structurally impossible after a commit, regardless of what triggers the
// next call attempt (double submit, Add anyway, a follow-up failure, a
// form edit). setForm() lets a test mutate the "live" form mid-operation
// to prove proceedWithCreate() only ever uses the SNAPSHOT it captured at
// the start, never a later live read. followUpImpl (optional) lets a test
// simulate the post-create upload/record steps succeeding or failing,
// without conflating that with createDogImpl itself. ──
function makeDogNewPageMirror({ getDogsImpl, createDogImpl, followUpImpl, form, initialUid }) {
  let submittingRef = false
  let committedDogId = null
  let trackedUid = initialUid
  let generation = 0
  let currentForm = form
  let followUpCalls = 0
  const events = []

  function setUid(newUid) {
    if (newUid !== trackedUid) { trackedUid = newUid; generation++ }
  }
  function setForm(newForm) { currentForm = newForm }
  function beginRequest() {
    const gen = ++generation
    const requestUid = trackedUid
    return { isCurrent: () => trackedUid === requestUid && generation === gen }
  }

  function acquireSubmitLock() {
    // Codex round 18: refuses once a Dog has already been committed by
    // this instance — not just while submittingRef is transiently held.
    if (submittingRef || committedDogId) return false
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
    // terminal outcome. Codex round 18: this can now only ever run ONCE
    // per mirror instance for real (acquireSubmitLock() blocks re-entry
    // after commit) — no "resume from an existing id" branch exists.
    // formSnapshot is captured HERE, synchronously, before any await —
    // a setForm() call made by the test after this point must never be
    // visible to createDogImpl or the follow-up step below.
    const formSnapshot = currentForm
    try {
      if (!req.isCurrent()) { events.push({ type: 'aborted-before-create' }); return }
      const dogId = await createDogImpl(formSnapshot)
      // Terminal the instant createDogImpl resolves — mirrors
      // committedDogIdRef.current = dogId in the real component.
      committedDogId = dogId
      events.push({ type: 'committed', dogId, formSnapshot })
      if (!req.isCurrent()) { events.push({ type: 'aborted-after-create-follow-up-skipped', dogId }); return }
      if (followUpImpl) {
        followUpCalls++
        const ok = await followUpImpl(dogId, formSnapshot)
        if (!req.isCurrent()) { events.push({ type: 'aborted-after-followup', dogId }); return }
        events.push({ type: ok ? 'created-full-success' : 'created-partial-failure', dogId })
      } else {
        events.push({ type: 'created-full-success', dogId })
      }
      return dogId
    } catch {
      if (committedDogId) events.push({ type: 'create-committed-but-followup-threw', dogId: committedDogId })
      else events.push({ type: 'create-failed' })
    } finally {
      releaseSubmitLock()
    }
  }

  async function handleSubmit() {
    if (!trackedUid) { events.push({ type: 'blocked-no-uid' }); return }
    if (!acquireSubmitLock()) { events.push({ type: 'blocked-by-lock' }); return }
    const req = beginRequest()
    if (!currentForm.name || !currentForm.breed || !currentForm.dateOfBirth) {
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
      const microchipMatch = currentForm.microchip && active.find(d => d.microchip === currentForm.microchip)
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

  return {
    handleSubmit, clickAddAnyway, events, isLocked: () => submittingRef, setUid, setForm,
    getTrackedUid: () => trackedUid, getCommittedDogId: () => committedDogId, getFollowUpCalls: () => followUpCalls,
  }
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

// Codex round 18: this REPLACES the round-15/17 test that used to assert
// createCalls === 2 here ("the lock is per-attempt, not permanent"). Codex
// flagged that as the unsafe identity/idempotency gap this round exists to
// close — Dog+Passport creation is now TERMINAL per mounted instance, not
// per-attempt. A sequential (non-concurrent) second submit after a
// successful commit must be refused just as hard as a concurrent one.
await checkAsync('round 18: after a successful commit, a SEQUENTIAL second submit (not concurrent, e.g. the user clicks Submit again once it looks idle) is REFUSED — createDog is called exactly once, never twice, from the same instance',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return `dog-${createCalls}` },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    await mirror.handleSubmit() // sequential resubmit on the SAME (still-mounted) instance
    const secondBlocked = mirror.events.filter(e => e.type === 'blocked-by-lock').length === 1
    return createCalls === 1 && secondBlocked && mirror.getCommittedDogId() === 'dog-1'
  })())

await checkAsync('round 18: a SEQUENTIAL second submit after a genuinely FAILED (never-committed) createDog() call is still allowed to proceed — only a COMMIT makes the operation terminal',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; if (createCalls === 1) throw new Error('transient failure'); return 'dog-1' },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit() // fails, never commits
    await mirror.handleSubmit() // fresh attempt — not a resume of anything, just a new operation
    return createCalls === 2 && mirror.getCommittedDogId() === 'dog-1'
  })())

// =========================================================================
// SECTION 4d (round 18) — the 9 required scenarios from the Round 18 task
// spec, beyond what Sections 1-4b already cover (double-click/Add-anyway
// concurrency, lock release paths, and the A→B account-switch races are
// all already exercised above and remain valid under the round-18 design).
// =========================================================================

// Scenario 1: Dog commit + one follow-up fails → createDog called once.
await checkAsync('round 18 scenario 1: Dog commits, one follow-up write fails → createDog() called exactly once, follow-up reported as partial failure',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return 'dog-1' },
      followUpImpl: async () => false, // simulates one failed vaccine/health/upload write
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    const partial = mirror.events.some(e => e.type === 'created-partial-failure')
    return createCalls === 1 && partial && mirror.getCommittedDogId() === 'dog-1'
  })())

// Scenario 2: form/files change AFTER the operation has started (mid-flight,
// before it resolves) must never leak into the Dog being created or its
// follow-ups, and must never cause a second create.
await checkAsync('round 18 scenario 2: form changes WHILE createDog() is in flight → the create uses the ORIGINAL snapshot, not the edited form, and still only ONE createDog() call happens',
  (async () => {
    let createCalls = 0
    let formSeenByCreate = null
    const originalForm = { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' }
    const editedForm = { name: 'Max (edited mid-flight)', breed: 'Poodle', dateOfBirth: '2021-06-01', microchip: 'CHANGED' }
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => { await sleep(3); return [] },
      createDogImpl: async (formSnapshot) => {
        createCalls++
        formSeenByCreate = formSnapshot
        await sleep(10)
        return 'dog-1'
      },
      form: originalForm,
    })
    const submitPromise = mirror.handleSubmit()
    await sleep(6) // let it pass the duplicate check and be awaiting createDogImpl
    mirror.setForm(editedForm) // user edits the form WHILE the operation is in flight
    await submitPromise
    return createCalls === 1 && formSeenByCreate === originalForm && formSeenByCreate.name === 'Luna'
  })())

// Scenario 2b: form changes AFTER a partial-failure commit, then the user
// tries to submit AGAIN — must never reuse the old dogId/attach the new
// form to it, and must never call createDog() a second time from this
// instance (it's already terminal).
await checkAsync('round 18 scenario 2b: form edited after a partial-failure commit, user resubmits → still refused, no second createDog() call, no attachment of the new form to the old dog',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return 'dog-1' },
      followUpImpl: async () => false, // partial failure
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit() // commits, follow-up partially fails
    mirror.setForm({ name: 'A Different Dog', breed: 'Poodle', dateOfBirth: '2022-01-01', microchip: '' })
    await mirror.handleSubmit() // resubmit with changed data
    return createCalls === 1 && mirror.getCommittedDogId() === 'dog-1'
  })())

// Scenario 3: double submit/Add-anyway AFTER commit → createDog once.
await checkAsync('round 18 scenario 3: after commit, both a Submit click AND an "Add anyway" click are refused — createDog() still called exactly once',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return 'dog-1' },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    await mirror.handleSubmit()
    await mirror.clickAddAnyway()
    const blockedByLock = mirror.events.filter(e => e.type === 'blocked-by-lock').length
    const blockedAddAnyway = mirror.events.filter(e => e.type === 'add-anyway-blocked-by-lock').length
    return createCalls === 1 && blockedByLock === 1 && blockedAddAnyway === 1
  })())

// Scenario 4: navigation "delayed" (component still mounted, req still
// current, but no unmount happened yet) → a further submit attempt still
// must not create a second dog.
await checkAsync('round 18 scenario 4: full success, component remains mounted (navigation delayed) → a further submit attempt still creates nothing new',
  (async () => {
    let createCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return 'dog-1' },
      followUpImpl: async () => true, // full success
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    const fullSuccess = mirror.events.some(e => e.type === 'created-full-success')
    await mirror.handleSubmit() // simulates a click landing before navigation visually completes
    return createCalls === 1 && fullSuccess && mirror.events.filter(e => e.type === 'blocked-by-lock').length === 1
  })())

// Scenario 5: UID switch AFTER commit → remaining writes/navigation stop,
// and no second creation attempt occurs in that mounted operation.
await checkAsync('round 18 scenario 5: account switches to B right after commit, before the follow-up resolves → follow-up/navigate is skipped, dog stays correctly attributed to A, and no second create is ever attempted by this instance',
  (async () => {
    let createCalls = 0
    let followUpCalls = 0
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => { createCalls++; return 'dog-1' },
      followUpImpl: async () => { followUpCalls++; await sleep(10); return true },
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    const submitPromise = mirror.handleSubmit()
    await sleep(3) // let createDog() resolve and commit, then land inside the follow-up's own await
    mirror.setUid('account-B')
    await submitPromise
    const skipped = mirror.events.some(e => e.type === 'aborted-after-followup')
    // Even though this instance is now "stale" (account switched), a
    // further submit attempt from it (e.g. a delayed/queued event) must
    // still be refused — the commit already happened and is terminal.
    await mirror.handleSubmit()
    return createCalls === 1 && skipped && mirror.getCommittedDogId() === 'dog-1'
  })())

// Scenario 6: already-successful follow-ups are never automatically
// replayed — proven structurally by followUpCalls staying at 1 even after
// further (refused) submit attempts on the same instance.
await checkAsync('round 18 scenario 6: a successful follow-up is never replayed — follow-up runs exactly once even after further submit attempts on the same instance',
  (async () => {
    const mirror = makeDogNewPageMirror({
      initialUid: 'account-A',
      getDogsImpl: async () => [],
      createDogImpl: async () => 'dog-1',
      followUpImpl: async () => true,
      form: { name: 'Luna', breed: 'Labrador', dateOfBirth: '2020-01-01', microchip: '' },
    })
    await mirror.handleSubmit()
    await mirror.handleSubmit()
    await mirror.clickAddAnyway()
    return mirror.getFollowUpCalls() === 1
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
        await sleep(10) // simulates createDog()'s real Firestore runTransaction() latency
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
// SECTION 4c (round 16, updated round 17) — the createDog() uid-capture-
// before-await fix in src/lib/db.ts, isolated: uid MUST be read once,
// before the function's own internal await, not re-read afterwards when
// building the write payload.
//
// Codex round 17: the internal await this section is guarding against
// changed shape — round 16 had a separate reservePassportId() transaction
// followed by a non-transactional addDoc(); round 17 replaced both with
// ONE runTransaction() call that stages the reservation and the Dog write
// together (see scripts/test-passport-uniqueness.mjs for the emulator-
// backed atomicity tests of that transaction itself). The uid-capture-
// before-await risk this section tests is unchanged in kind — a
// runTransaction() call is still a real Firestore round-trip an account
// switch could land inside — so the source-pattern checks below were
// updated to look for the new shape (creatorUid before runTransaction(),
// tx.set(dogRef, {...creatorUid...})) instead of the removed
// reservePassportId()/addDoc() pair.
// =========================================================================
{
  // Mirrors the BUGGY (pre-round-16) shape: reads uid() again after the
  // await, so a uid change during the await changes the attributed owner.
  async function createDogBuggyMirror(transactionImpl, getCurrentUid) {
    await transactionImpl()
    return { tenantId: getCurrentUid(), currentOwnerId: getCurrentUid() } // BUG: re-read after await
  }
  // Mirrors the FIXED (round-16/17) shape: uid captured once, before the await.
  async function createDogFixedMirror(transactionImpl, getCurrentUid) {
    const creatorUid = getCurrentUid()
    await transactionImpl()
    return { tenantId: creatorUid, currentOwnerId: creatorUid }
  }

  await checkAsync('BUGGY shape (for contrast): a uid switch during the transaction\'s await DOES leak into tenantId — demonstrates the bug this round fixes actually existed',
    (async () => {
      let currentUid = 'account-A'
      const result = await createDogBuggyMirror(async () => {
        await sleep(5)
        currentUid = 'account-B' // account switches mid-transaction
      }, () => currentUid)
      return result.tenantId === 'account-B' // proves the bug: dog attributed to the WRONG (later) account
    })())

  await checkAsync('FIXED shape: a uid switch during the transaction\'s await does NOT leak into tenantId — always attributed to the account that initiated the create',
    (async () => {
      let currentUid = 'account-A'
      const result = await createDogFixedMirror(async () => {
        await sleep(5)
        currentUid = 'account-B' // account switches mid-transaction
      }, () => currentUid)
      return result.tenantId === 'account-A' && result.currentOwnerId === 'account-A'
    })())

  // db.ts uses CRLF line endings — \r?\n throughout, not a bare \n.
  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  const createDogMatch = dbSrc.match(/export async function createDog\([\s\S]*?\r?\n}\r?\n/)
  const createDogBlock = createDogMatch ? createDogMatch[0] : ''
  check('createDog() source was actually located for inspection', createDogBlock.length > 0)
  check('createDog() captures uid() into creatorUid BEFORE the runTransaction() call (before its own internal await)',
    createDogBlock.indexOf('const creatorUid = uid()') > -1 &&
    createDogBlock.indexOf('const creatorUid = uid()') < createDogBlock.indexOf('await runTransaction('))
  check('createDog() uses creatorUid (not a fresh uid() call) for tenantId', /tenantId: creatorUid/.test(createDogBlock))
  check('createDog() uses creatorUid (not a fresh uid() call) for currentOwnerId', /currentOwnerId: creatorUid/.test(createDogBlock))
  check('createDog() uses creatorUid (not a fresh uid() call) for createdByUserId', /createdByUserId: creatorUid/.test(createDogBlock))
  check('createDog() no longer calls uid() again inside the Dog write payload (only the one captured value is used)',
    (() => {
      const dogSetMatch = createDogBlock.match(/tx\.set\(dogRef, \{[\s\S]*?\r?\n {8}\}\)/)
      const dogSetBlock = dogSetMatch ? dogSetMatch[0] : ''
      return dogSetBlock.length > 0 && !/uid\(\)/.test(dogSetBlock)
    })())
  check('no standalone reservePassportId() function remains — reservation + Dog write are staged in the same runTransaction() callback as createDog() itself',
    !/function reservePassportId/.test(dbSrc) &&
    /tx\.set\(reservationRef,/.test(createDogBlock) &&
    /tx\.set\(dogRef,/.test(createDogBlock))
  check('the reservation write uses creatorUid for createdBy (same captured value, not a fresh uid() read)',
    /createdBy: creatorUid/.test(createDogBlock))
}

// =========================================================================
// SECTION 5 — source-pattern checks against the REAL DogNewPage.tsx
//
// Codex round 17: the lock itself was redesigned — acquireSubmitLock() now
// returns a per-call `symbol | null` OWNERSHIP TOKEN (not a boolean), and
// releaseSubmitLock(token) only actually releases if the passed token
// still owns the lock (see the round-17 comment in DogNewPage.tsx for why:
// a rejected concurrent caller must never be able to invalidate the
// winner's beginRequest() generation by calling beginRequest() before
// losing the lock race — acquireSubmitLock() is always called strictly
// BEFORE beginRequest(), not after). Every check below was updated to
// match that token-based shape instead of the old boolean one.
// =========================================================================
{
  // DogNewPage.tsx uses CRLF line endings — \r?\n throughout, not a bare \n.
  const src = readFileSync(new URL('../src/pages/DogNewPage.tsx', import.meta.url), 'utf8')

  check('submittingRef is a useRef (synchronous), not just useState', /const submittingRef = useRef\(false\)/.test(src))
  check('lockOwnerTokenRef holds the current lock-owning token (synchronous), not just useState',
    /const lockOwnerTokenRef = useRef<symbol \| null>\(null\)/.test(src))
  check('acquireSubmitLock() checks the ref synchronously and returns null (not a boolean) when already locked',
    /function acquireSubmitLock\(\): symbol \| null \{\s*if \(submittingRef\.current \|\| committedDogIdRef\.current\) return null/.test(src))
  check('acquireSubmitLock() mints a fresh Symbol as the ownership token on each successful acquire',
    /const token = Symbol\(['"]dog-new-submit-lock['"]\)/.test(src))
  check('releaseSubmitLock(token) only releases if the passed token still owns the lock (token-specific release)',
    /function releaseSubmitLock\(token: symbol\) \{\s*if \(lockOwnerTokenRef\.current !== token\) return/.test(src))

  const handleSubmitMatch = src.match(/async function handleSubmit\(e: FormEvent\)[\s\S]*?\r?\n  \}\r?\n\r?\n  \/\/ Codex round 15: assumes/)
  const handleSubmitBlock = handleSubmitMatch ? handleSubmitMatch[0] : ''
  check('handleSubmit() was actually located for inspection (sanity check on the pattern above)', handleSubmitBlock.length > 0)
  check('handleSubmit() acquires the submit lock right after e.preventDefault() — only comments and a synchronous (no-await) UID-presence guard may sit between them (round 16: "if no authenticated UID, block creation")',
    /e\.preventDefault\(\)(?:\s*\/\/[^\n]*\r?\n|\s*if \(!user\?\.uid\)[\s\S]*?return\r?\n\s*\}\r?\n)*\s*const lockToken = acquireSubmitLock\(\)\r?\n\s*if \(!lockToken\) return/.test(handleSubmitBlock))
  check('handleSubmit() does not await anything before acquiring the submit lock',
    !/await[\s\S]*?acquireSubmitLock/.test(handleSubmitBlock.slice(0, handleSubmitBlock.indexOf('acquireSubmitLock()') + 1)))
  check('handleSubmit() acquires the lock BEFORE the duplicate check\'s getDogs() call',
    handleSubmitBlock.indexOf('const lockToken = acquireSubmitLock()') < handleSubmitBlock.indexOf('await getDogs()'))
  check('handleSubmit() captures a beginRequest() token (UID binding) right after acquiring the lock, before any await — using the literal `const req = beginRequest()` call site, not just any mention of the word',
    handleSubmitBlock.indexOf('const req = beginRequest()') > handleSubmitBlock.indexOf('const lockToken = acquireSubmitLock()') &&
    handleSubmitBlock.indexOf('const req = beginRequest()') < handleSubmitBlock.indexOf('await getDogs()'))
  check('handleSubmit() re-verifies req.isCurrent() after the duplicate check\'s await, before proceeding',
    /await getDogs\(\)[\s\S]*?if \(!req\.isCurrent\(\)\)/.test(handleSubmitBlock))
  check('every early return after acquiring the lock in handleSubmit() releases it with the SAME lockToken (never a bare releaseSubmitLock())',
    !/releaseSubmitLock\(\)/.test(handleSubmitBlock) && /releaseSubmitLock\(lockToken\)/.test(handleSubmitBlock))
  check('handleSubmit() hands the lock token through to proceedWithCreate() rather than releasing it early on the success path',
    /await proceedWithCreate\(req, lockToken\)/.test(handleSubmitBlock))

  // Locate the ACTUAL "Add anyway" button JSX (not an earlier comment
  // mentioning the same phrase) by anchoring on its onClick handler,
  // which is uniquely identified by setDuplicateWarning(null) followed
  // by proceedWithCreate().
  const addAnywayMatch = src.match(/onClick=\{\(\) => \{[\s\S]*?setDuplicateWarning\(null\)[\s\S]*?proceedWithCreate\([^)]*\)[\s\S]*?\}\}/)
  const addAnywayBlock = addAnywayMatch ? addAnywayMatch[0] : ''
  check('"Add anyway" onClick was actually located for inspection (sanity check on the pattern above)', addAnywayBlock.length > 0)
  check('"Add anyway" onClick checks for an authenticated UID before doing anything else',
    /if \(!user\?\.uid\)/.test(addAnywayBlock))
  check('"Add anyway" onClick acquires the submit lock (token-based) BEFORE a fresh beginRequest() call, then calls proceedWithCreate() with both',
    /const lockToken = acquireSubmitLock\(\)\r?\n\s*if \(!lockToken\) return\r?\n\s*const req = beginRequest\(\)[\s\S]*?proceedWithCreate\(req, lockToken\)/.test(addAnywayBlock))

  // The onClick handler body between the button's `disabled` prop and the
  // "Add anyway" label text is a large, heavily-commented block (round 17
  // added several more lines to it) — search across the button's whole
  // JSX rather than a short fixed character budget that a future comment
  // addition could push the label past again.
  const addAnywayButtonMatch = src.match(/<button\s+className="btn btn-primary"[\s\S]*?Add anyway\s*<\/button>/)
  check('"Add anyway" button is disabled while submitting OR after a Dog has already been committed (round 18)',
    !!addAnywayButtonMatch && /disabled=\{submitting \|\| dogCreated\}/.test(addAnywayButtonMatch[0]))

  // Checks for an actual bare `releaseSubmitLock()` CALL (i.e. followed by
  // a statement terminator/whitespace, not just any substring match) —
  // the header comment above legitimately mentions the function name in
  // prose without arguments, which must not count as a real violation.
  check('proceedWithCreate() releases the lock via the token-specific releaseSubmitLock(lockToken), never a bare releaseSubmitLock() call',
    !/releaseSubmitLock\(\)\s*[\r\n;]/.test(src) && /\} finally \{\s*setLoading\(false\)\r?\n\s*releaseSubmitLock\(lockToken\)/.test(src))
  check('the submit button is disabled while submitting OR after a Dog has already been committed (round 18)',
    /disabled=\{loading \|\| submitting \|\| dogCreated\}/.test(src))
}

// =========================================================================
// SECTION 6 (round 18) — the resumable-retry design is fully removed:
// no createdDogIdRef anywhere, createDog() is called unconditionally
// (never behind an "if no id yet" branch), and the terminal-commit gate
// (committedDogIdRef + dogCreated) actually exists and is wired up.
// =========================================================================
{
  const src = readFileSync(new URL('../src/pages/DogNewPage.tsx', import.meta.url), 'utf8')

  // Comments legitimately still mention "createdDogIdRef" by name when
  // explaining what round 18 replaced and why — only an actual
  // DECLARATION or USE of it would be a real regression.
  check('round 18: createdDogIdRef (the round-17 resumable-retry ref) is no longer declared or used anywhere — only mentioned in explanatory comments, if at all',
    !/const createdDogIdRef/.test(src) && !/createdDogIdRef\.current/.test(src))
  check('round 18: committedDogIdRef exists as a useRef<string | null>(null) — the terminal-commit marker',
    /const committedDogIdRef = useRef<string \| null>\(null\)/.test(src))
  check('round 18: dogCreated is a useState boolean — drives the permanently-disabled submit UI (refs alone don\'t re-render)',
    /const \[dogCreated, setDogCreated\] = useState\(false\)/.test(src))

  const proceedMatch = src.match(/async function proceedWithCreate\(req: ReturnType<typeof beginRequest>, lockToken: symbol\) \{[\s\S]*?\r?\n  \}\r?\n/)
  const proceedBlock = proceedMatch ? proceedMatch[0] : ''
  check('round 18: proceedWithCreate() was located for inspection', proceedBlock.length > 0)
  check('round 18: proceedWithCreate() calls createDog() UNCONDITIONALLY — no "if (!dogId)" resume branch of any kind',
    /const dogId = await createDog\(/.test(proceedBlock) && !/if \(!dogId\)/.test(proceedBlock))
  check('round 18: committedDogIdRef is set to the created dogId IMMEDIATELY after createDog() resolves, before any other await',
    (() => {
      const createIdx = proceedBlock.indexOf('const dogId = await createDog(')
      const commitIdx = proceedBlock.indexOf('committedDogIdRef.current = dogId')
      const nextAwaitIdx = proceedBlock.indexOf('await', createIdx + 'const dogId = await createDog('.length)
      if (createIdx === -1 || commitIdx === -1) return false
      return commitIdx > createIdx && (nextAwaitIdx === -1 || commitIdx < nextAwaitIdx)
    })())
  check('round 18: setDogCreated(true) is set alongside committedDogIdRef, right after commit',
    /committedDogIdRef\.current = dogId\r?\n\s*setDogCreated\(true\)/.test(proceedBlock))
  check('round 18: form/pendingFiles/scannedDocs are snapshotted before the try block (frozen at operation start, not read live)',
    /const formSnapshot = form\r?\n\s*const pendingFilesSnapshot = pendingFiles\r?\n\s*const scannedDocsSnapshot = scannedDocs\r?\n\s*try \{/.test(proceedBlock))
  check('round 18: createDog() is called with the SNAPSHOT, not the live form',
    /await createDog\(\{\s*\.\.\.formSnapshot/.test(proceedBlock))
  check('round 18: the upload loop iterates the SNAPSHOT, not the live pendingFiles array',
    /for \(const f of pendingFilesSnapshot\)/.test(proceedBlock) && !/for \(const f of pendingFiles\)/.test(proceedBlock))
  check('round 18: the vaccine/health loop iterates the SNAPSHOT, not the live scannedDocs array',
    /for \(const doc of scannedDocsSnapshot\)/.test(proceedBlock) && !/for \(const doc of scannedDocs\)/.test(proceedBlock))
  check('round 18: the partial-failure toast uses the required wording ("...were created, but some additional records were not saved...")',
    /were created, but some additional records were not saved/.test(proceedBlock))
  check('round 18: the partial-failure toast identifies failed categories (documents/vaccine/health) without a raw backend error',
    /failedCategories\.push/.test(proceedBlock) && /failedCategories\.join/.test(proceedBlock))
  check('round 18: the partial-failure branch and the full-success branch are mutually exclusive (if/else) — never both toasts for one outcome',
    /if \(totalFailures > 0\) \{[\s\S]*?\} else \{/.test(proceedBlock))
  check('round 18: full success still calls navigate() exactly once, after the toast',
    /toast\(`\$\{formSnapshot\.name\} added with/.test(proceedBlock) && /navigate\(`\/app\/dogs\/\$\{dogId\}`\)/.test(proceedBlock))
  check('round 18: the outer catch block\'s fallback ALSO uses committedDogIdRef (not a resumed dogId) and never claims total failure when it\'s set',
    /if \(committedDogIdRef\.current\) \{/.test(proceedBlock) && /toast\('Failed to create dog profile', 'error'\)/.test(proceedBlock))
}

await summary()
