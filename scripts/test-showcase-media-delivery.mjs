// scripts/test-showcase-media-delivery.mjs — regression coverage for
// server-mediated public Showcase media delivery (Codex re-review: "the
// one remaining blocker" from the prior fix-round).
//
// WHAT CHANGED AND WHY: api/showcase-public.js used to embed a
// 15-minute Google Cloud Storage signed URL directly in its JSON
// response (tested in scripts/test-litter-showcase-public.mjs's own
// Tests 13-15). Once issued, that URL kept working for its full 15
// minutes regardless of anything the breeder did afterward — Codex
// flagged that disabling/rotating/expiring the Showcase, unpublishing
// media, hiding the puppy, or the tenant losing Plus eligibility could
// never reach a URL that had already been handed to a browser.
//
// api/showcase-public.js now never mints a Storage URL at all — every
// photo/video it lists is a link to the NEW api/showcase-media.js
// (this file's real subject), which independently re-runs the ENTIRE
// authorization chain from scratch on every single request before ever
// minting a short-lived (60-second) signed URL. This file proves the
// actual guarantee end to end: for each of the six revocation triggers
// Codex named (disable, rotate, expiry, unpublish, hide, downgrade), an
// ALREADY-ISSUED media reference — captured from a real public API
// response, not synthesized — stops working on the very next request
// after that trigger fires.
//
// WHAT THIS DOES NOT CLAIM: an already-issued 60-second redirect TARGET
// (the actual signed Storage URL a browser was mid-flight to at the
// exact instant of revocation) cannot be retroactively killed — it
// keeps working for the remainder of its own brief TTL, same as any
// bearer credential already handed out. This file tests the property
// that IS true: the NEXT request to api/showcase-media.js is denied
// immediately, in every one of the six cases. See api/showcase-
// media.js's own header comment for the full reasoning.
//
// Usage: node scripts/test-showcase-media-delivery.mjs
//   Section 1 (structural) always runs.
//   Section 2 (emulator end-to-end) needs FIRESTORE_EMULATOR_HOST,
//   FIREBASE_AUTH_EMULATOR_HOST, AND FIREBASE_STORAGE_EMULATOR_HOST set.

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — structural (no emulator needed)
// =========================================================================
{
  const mediaSrc = readFileSync(new URL('../api/showcase-media.js', import.meta.url), 'utf8')
  const publicSrc = readFileSync(new URL('../api/showcase-public.js', import.meta.url), 'utf8')
  const accessSrc = readFileSync(new URL('../api/_lib/showcase-media-access.js', import.meta.url), 'utf8')

  check('api/showcase-media.js exists and is a GET-only handler', /req\.method !== 'GET'/.test(mediaSrc))
  check('api/showcase-media.js rate-limits before any lookup (durable, atomic — same as the other two public endpoints)',
    /checkDurableRateLimit/.test(mediaSrc) && mediaSrc.indexOf('checkDurableRateLimit') < mediaSrc.indexOf("collection('litterShowcases')"))
  check('api/showcase-media.js uses its OWN rate-limit namespace, distinct from showcase-public and showcase-enquiry',
    /checkDurableRateLimit\(\s*\n\s*db,\s*\n\s*'showcase-media',/.test(mediaSrc))

  // Every hop of the revalidation chain must be re-derived from a fresh
  // read inside THIS file — never assumed from a prior request.
  check('api/showcase-media.js re-resolves the Showcase by shareTokenHash from the request token', /where\('shareTokenHash', '==', tokenHash\)/.test(mediaSrc))
  check('api/showcase-media.js re-checks isShareLive() (covers disable, pause, and expiry) on every request', /isShareLive\(showcase\)/.test(mediaSrc))
  check('api/showcase-media.js re-checks isTenantPlusEligible() (covers downgrade) with a FRESH users/{tenantId} read on every request', /isTenantPlusEligible\(profileSnap\.exists/.test(mediaSrc))
  check('api/showcase-media.js re-verifies the Litter belongs to the same tenant as the Showcase on every request', /litterSnap\.data\(\)\.tenantId !== showcase\.tenantId/.test(mediaSrc))
  check('api/showcase-media.js resolves the puppy via resolveVisiblePuppyByRef() (covers hide + tenant/litter-chain drift, including the legacy-litterId fallback) on every request', /resolveVisiblePuppyByRef\(db, showcase, litterId, puppyRef, litterPuppyIds\)/.test(mediaSrc))
  check('api/showcase-media.js builds litterPuppyIds from the ALREADY-fetched litterSnap — no extra Firestore read for the legacy-litterId fallback', /const litterPuppyIds = new Set\(litterSnap\.data\(\)\.puppyIds \|\| \[\]\)/.test(mediaSrc))
  check('api/showcase-media.js re-checks the requested mediaId is in the puppy\'s CURRENT publishedPhotoIds/publishedVideoIds (covers unpublish) on every request', /publishedIds\.includes\(mediaId\)/.test(mediaSrc))
  check('api/showcase-media.js verifies the Storage object still exists before minting anything', /signMediaItems\(bucket, \[mediaItem\], SHORT_LIVED_REDIRECT_TTL_MS\)/.test(mediaSrc))

  check('api/showcase-media.js mints a SHORT-lived redirect target, never the 15-minute breeder-authenticated TTL', /SHORT_LIVED_REDIRECT_TTL_MS/.test(mediaSrc) && !/SIGNED_MEDIA_URL_TTL_MS/.test(mediaSrc))
  check('SHORT_LIVED_REDIRECT_TTL_MS is dramatically shorter than the breeder-authenticated SIGNED_MEDIA_URL_TTL_MS', (() => {
    const shortMatch = /SHORT_LIVED_REDIRECT_TTL_MS = (\d+) \* (\d+)/.exec(accessSrc)
    const longMatch = /SIGNED_MEDIA_URL_TTL_MS = (\d+) \* (\d+) \* (\d+)/.exec(accessSrc)
    if (!shortMatch || !longMatch) return false
    const shortMs = Number(shortMatch[1]) * Number(shortMatch[2])
    const longMs = Number(longMatch[1]) * Number(longMatch[2]) * Number(longMatch[3])
    return shortMs > 0 && shortMs < longMs
  })())
  check('api/showcase-media.js redirects (302), never proxies bytes through the function itself', /res\.redirect\(302, signed\.url\)/.test(mediaSrc))
  check('api/showcase-media.js marks its redirect response non-cacheable', /Cache-Control.*no-store/.test(mediaSrc))
  check('A wrong/missing token/puppyRef/mediaId/kind returns the SAME generic 404 shape as every other denial', (mediaSrc.match(/status\(404\)\.json\(\{ error: 'Not found' \}\)/g) || []).length >= 5)

  check('api/showcase-public.js no longer imports getStorage or mints any Storage URL itself', !/firebase-admin\/storage/.test(publicSrc) && !/getSignedUrl/.test(publicSrc))
  check('api/showcase-public.js\'s media urls point at /api/showcase-media, carrying token+puppyRef+mediaId+kind', /\/api\/showcase-media\?/.test(publicSrc) && /URLSearchParams\(\{ token, puppyRef, mediaId, kind \}\)/.test(publicSrc))

  check('resolveVisiblePuppyByRef() is shared between api/create-showcase-enquiry.js and api/showcase-media.js (single source of truth for opaque-ref resolution)',
    /export async function resolveVisiblePuppyByRef/.test(accessSrc))
}

// =========================================================================
// SECTION 2 — emulator end-to-end
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`

  const { getFirestore } = await import('firebase-admin/firestore')
  const { getStorage } = await import('firebase-admin/storage')
  const { hashClientKey } = await import('../api/_lib/rate-limit.js')
  const { __resetDurableRateLimitForTests } = await import('../api/_lib/durable-rate-limit.js')

  const { default: createShowcaseHandler } = await import('../api/create-showcase.js')
  const { default: updatePuppyHandler } = await import('../api/update-showcase-puppy.js')
  const { default: setEnabledHandler } = await import('../api/set-showcase-enabled.js')
  const { default: rotateShareHandler } = await import('../api/rotate-showcase-share.js')
  const { default: showcasePublicHandler } = await import('../api/showcase-public.js')
  const { default: showcaseMediaHandler } = await import('../api/showcase-media.js')
  const { default: getMediaUrlsHandler } = await import('../api/get-showcase-media-urls.js')

  const seedDb = getFirestore()
  const bucket = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET)

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')
  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'showcase-media-delivery-client')
  const clientAuth = getClientAuth(clientApp)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

  function mockReq(body, token) {
    return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }
  }
  function mockGetReq(query, xff) {
    return { method: 'GET', headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: '127.0.0.1' }, query }
  }
  function mockRes() {
    const res = { statusCode: 200, body: null, headers: {} }
    res.status = c => { res.statusCode = c; return res }
    res.json = p => { res.body = p; return res }
    res.setHeader = (k, v) => { res.headers[k] = v; return res }
    res.redirect = (code, url) => { res.statusCode = code; res.headers.Location = url; return res }
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
      tenantId: tenantUid, damId: null, name: 'MediaDeliveryTestLitter', notes: '', actualBirthDate: '2026-01-01', puppyIds,
    })
  }
  async function seedPuppy(tenantUid, puppyId, litterId, extra = {}) {
    await seedDb.collection('dogs').doc(puppyId).set({
      tenantId: tenantUid, currentOwnerId: tenantUid, createdByUserId: tenantUid,
      sourceType: 'BREEDER_ISSUED', name: 'Puppy ' + puppyId, sex: 'female', status: 'active',
      dateOfBirth: '2026-01-01', litterId, colour: 'Black', breed: 'Labrador', photos: [], videos: [], ...extra,
    })
  }
  async function seedMediaFile(tenantUid, dogId, kind) {
    const { randomUUID } = await import('node:crypto')
    const id = randomUUID()
    const ext = kind === 'photo' ? 'jpg' : 'mp4'
    const path = `dogs/${tenantUid}/${dogId}/${kind}s/${randomUUID()}.${ext}`
    await bucket.file(path).save(Buffer.from(`fake-${kind}-bytes-${id}`), { metadata: { contentType: kind === 'photo' ? 'image/jpeg' : 'video/mp4' } })
    return { id, path }
  }
  const breederPlusProfile = { role: 'breeder', plan: 'plus', email: 'x@example.com' }

  async function resetMediaRateLimit(ip) { await __resetDurableRateLimitForTests(seedDb, 'showcase-media', hashClientKey(ip)) }

  function parseMediaQuery(url) {
    const qIndex = url.indexOf('?')
    const params = new URLSearchParams(url.slice(qIndex + 1))
    return {
      token: params.get('token'),
      puppyRef: params.get('puppyRef'),
      mediaId: params.get('mediaId'),
      kind: params.get('kind'),
    }
  }

  // Builds a fully-live Showcase with ONE published photo, fetches the
  // REAL public JSON response, and extracts the REAL media query — the
  // exact same reference a real browser would have received. Every
  // revocation test below reuses this SAME captured `query` object,
  // never a synthesized one, so a passing test genuinely proves "a
  // reference a viewer already has stops working," not just "the
  // endpoint's logic looks right in isolation."
  async function setupLivePublishedShowcase(prefix) {
    const breeder = await newUser(`${prefix}breeder`, breederPlusProfile)
    const litterId = `${prefix}litter_${R}`
    const puppyId = `${prefix}puppy_${R}`
    await seedLitter(breeder.uid, litterId, [puppyId])
    const photo = await seedMediaFile(breeder.uid, puppyId, 'photo')
    await seedPuppy(breeder.uid, puppyId, litterId, { photos: [photo] })
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())
    await setEnabledHandler(mockReq({ litterId, enabled: true }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId, visible: true, publishedPhotoIds: [photo.id] }, breeder.idToken), mockRes())
    const rotateRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, breeder.idToken), rotateRes)
    const token = rotateRes.body.shareToken

    const publicRes = mockRes()
    await showcasePublicHandler(mockGetReq({ token }, `${prefix}-setup-ip`), publicRes)
    const mediaUrl = publicRes.body?.puppies?.[0]?.photos?.[0]?.url
    if (!mediaUrl) throw new Error(`setupLivePublishedShowcase(${prefix}): no media url in public response — ${JSON.stringify(publicRes.body)}`)

    return { breeder, litterId, puppyId, photo, token, query: parseMediaQuery(mediaUrl) }
  }

  // ── Test 1: baseline — a genuinely live, published media reference
  // resolves to a REAL, working signed URL ──
  {
    await resetMediaRateLimit('t1-media-ip')
    const { query } = await setupLivePublishedShowcase('t1')
    const res = mockRes()
    await showcaseMediaHandler(mockGetReq(query, 't1-media-ip'), res)
    check('1', 'A genuinely live, published media reference resolves (302)', res.statusCode === 302, JSON.stringify(res.body))
    check('1', 'The redirect Location is a real Storage URL, never api/showcase-media.js\'s own domain again', typeof res.headers.Location === 'string' && res.headers.Location.length > 0)

    // Prove the redirect target is genuinely fetchable, not just a
    // well-formed string — the whole point of this endpoint is that it
    // still produces a REAL, working asset, just via a re-validated,
    // short-lived path instead of a long-lived one embedded in the JSON.
    const fetched = await fetch(res.headers.Location)
    check('1', 'The redirect target is a genuinely fetchable Storage object (200)', fetched.ok, `status=${fetched.status}`)
  }

  // ── Test 2 (disable): the NEXT request after disabling is denied,
  // even reusing the EXACT reference a viewer already had ──
  {
    await resetMediaRateLimit('t2-media-ip')
    const { breeder, litterId, query } = await setupLivePublishedShowcase('t2')
    await setEnabledHandler(mockReq({ litterId, enabled: false }, breeder.idToken), mockRes())
    const res = mockRes()
    await showcaseMediaHandler(mockGetReq(query, 't2-media-ip'), res)
    check('2', 'Disabling the Showcase denies the very next request for an already-issued media reference (404)', res.statusCode === 404)
  }

  // ── Test 3 (rotate): the OLD reference is denied even though the
  // Showcase itself is still enabled — only the token changed ──
  {
    await resetMediaRateLimit('t3-media-ip')
    const { breeder, litterId, query } = await setupLivePublishedShowcase('t3')
    await rotateShareHandler(mockReq({ litterId }, breeder.idToken), mockRes())
    const res = mockRes()
    await showcaseMediaHandler(mockGetReq(query, 't3-media-ip'), res)
    check('3', 'Rotating the share token denies the OLD media reference immediately (404)', res.statusCode === 404)
  }

  // ── Test 4 (expiry): a share that has since expired denies the
  // already-issued reference ──
  {
    await resetMediaRateLimit('t4-media-ip')
    const { litterId, query } = await setupLivePublishedShowcase('t4')
    await seedDb.collection('litterShowcases').doc(litterId).update({ shareExpiresAt: new Date(Date.now() - 60_000).toISOString() })
    const res = mockRes()
    await showcaseMediaHandler(mockGetReq(query, 't4-media-ip'), res)
    check('4', 'An expired share denies the already-issued media reference (404)', res.statusCode === 404)
  }

  // ── Test 5 (unpublish): removing this exact photo from
  // publishedPhotoIds denies the already-issued reference, even though
  // the Showcase/puppy are otherwise still fully live ──
  {
    await resetMediaRateLimit('t5-media-ip')
    const { breeder, litterId, puppyId, query } = await setupLivePublishedShowcase('t5')
    await updatePuppyHandler(mockReq({ litterId, puppyId, publishedPhotoIds: [] }, breeder.idToken), mockRes())
    const res = mockRes()
    await showcaseMediaHandler(mockGetReq(query, 't5-media-ip'), res)
    check('5', 'Unpublishing this exact photo denies the already-issued media reference (404)', res.statusCode === 404)
  }

  // ── Test 6 (hide): hiding the puppy (visible:false) denies the
  // already-issued reference, even though the media is still "published" ──
  {
    await resetMediaRateLimit('t6-media-ip')
    const { breeder, litterId, puppyId, query } = await setupLivePublishedShowcase('t6')
    await updatePuppyHandler(mockReq({ litterId, puppyId, visible: false }, breeder.idToken), mockRes())
    const res = mockRes()
    await showcaseMediaHandler(mockGetReq(query, 't6-media-ip'), res)
    check('6', 'Hiding the puppy denies the already-issued media reference (404)', res.statusCode === 404)
  }

  // ── Test 7 (downgrade): the tenant losing Plus eligibility denies the
  // already-issued reference, with no Showcase document changing at all ──
  {
    await resetMediaRateLimit('t7-media-ip')
    const { breeder, query } = await setupLivePublishedShowcase('t7')
    await seedDb.collection('users').doc(breeder.uid).set({ ...breederPlusProfile, plan: 'free' })
    const res = mockRes()
    await showcaseMediaHandler(mockGetReq(query, 't7-media-ip'), res)
    check('7', 'Downgrading the tenant off Plus denies the already-issued media reference (404)', res.statusCode === 404)
  }

  // ── Test 8: sanity — an unknown/garbage query is denied the same
  // generic way, never a distinguishing signal ──
  {
    await resetMediaRateLimit('t8-media-ip')
    const res = mockRes()
    await showcaseMediaHandler(mockGetReq({ token: 'garbage-token-never-issued', puppyRef: 'garbage', mediaId: 'garbage', kind: 'photo' }, 't8-media-ip'), res)
    check('8', 'An entirely unknown reference is denied with the same generic 404', res.statusCode === 404 && res.body?.error === 'Not found')
  }

  // ── Test 9: rate limiting — this endpoint has its own, more generous
  // durable budget, distinct from the other two public endpoints ──
  {
    await resetMediaRateLimit('t9-media-ip')
    const { query } = await setupLivePublishedShowcase('t9')
    let last
    for (let i = 0; i < 91; i++) {
      last = mockRes()
      await showcaseMediaHandler(mockGetReq(query, 't9-media-ip'), last)
    }
    check('9', 'The 91st request from the same client within the window is rate-limited (429)', last.statusCode === 429)
    check('9', 'A 429 response includes a Retry-After header', typeof last.headers['Retry-After'] === 'string' && Number(last.headers['Retry-After']) > 0)
    await resetMediaRateLimit('t9-media-ip')
  }

  // ── Test 10 (Codex: "Preserve authenticated breeder media viewing"):
  // the breeder's OWN authenticated gallery view is entirely unaffected
  // by this rework — still the original 15-minute TTL, still gated by
  // Firebase Auth + ownership, never routed through the public
  // token/share-liveness chain at all ──
  {
    const { breeder, puppyId } = await setupLivePublishedShowcase('t10')
    const res = mockRes()
    await getMediaUrlsHandler(mockReq({ dogId: puppyId }, breeder.idToken), res)
    check('10', 'The breeder\'s own authenticated gallery view still works, unaffected by the public revocation chain', res.statusCode === 200 && res.body?.photos?.length === 1)
  }

  await summary()
} else {
  skip('Section 2 emulator end-to-end (server-mediated public media delivery)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST/FIREBASE_STORAGE_EMULATOR_HOST and start the emulators to run them')
  summary()
}
