// scripts/test-round14-fail-closed-loads.mjs — Codex round 14 coverage
// for the fail-closed getDogs() consumer audit: a getDogs() (or a
// function that internally calls getDogs()) rejection must never become
// normal empty/partial data, and must never let a safety/precondition
// check silently pass.
//
// Two kinds of coverage here:
//   A) A behavioral mirror of LittersPage's retry-loop state machine
//      (mountedRef + loadTokenRef pattern) — the trickiest of this
//      round's fixes, since it involves timers, unmount races, and
//      concurrent-retry races that are hard to assert purely from
//      source patterns. Combined with source-pattern checks against the
//      real file (Section B) so the mirror can't silently drift.
//   B) Source-pattern checks against every page fixed this round
//      (DashboardPage, AuditPage, DocumentsPage, ExportPage, LittersPage,
//      DogNewPage, RemindersPage, BuyersPage) confirming each retains a
//      persistent error state distinct from "empty", shows retry UI, and
//      — for DogNewPage's two safety checks — blocks the gated action
//      rather than allowing it through on a failed prerequisite check.
//
// Usage: node scripts/test-round14-fail-closed-loads.mjs (no emulator needed)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, summary } = makeChecker()

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

// =========================================================================
// SECTION A — behavioral mirror of LittersPage's mountedRef/loadTokenRef
// retry loop (src/pages/LittersPage.tsx startLoad()/attempt())
// =========================================================================
function makeLittersLoaderMirror({ getLitters, getDogs, delayMs = 5 }) {
  let mounted = true
  let token = 0
  let loading = false
  let loadError = false
  let litters = null
  let dogs = null
  const events = []

  function setMounted(v) { mounted = v }

  function startLoad() {
    const myToken = ++token
    loading = true
    loadError = false
    events.push({ type: 'loadingStart', token: myToken })

    async function attempt(retries) {
      try {
        const [l, d] = await Promise.all([getLitters(), getDogs()])
        if (!mounted || token !== myToken) { events.push({ type: 'staleIgnored', token: myToken }); return }
        litters = l; dogs = d; loading = false
        events.push({ type: 'success', token: myToken })
      } catch {
        if (!mounted || token !== myToken) { events.push({ type: 'staleIgnoredOnError', token: myToken }); return }
        if (retries > 0) {
          events.push({ type: 'retryScheduled', token: myToken, retries })
          await sleep(delayMs)
          if (mounted && token === myToken) await attempt(retries - 1)
        } else {
          loadError = true
          loading = false
          events.push({ type: 'exhausted', token: myToken })
        }
      }
    }

    return (async () => {
      await sleep(delayMs)
      if (mounted && token === myToken) await attempt(3)
    })()
  }

  return {
    startLoad,
    setMounted,
    getState: () => ({ loading, loadError, litters, dogs }),
    events,
  }
}

// A1 — success on first try
await checkAsync('LittersPage retry mirror: success on first attempt sets litters/dogs, clears loading, no error',
  (async () => {
    const loader = makeLittersLoaderMirror({
      getLitters: async () => ['litter-1'],
      getDogs: async () => ['dog-1'],
    })
    await loader.startLoad()
    const s = loader.getState()
    return s.loading === false && s.loadError === false && s.litters?.length === 1 && s.dogs?.length === 1
  })())

// A2 — fails twice, succeeds on the 3rd attempt (within the 3-retry budget)
await checkAsync('LittersPage retry mirror: recovers after transient failures, without ever exposing loadError',
  (async () => {
    let calls = 0
    const loader = makeLittersLoaderMirror({
      getLitters: async () => { calls++; if (calls <= 2) throw new Error('transient'); return ['litter-1'] },
      getDogs: async () => ['dog-1'],
    })
    await loader.startLoad()
    const s = loader.getState()
    return s.loading === false && s.loadError === false && s.litters?.length === 1
  })())

// A3 — loading is NEVER cleared while a retry is still scheduled (the
// core round-14 bug: a premature `finally { setLoading(false) }` would
// briefly render litters=[] as if genuinely empty between retries)
await checkAsync('LittersPage retry mirror: loading stays true across every intermediate retry attempt, never toggled off early',
  (async () => {
    let calls = 0
    const loader = makeLittersLoaderMirror({
      getLitters: async () => { calls++; if (calls <= 2) throw new Error('transient'); return ['litter-1'] },
      getDogs: async () => ['dog-1'],
    })
    const promise = loader.startLoad()
    // Poll state while retries are still in flight — loading must stay true.
    let sawLoadingFalseEarly = false
    const pollInterval = setInterval(() => {
      if (loader.getState().loading === false && calls < 3) sawLoadingFalseEarly = true
    }, 1)
    await promise
    clearInterval(pollInterval)
    return !sawLoadingFalseEarly
  })())

// A4 — all attempts exhausted: persistent loadError, loading cleared, no
// silent empty-array fallback
await checkAsync('LittersPage retry mirror: after all retries exhaust, loadError is persistently true and loading is cleared',
  (async () => {
    const loader = makeLittersLoaderMirror({
      getLitters: async () => { throw new Error('permanent') },
      getDogs: async () => ['dog-1'],
    })
    await loader.startLoad()
    const s = loader.getState()
    return s.loading === false && s.loadError === true && s.litters === null
  })())

// A5 — unmount during a scheduled retry: no state update happens after
// unmount, even once the in-flight retry eventually resolves/rejects
await checkAsync('LittersPage retry mirror: unmounting during a pending retry prevents any further state update',
  (async () => {
    const loader = makeLittersLoaderMirror({
      getLitters: async () => { throw new Error('permanent') },
      getDogs: async () => ['dog-1'],
    })
    const promise = loader.startLoad()
    await sleep(8) // let the first attempt fail and schedule a retry
    loader.setMounted(false)
    const stateAtUnmount = loader.getState()
    await promise // let all remaining retries play out
    const stateAfter = loader.getState()
    return stateAfter.loading === stateAtUnmount.loading &&
      stateAfter.loadError === stateAtUnmount.loadError &&
      stateAfter.litters === stateAtUnmount.litters
  })())

// A6 — concurrent retry clicks: starting a second load supersedes the
// first via the token; the first's late resolution must never overwrite
// the second's (fresher) result, regardless of which one's network call
// actually resolves last
await checkAsync('LittersPage retry mirror: a newer startLoad() call wins over a stale in-flight one, even if the older call\'s network response arrives later',
  (async () => {
    let call = 0
    const loader = makeLittersLoaderMirror({
      getLitters: async () => {
        call++
        if (call === 1) {
          // The FIRST call (e.g. the initial page-load attempt) is slow
          // and would resolve with stale data well after a manual Retry
          // click has already started a second, fresher load.
          await sleep(30)
          return ['stale-litter']
        }
        return ['fresh-litter']
      },
      getDogs: async () => ['dog-1'],
      delayMs: 5,
    })
    const firstPromise = loader.startLoad() // token=1
    await sleep(9) // let the first attempt's getLitters() call begin (past the initial 5ms startLoad delay)
    const secondPromise = loader.startLoad() // token=2 — supersedes token=1
    await Promise.all([firstPromise, secondPromise])
    const s = loader.getState()
    const staleEvents = loader.events.filter(e => e.type === 'staleIgnored' || e.type === 'staleIgnoredOnError')
    return s.litters?.[0] === 'fresh-litter' && s.loading === false && staleEvents.length > 0
  })())

// =========================================================================
// SECTION B — source-pattern checks against every page fixed this round
// =========================================================================
function src(relPath) {
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')
}

// B1 — DashboardPage: per-source Promise.allSettled, never a blanket
// .catch(() => []) around a function that itself calls getDogs()
// internally (getAllPendingReminders, getAllDocumentsForUser)
{
  const s = src('src/pages/DashboardPage.tsx')
  check('DashboardPage uses Promise.allSettled (per-source error tracking), not a single Promise.all that fails the whole dashboard on one bad source',
    /Promise\.allSettled\(\[/.test(s))
  check('DashboardPage no longer wraps getAllPendingReminders() in .catch(() => [])',
    !/getAllPendingReminders\(\)\.catch\(\(\) => \[\]/.test(s))
  check('DashboardPage no longer wraps getAllDocumentsForUser(...) in .catch(() => [])',
    !/getAllDocumentsForUser\([^)]*\)\.catch\(\(\) => \[\]/.test(s))
  check('DashboardPage tracks distinct per-source error flags (dogsError, remindersError, littersError, documentsError, activityError)',
    ['dogsError', 'remindersError', 'littersError', 'documentsError', 'activityError'].every(f => s.includes(f)))
  check('DashboardPage renders a distinct LoadErrorState for a failed section, not a numeric 0',
    /LoadErrorState/.test(s))
  check('DashboardPage litters panel stays visible on a litters load failure (littersError), not hidden by the litters.length > 0 empty-state gate',
    /littersError/.test(s) && /litters\.length > 0 \|\| littersError/.test(s))
}

// B2 — AuditPage: persistent loadError, retry button, no "No activity yet" on failure
{
  const s = src('src/pages/AuditPage.tsx')
  check('AuditPage tracks a distinct loadError state', /const \[loadError, setLoadError\] = useState/.test(s))
  check('AuditPage renders a load-failure state before falling through to the empty-state branch',
    /loadError \? \(/.test(s))
  check('AuditPage\'s failure branch never shows "No activity yet" — that copy stays confined to the genuinely-empty branch',
    (() => {
      const failureBlockMatch = s.match(/\{loadError \? \([\s\S]*?\) : filtered\.length === 0 \? \(/)
      return !!failureBlockMatch && !failureBlockMatch[0].includes('No activity yet')
    })())
  check('AuditPage\'s failure state has a Retry button wired to reload',
    /onClick=\{loadAudit\}/.test(s))
}

// B3 — DocumentsPage: same pattern
{
  const s = src('src/pages/DocumentsPage.tsx')
  check('DocumentsPage tracks a distinct loadError state', /const \[loadError, setLoadError\] = useState/.test(s))
  check('DocumentsPage renders a load-failure state distinct from "No documents yet"',
    /loadError \? \(/.test(s) && /Couldn.t load your documents/.test(s))
  check('DocumentsPage\'s failure state has a retry affordance', /loadDocuments/.test(s))
}

// B4 — ExportPage: export blocked on load failure, not just an empty report
{
  const s = src('src/pages/ExportPage.tsx')
  check('ExportPage tracks a distinct loadError state', /const \[loadError, setLoadError\] = useState/.test(s))
  check('ExportPage\'s handleExport() bails out early when loadError is true, before any export proceeds',
    /function handleExport[\s\S]{0,400}loadError/.test(s))
  check('ExportPage disables the export action(s) while loadError is true',
    /disabled=\{[^}]*loadError/.test(s))
}

// B5 — LittersPage: persistent post-exhaustion error UI + the safe delete-refresh fix
{
  const s = src('src/pages/LittersPage.tsx')
  check('LittersPage uses a mountedRef to guard against post-unmount state updates', /mountedRef/.test(s))
  check('LittersPage uses a loadTokenRef to invalidate stale/superseded retry attempts', /loadTokenRef/.test(s))
  check('LittersPage tracks a persistent loadError state, checked before the loading gate falls through to the main view',
    /const \[loadError, setLoadError\] = useState/.test(s) && /if \(loadError\) \{/.test(s))
  check('LittersPage\'s loading is not cleared inside the retry-scheduling branch (only on the two terminal outcomes)',
    (() => {
      const retryBranchMatch = s.match(/if \(retries > 0\) \{[\s\S]*?\} else \{\s*setLoadError\(true\)/)
      const retryBranch = retryBranchMatch ? retryBranchMatch[0] : ''
      // Strip comments first — the branch deliberately contains an
      // explanatory comment whose TEXT mentions "setLoading(false)" as
      // prose, which must not be mistaken for an actual call.
      const withoutComments = retryBranch.replace(/\/\/[^\n]*\n/g, '')
      return retryBranch.length > 0 && !/setLoading\(false\)/.test(withoutComments)
    })())
  check('LittersPage\'s handleDeleteLitter refresh call is wrapped in try/catch (previously an uncaught-rejection risk after a successful delete)',
    /handleDeleteLitter[\s\S]{0,50}\{[\s\S]*?try \{[\s\S]*?getLitters\(\), getDogs\(\)[\s\S]*?\} catch/.test(s))
}

// B6 — DogNewPage: both safety/precondition checks fail CLOSED
{
  const s = src('src/pages/DogNewPage.tsx')
  check('DogNewPage tracks a distinct limitCheckError state for the subscription-limit check',
    /const \[limitCheckError, setLimitCheckError\] = useState/.test(s))
  check('DogNewPage no longer has a bare "allow through if check fails" fail-open comment for the limit check',
    !/allow through if check fails/.test(s))
  check('DogNewPage blocks dog creation (renders a retryable error, not the create form) when the limit check itself fails',
    /if \(limitCheckError\)/.test(s) && /Couldn.t check your plan limit/.test(s))
  check('DogNewPage\'s limit-check failure state has a Retry action wired back to checkLimit',
    /onClick=\{checkLimit\}/.test(s))
  const submitMatch = s.match(/async function handleSubmit\(e: FormEvent\)[\s\S]*?\n  \}\r?\n/)
  const submitBlock = submitMatch ? submitMatch[0] : ''
  check('DogNewPage\'s handleSubmit() was actually located for inspection (sanity check on the pattern above)', submitBlock.length > 0)
  check('DogNewPage\'s duplicate-check catch block no longer proceeds to creation on failure ("proceed as normal" comment removed)',
    !/proceed as normal/.test(submitBlock))
  check('DogNewPage\'s duplicate-check catch block returns (blocks submission) instead of falling through to proceedWithCreate()',
    /\} catch \{[\s\S]*?return\r?\n    \}\r?\n\r?\n(?:\s*\/\/[^\n]*\n)*\s*await proceedWithCreate\([^)]*\)/.test(submitBlock))
}

// B7 — RemindersPage / BuyersPage: retry affordance added this round
{
  const s = src('src/pages/RemindersPage.tsx')
  check('RemindersPage\'s load-failure state has an explicit Retry button (not just static "refresh the page" copy)',
    /onClick=\{loadData\}/.test(s))
}
{
  const s = src('src/pages/BuyersPage.tsx')
  check('BuyersPage\'s load-failure state has an explicit Retry button', /onClick=\{\(\) => setReloadToken/.test(s))
}

await summary()
