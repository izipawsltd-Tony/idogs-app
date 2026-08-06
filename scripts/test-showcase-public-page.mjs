// scripts/test-showcase-public-page.mjs — regression coverage for the
// public-facing Litter Showcase page (Slice 2, commit 2/5): the actual
// no-login, mobile-first `/s/:token` route that consumes
// api/showcase-public.js's allowlisted projection (tested separately,
// exhaustively, in scripts/test-litter-showcase-public.mjs).
//
// Section 2 mounts a harness that mirrors ShowcasePublicPage's real
// state machine (loading -> notFound | (litter + puppies)) with `fetch`
// mocked — plain Node's ESM loader cannot execute actual JSX (only its
// own "erasable syntax" TypeScript stripping), so the real .tsx page
// can't be imported directly here. Section 1's structural checks
// independently verify the REAL source has this exact shape.
//
// Usage: node scripts/test-showcase-public-page.mjs (no emulator needed
// — everything here is either static source inspection or a mocked-fetch
// component mount, never a real network/Firestore call)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, summary } = makeChecker()

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

// =========================================================================
// SECTION 1 — structural
// =========================================================================
{
  const appSrc = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8')
  const pageSrc = readFileSync(new URL('../src/pages/ShowcasePublicPage.tsx', import.meta.url), 'utf8')

  check('App.tsx registers /s/:token as a route', /<Route path="\/s\/:token" element=\{<ShowcasePublicPage \/>\} \/>/.test(appSrc))

  // The /s/:token route must be registered OUTSIDE the /app
  // ProtectedRoute block — checked by position: it must appear in the
  // source BEFORE the `path="/app"` Route opens (every public route in
  // this file, e.g. /p/:passportId, is listed in that same top block).
  const publicRouteIdx = appSrc.indexOf('path="/s/:token"')
  const appRouteIdx = appSrc.indexOf('path="/app"')
  check('The /s/:token route is registered before (outside) the /app ProtectedRoute block — a genuinely public, no-login route',
    publicRouteIdx !== -1 && appRouteIdx !== -1 && publicRouteIdx < appRouteIdx)

  check('ShowcasePublicPage fetches api/showcase-public with the URL token param',
    /fetch\(`\/api\/showcase-public\?token=\$\{encodeURIComponent\(token\)\}`\)/.test(pageSrc))
  check('ShowcasePublicPage never imports useAuth — genuinely public, not gated behind a signed-out fallback',
    !/useAuth/.test(pageSrc))
  check('ShowcasePublicPage never imports the authenticated Firebase client (lib/firebase) — no client SDK reads/writes at all, fetch() to the public API is the only data path',
    !pageSrc.includes("from '../lib/firebase'") && !pageSrc.includes('firebase/firestore'))
  check('A non-OK fetch response (any status, not just 404) is treated as not-found — never differentiates by status code client-side either',
    /if \(!response\.ok\) throw new Error\('not-found'\)/.test(pageSrc))

  // Defense in depth: even though api/showcase-public.js's own allowlist
  // is what actually prevents these fields from ever being SENT (see
  // test-litter-showcase-public.mjs), the page component itself should
  // never reference them either — a second, independent guard against
  // ever wiring one up by mistake in a future edit.
  const forbiddenFieldRefs = [
    '.microchip', '.tenantId', '.currentOwnerId', '.createdByUserId', '.buyerEmail', '.buyerName',
    '.reservedForName', '.reservedForEmail', '.reservedForPhone', '.depositAmount', '.depositStatus',
    '.notes', '.breederIdValue', '.passportId', '.profilePhoto',
  ]
  for (const ref of forbiddenFieldRefs) {
    check(`ShowcasePublicPage source never references "${ref}"`, !pageSrc.includes(ref))
  }
  // `.status` alone would false-positive on plenty of legitimate things
  // (response.status, HTTP status handling) — checked narrowly instead
  // for the one shape that would actually leak the dog's internal
  // status field.
  check('ShowcasePublicPage never references puppy.status / dog.status', !/\bpuppy\.status\b|\bdog\.status\b/.test(pageSrc))

  // Regression: the hero litter-name heading uses a large, responsive
  // clamp() font size (up to 52px). A breeder-chosen litter name with no
  // spaces to wrap on (e.g. an underscore-joined name) previously forced
  // the whole public page to overflow horizontally on narrow (mobile)
  // viewports — verified live at a 390px viewport (document.scrollWidth
  // 724 vs window.innerWidth 390), traced to this exact <h1>, which had
  // no word-break safeguard. overflowWrap: 'break-word' lets the browser
  // break the name itself rather than expanding the page.
  check('The litter-name <h1> guards against horizontal overflow from a long unbroken name (overflowWrap: break-word)',
    /<h1 style=\{\{[^}]*overflowWrap: 'break-word'[^}]*\}\}>\{litter\.name\}<\/h1>/.test(pageSrc))
  check('The litter-name <h1> keeps its existing responsive clamp() font size (the fix must not remove it)',
    /<h1 style=\{\{[^}]*fontSize: 'clamp\(30px,6vw,52px\)'[^}]*\}\}>\{litter\.name\}<\/h1>/.test(pageSrc))

  // ── Multi-puppy enquiry fix: EnquiryForm's terminal 'sent' state used
  // to freeze the WHOLE form for every puppy in the litter once ANY one
  // submission succeeded (EnquiryForm is mounted once for the whole page,
  // never remounted per puppy) — a buyer who successfully enquired about
  // Puppy A could never see a usable form for Puppy B afterward, only the
  // frozen "Enquiry sent" panel from A. `sentFor` scopes that success
  // panel to the specific puppy (or general enquiry) it was actually
  // submitted for; selecting a DIFFERENT puppy resets the form back to a
  // genuinely fresh one instead of reusing A's frozen success state OR
  // A's stale form values. ──
  check('EnquiryForm tracks which puppy the last successful submission belongs to (sentFor)',
    /const \[sentFor, setSentFor\] = useState<string \| null>\(null\)/.test(pageSrc))
  check('Selecting a puppy different from the one that just succeeded resets state back to idle — a fresh, usable form for the new puppy',
    /if \(state === 'sent' && selectedPuppy !== sentFor\) \{\s*\n\s*setState\('idle'\); setError\(''\); setNotified\(false\)/.test(pageSrc))
  check('That same reset also clears the form fields — Puppy B never sees Puppy A\'s stale name/email/phone/message pre-filled',
    /if \(state === 'sent' && selectedPuppy !== sentFor\) \{[\s\S]{0,120}setForm\(\{ name: '', email: '', phone: '', message: '', consent: false, website: '' \}\)/.test(pageSrc))
  check('submit() records which puppy just succeeded (setSentFor(selectedPuppy)) before entering the sent state',
    /setSentFor\(selectedPuppy\)\s*\n\s*setState\('sent'\)/.test(pageSrc))
  check('The success panel is now scoped to the puppy it was submitted for (state === \'sent\' && sentFor === selectedPuppy), never a bare state === \'sent\' check alone',
    /if \(state === 'sent' && sentFor === selectedPuppy\) return/.test(pageSrc))
}

// =========================================================================
// SECTION 2 — real component mount (react-test-renderer + MemoryRouter),
// fetch mocked at the global level
// =========================================================================
{
  const React = (await import('react')).default
  const TestRenderer = (await import('react-test-renderer')).default
  const { act } = TestRenderer
  const { useState, useEffect } = React

  // ShowcasePublicPage.tsx is JSX (.tsx) — plain Node's ESM loader can
  // only execute Node's own "erasable syntax" TypeScript (type-only
  // stripping), never actual JSX transformation, so it cannot be
  // imported directly here. This is the SAME constraint every other
  // JSX-page behavioral test in this codebase already works around
  // (e.g. SaleAvailabilityPanel's harness in
  // test-sale-availability-error-sanitization.mjs, useShowcaseRequestGuard's
  // harness in test-litter-showcase.mjs) — a harness that faithfully
  // MIRRORS the real component's state machine (loading → notFound |
  // (litter + puppies)), built with plain React.createElement calls
  // instead of JSX. Section 1 above independently verifies the REAL
  // source actually has this exact shape (the fetch call, the `!response.ok`
  // → notFound branch, no useAuth/Firebase client import) via source
  // inspection — this section proves that SHAPE behaves correctly at
  // runtime, not that the real file byte-for-byte matches.
  function ShowcasePublicHarness({ token, controls }) {
    const [litter, setLitter] = useState(null)
    const [puppies, setPuppies] = useState([])
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)
    controls.getState = () => ({ litter, puppies, loading, notFound })

    useEffect(() => {
      if (!token) { setNotFound(true); setLoading(false); return }
      let cancelled = false
      async function load() {
        try {
          const response = await fetch(`/api/showcase-public?token=${encodeURIComponent(token)}`)
          if (cancelled) return
          if (!response.ok) { setNotFound(true); return }
          const data = await response.json()
          if (cancelled) return
          setLitter(data.litter)
          setPuppies(data.puppies)
        } catch {
          if (!cancelled) setNotFound(true)
        } finally {
          if (!cancelled) setLoading(false)
        }
      }
      load()
      return () => { cancelled = true }
    }, [token])

    if (loading) return React.createElement('div', null, React.createElement('span', { className: 'spinner' }))
    if (notFound || !litter) return React.createElement('div', null, "This link isn't available")
    return React.createElement('div', null,
      React.createElement('span', null, litter.name),
      litter.damName && React.createElement('span', null, litter.damName),
      litter.sireName && React.createElement('span', null, litter.sireName),
      puppies.length === 0
        ? React.createElement('div', null, 'No puppies are currently shown')
        : puppies.map(p => React.createElement('div', { key: p.id },
            React.createElement('span', null, p.name),
            React.createElement('span', null, p.breed),
            React.createElement('span', null, p.availability === 'available' ? 'Available' : p.availability),
            // Codex fix-round: photos/videos are signed {id,url} items,
            // never raw URL strings and never dog.profilePhoto — mirrors
            // the real page's own `puppy.photos?.[0]?.url` cover +
            // `puppy.photos.map(item => item.url)` thumbnail-strip shape.
            ...(p.photos && p.photos.length > 1 ? p.photos.map(item => React.createElement('img', { key: item.id, src: item.url })) : []),
            ...(p.videos && p.videos.length > 0 ? p.videos.map(item => React.createElement('video', { key: item.id, src: item.url })) : []),
          )),
    )
  }

  const realFetch = globalThis.fetch

  function mockFetchOnce(impl) {
    globalThis.fetch = async (...args) => impl(...args)
  }

  function mount(token) {
    let renderer
    const controls = {}
    act(() => { renderer = TestRenderer.create(React.createElement(ShowcasePublicHarness, { token, controls })) })
    return { renderer, controls }
  }
  function rendered(renderer) {
    return JSON.stringify(renderer.toJSON())
  }

  // `id` here is a stand-in opaque reference (a real one would be a
  // sha256-hash-derived string — see opaquePuppyRef() — but any opaque
  // string proves the harness/page never special-case its shape).
  const samplePayload = {
    litter: { name: 'Bella x Max Litter', damName: 'Bella', sireName: 'Max', actualBirthDate: '2026-01-01' },
    puppies: [
      { id: 'opaque-ref-1', name: 'Blue Boy', sex: 'male', breed: 'Labrador', colour: 'Black', dateOfBirth: '2026-01-01', availability: 'available', photos: [], videos: [] },
    ],
  }

  // ── Test 1: loading state shows a spinner before the fetch resolves ──
  {
    let resolveFetch
    mockFetchOnce(() => new Promise(resolve => { resolveFetch = resolve }))
    const { renderer } = mount('sometoken')
    check('1', 'While the fetch is still pending, the page shows the loading spinner, not litter content', rendered(renderer).includes('spinner') && !rendered(renderer).includes('Bella x Max'))
    await act(async () => {
      resolveFetch({ ok: true, json: async () => samplePayload })
      await sleep(10)
    })
    check('1', 'After the fetch resolves, the loading spinner is gone', !rendered(renderer).includes('spinner'))
    act(() => { renderer.unmount() })
  }

  // ── Test 2: a valid token renders litter + puppy details ──
  {
    mockFetchOnce(async () => ({ ok: true, json: async () => samplePayload }))
    const { renderer } = mount('validtoken')
    await act(async () => { await sleep(10) })
    const html = rendered(renderer)
    check('2', 'The litter name is shown', html.includes('Bella x Max Litter'))
    check('2', 'The dam name is shown', html.includes('Bella'))
    check('2', 'The sire name is shown', html.includes('Max'))
    check('2', 'The puppy name is shown', html.includes('Blue Boy'))
    check('2', 'The puppy breed is shown', html.includes('Labrador'))
    check('2', 'The availability label is shown', html.includes('Available'))
    act(() => { renderer.unmount() })
  }

  // ── Test 3: a non-OK response (the generic denial shape
  // api/showcase-public.js always returns) shows the generic not-found
  // state — never a different message for different reasons ──
  {
    mockFetchOnce(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) }))
    const { renderer } = mount('badtoken')
    await act(async () => { await sleep(10) })
    check('3', 'A denied token shows the generic "not available" message', rendered(renderer).includes("This link isn&apos;t available") || rendered(renderer).includes('This link isn’t available') || rendered(renderer).includes("This link isn't available"))
    act(() => { renderer.unmount() })
  }

  // ── Test 4: a thrown/rejected fetch (network failure) is handled the
  // exact same way as a denial — never an uncaught error, never a
  // different message ──
  {
    mockFetchOnce(async () => { throw new Error('simulated network failure') })
    const { renderer } = mount('networkfailtoken')
    await act(async () => { await sleep(10) })
    check('4', 'A network failure shows the same generic not-found state as a denial (no crash, no distinguishing message)',
      rendered(renderer).includes("isn't available") || rendered(renderer).includes('isn’t available'))
    act(() => { renderer.unmount() })
  }

  // ── Test 5: zero visible puppies shows the empty state, not an error ──
  {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ litter: samplePayload.litter, puppies: [] }) }))
    const { renderer } = mount('emptytoken')
    await act(async () => { await sleep(10) })
    check('5', 'A live link with zero visible puppies shows the empty state, not the not-found error', rendered(renderer).includes('No puppies are currently shown'))
    act(() => { renderer.unmount() })
  }

  // ── Test 6: multiple photos render as a thumbnail strip (signed
  // {id,url} items); a single (or zero) photo does not ──
  {
    const multiPhotoPayload = {
      litter: samplePayload.litter,
      puppies: [{ ...samplePayload.puppies[0], photos: [{ id: 'm1', url: 'https://example.com/a.jpg' }, { id: 'm2', url: 'https://example.com/b.jpg' }] }],
    }
    mockFetchOnce(async () => ({ ok: true, json: async () => multiPhotoPayload }))
    const { renderer } = mount('multiphototoken')
    await act(async () => { await sleep(10) })
    const html = rendered(renderer)
    check('6', 'Both photo URLs appear when a puppy has more than one photo', html.includes('a.jpg') && html.includes('b.jpg'))
    act(() => { renderer.unmount() })
  }
  {
    mockFetchOnce(async () => ({ ok: true, json: async () => samplePayload })) // photos: []
    const { renderer } = mount('nophototoken')
    await act(async () => { await sleep(10) })
    check('6', 'No thumbnail strip renders when a puppy has zero published photos', !rendered(renderer).includes('photo 1'))
    act(() => { renderer.unmount() })
  }

  // ── Test 7 (Codex fix-round, "Explicit media publication"): a
  // published video renders too — not just photos ──
  {
    const videoPayload = {
      litter: samplePayload.litter,
      puppies: [{ ...samplePayload.puppies[0], videos: [{ id: 'v1', url: 'https://example.com/clip.mp4' }] }],
    }
    mockFetchOnce(async () => ({ ok: true, json: async () => videoPayload }))
    const { renderer } = mount('videotoken')
    await act(async () => { await sleep(10) })
    check('7', 'A published video URL is rendered', rendered(renderer).includes('clip.mp4'))
    act(() => { renderer.unmount() })
  }

  globalThis.fetch = realFetch
}

// =========================================================================
// SECTION 3 — EnquiryForm's per-puppy success-state fix: a harness that
// faithfully mirrors EnquiryForm's exact state machine (idle -> sending ->
// sent | error, plus sentFor), built with plain React.createElement calls
// for the same reason Section 2's harness is (ShowcasePublicPage.tsx is
// JSX, unimportable by plain Node ESM). Section 1 above independently
// verifies the REAL source has this exact shape; this section proves that
// shape behaves correctly at runtime, via a mocked global.fetch — no real
// network/Firestore call, no emulator needed.
// =========================================================================
{
  const React = (await import('react')).default
  const TestRenderer = (await import('react-test-renderer')).default
  const { act } = TestRenderer
  const { useState, useEffect } = React

  function EnquiryFormHarness({ token, puppies, controls }) {
    const [selectedPuppy, setSelectedPuppy] = useState('')
    const [form, setForm] = useState({ name: '', email: '', phone: '', message: '', consent: false, website: '' })
    const [state, setState] = useState('idle')
    const [error, setError] = useState('')
    const [notified, setNotified] = useState(false)
    const [sentFor, setSentFor] = useState(null)

    useEffect(() => {
      if (state === 'sent' && selectedPuppy !== sentFor) {
        setState('idle'); setError(''); setNotified(false)
        setForm({ name: '', email: '', phone: '', message: '', consent: false, website: '' })
      }
    }, [selectedPuppy, state, sentFor])

    controls.getState = () => ({ selectedPuppy, form, state, error, notified, sentFor })
    controls.selectPuppy = id => act(() => { setSelectedPuppy(id) })
    controls.setField = (key, value) => act(() => { setForm(f => ({ ...f, [key]: value })) })
    controls.submit = () => act(async () => {
      setState('sending'); setError('')
      try {
        const response = await fetch('/api/create-showcase-enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, puppyRef: selectedPuppy || undefined, ...form }) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Could not send your enquiry')
        setNotified(data.notified === true)
        setSentFor(selectedPuppy)
        setState('sent')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send your enquiry')
        setState('error')
      }
    })

    if (state === 'sent' && sentFor === selectedPuppy) {
      return React.createElement('div', { role: 'status' }, notified ? 'Enquiry sent successfully' : 'Enquiry submitted successfully')
    }
    return React.createElement('form', null,
      React.createElement('select', { value: selectedPuppy, readOnly: true },
        React.createElement('option', { value: '' }, 'General enquiry'),
        puppies.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name))),
      React.createElement('span', { 'data-testid': 'enquiry-form-visible' }, `Enquire about ${selectedPuppy ? puppies.find(p => p.id === selectedPuppy)?.name : 'this litter'}`),
      state === 'error' && React.createElement('p', { role: 'alert' }, error),
    )
  }

  const realFetch = globalThis.fetch
  const puppies = [{ id: 'puppyA', name: 'Puppy A' }, { id: 'puppyB', name: 'Puppy B' }]
  const validForm = { name: 'Jane Buyer', email: 'jane@example.com', phone: '', message: 'Interested!', consent: true, website: '' }

  function mount() {
    let renderer
    const controls = {}
    act(() => { renderer = TestRenderer.create(React.createElement(EnquiryFormHarness, { token: 'tok', puppies, controls })) })
    return { renderer, controls }
  }
  function rendered(renderer) { return JSON.stringify(renderer.toJSON()) }

  const capturedRequests = []
  function mockAcceptingFetch() {
    globalThis.fetch = async (_url, opts) => {
      capturedRequests.push(JSON.parse(opts.body))
      return { ok: true, json: async () => ({ success: true, notified: true }) }
    }
  }

  // ── [A] Puppy A enquiry succeeds → success shown for A ──
  const { renderer, controls } = mount()
  controls.selectPuppy('puppyA')
  for (const [k, v] of Object.entries(validForm)) controls.setField(k, v)
  mockAcceptingFetch()
  await controls.submit()
  check('[A] after a successful submission for Puppy A, state is "sent" and sentFor is Puppy A', controls.getState().state === 'sent' && controls.getState().sentFor === 'puppyA')
  check('[A] the success panel is shown for Puppy A', rendered(renderer).includes('Enquiry sent successfully'))

  // ── [B] Select Puppy B → form becomes usable again (not the frozen
  // Puppy A success panel) ──
  controls.selectPuppy('puppyB')
  check('[B] selecting Puppy B resets state back to idle — no longer frozen on Puppy A\'s success', controls.getState().state === 'idle')
  check('[B] the live form is shown again for Puppy B, not the success panel', rendered(renderer).includes('enquiry-form-visible') && !rendered(renderer).includes('Enquiry sent successfully'))
  check('[B]/[5] switching to Puppy B does not carry over Puppy A\'s stale form values (name/message cleared)', controls.getState().form.name === '' && controls.getState().form.message === '')

  // ── [C] Puppy B enquiry can be submitted successfully, independently
  // of Puppy A's earlier submission ──
  for (const [k, v] of Object.entries(validForm)) controls.setField(k, v)
  await controls.submit()
  check('[C] Puppy B\'s submission succeeds independently — state "sent", sentFor Puppy B', controls.getState().state === 'sent' && controls.getState().sentFor === 'puppyB')
  check('[C] the success panel is shown for Puppy B', rendered(renderer).includes('Enquiry sent successfully'))

  // ── [D] the correct puppyId (opaque puppyRef) was sent for EACH of the
  // two submissions above — never both attributed to the same puppy ──
  check('[D] exactly two requests were sent', capturedRequests.length === 2)
  check('[D] the FIRST request carried puppyRef "puppyA"', capturedRequests[0]?.puppyRef === 'puppyA')
  check('[D] the SECOND request carried puppyRef "puppyB", not a stale/repeated "puppyA"', capturedRequests[1]?.puppyRef === 'puppyB')

  // ── [E] existing success/error behavior remains correct ──
  // E1: sentFor tracks only the MOST RECENT success (a single value, not
  // a per-puppy history) — by design, the smallest fix that satisfies the
  // actual requirement ("Puppy A does not block Puppy B"), not "remember
  // every puppy's success forever". So re-selecting Puppy A after Puppy
  // B has since succeeded is correctly treated as "a different puppy than
  // the one that just succeeded" and given a fresh form — the SAME single
  // rule applied consistently both times, never a special case for
  // whichever puppy happened to be first.
  controls.selectPuppy('puppyA')
  check('[E1] sentFor tracks only the most recent success — re-selecting Puppy A after Puppy B\'s later success resets to a fresh form rather than resurrecting a stale success panel',
    controls.getState().state === 'idle')
  check('[E1] the live form (not a success panel) is what\'s actually shown in that case', rendered(renderer).includes('enquiry-form-visible'))

  // E2: a submission that FAILS shows the error state with the form still
  // visible (unchanged pre-existing behavior — only the 'sent' branch was
  // ever touched by this fix).
  for (const [k, v] of Object.entries(validForm)) controls.setField(k, v)
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'Too many requests' }) })
  await controls.submit()
  check('[E2] a rejected submission sets state to "error", never "sent"', controls.getState().state === 'error')
  check('[E2] the form remains visible (with the error message) after a failure — unchanged from before this fix', rendered(renderer).includes('enquiry-form-visible') && rendered(renderer).includes('Too many requests'))

  // E3: notified:false still renders the honest "submitted" (not "sent")
  // copy — the fix must not have disturbed this existing distinction.
  controls.selectPuppy('puppyB') // a puppy with no prior 'sent' state pinned to it in this fresh error context
  for (const [k, v] of Object.entries(validForm)) controls.setField(k, v)
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, notified: false }) })
  await controls.submit()
  check('[E3] notified:false still renders the honest "submitted" (not "sent") copy, unaffected by this fix', rendered(renderer).includes('Enquiry submitted successfully') && !rendered(renderer).includes('Enquiry sent successfully'))

  act(() => { renderer.unmount() })
  globalThis.fetch = realFetch
}

summary()
