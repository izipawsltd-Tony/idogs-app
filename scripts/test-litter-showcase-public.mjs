// scripts/test-litter-showcase-public.mjs — regression coverage for the
// Litter Showcase MVP's public share link (Slice 2).
//
// Slice 1 (scripts/test-litter-showcase.mjs) built the authenticated,
// breeder-only management UI/API for curating a Showcase, and its own
// firestore.rules block explicitly documented that a future public page
// "must go through its own trusted Admin SDK endpoint returning an
// allowlisted projection, never a direct client read" — this file tests
// exactly that endpoint (api/showcase-public.js) plus the token
// lifecycle that feeds it (api/rotate-showcase-share.js,
// api/update-showcase-share.js).
//
// Security model under test: lookup is by a random, hashed-at-rest
// token ONLY — litterId (a Firestore document id) is never accepted as
// a request parameter and never authorizes anything on its own. A
// wrong/revoked/expired/disabled token all return the identical generic
// 404, never a distinguishing signal.
//
// Usage: node scripts/test-litter-showcase-public.mjs
//   Section 1 (structural + pure-function unit tests) always runs.
//   Section 2 (emulator end-to-end) needs FIRESTORE_EMULATOR_HOST +
//   FIREBASE_AUTH_EMULATOR_HOST set and the local Firebase emulator
//   running.

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { generateShareToken, hashShareToken, isShareLive, isValidExpiryIso, MAX_SHARE_EXPIRY_DAYS } from '../api/_lib/showcase-share.js'

const { check, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — structural + pure-function unit tests (no emulator needed)
// =========================================================================
{
  const typesSrc = readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8')
  const createSrc = readFileSync(new URL('../api/create-showcase.js', import.meta.url), 'utf8')
  const accessSrc = readFileSync(new URL('../api/_lib/showcase-access.js', import.meta.url), 'utf8')
  const publicSrc = readFileSync(new URL('../api/showcase-public.js', import.meta.url), 'utf8')
  const rotateSrc = readFileSync(new URL('../api/rotate-showcase-share.js', import.meta.url), 'utf8')
  const updateShareSrc = readFileSync(new URL('../api/update-showcase-share.js', import.meta.url), 'utf8')

  check('LitterShowcase declares shareTokenHash: string | null', /shareTokenHash: string \| null/.test(typesSrc))
  check('LitterShowcase declares shareEnabled: boolean (separate from Slice 1\'s enabled)', /shareEnabled: boolean/.test(typesSrc))
  check('LitterShowcase declares shareExpiresAt: string | null', /shareExpiresAt: string \| null/.test(typesSrc))

  check('create-showcase.js initializes shareTokenHash to null on every new Showcase',
    /shareTokenHash: null,/.test(createSrc))
  check('create-showcase.js initializes shareEnabled to false on every new Showcase',
    /shareEnabled: false,/.test(createSrc))

  check('showcase-access.js\'s readShowcaseForResponse never coerces a null shareRotatedAt into an empty string',
    /shareRotatedAt: data\.shareRotatedAt \? resolveTimestampIso\(data\.shareRotatedAt\) : null/.test(accessSrc))

  check('api/showcase-public.js uses the Admin SDK (bypasses firestore.rules, the only legitimate way an anonymous caller reaches litterShowcases)',
    /firebase-admin\/(app|firestore)/.test(publicSrc))
  check('api/showcase-public.js rate-limits BEFORE any token lookup',
    /checkRateLimit/.test(publicSrc) && publicSrc.indexOf('checkRateLimit') < publicSrc.indexOf("collection('litterShowcases')"))
  check('api/showcase-public.js namespaces its rate-limit key so it never shares a budget with api/passport.js',
    /hashClientKey\(`showcase:\$\{getClientIp\(req\)\}`\)/.test(publicSrc))
  check('api/showcase-public.js looks a Showcase up by shareTokenHash, never by litterId',
    /where\('shareTokenHash', '==', tokenHash\)/.test(publicSrc) && !/req\.query\.litterId/.test(publicSrc))
  check('api/showcase-public.js calls isShareLive() before returning any data',
    /isShareLive\(showcase\)/.test(publicSrc))

  // The public puppy projection must never include any of these fields,
  // regardless of what a seeded Dog document happens to carry — checked
  // both structurally here (the literal object-building code) AND
  // behaviorally in Section 2 (an actual seeded doc with all of these
  // populated, asserting none survive into the real HTTP response).
  const forbiddenFields = [
    'microchip', 'ankc', 'tenantId', 'currentOwnerId', 'createdByUserId', 'originBreederId',
    'notes', 'breederIdType', 'breederIdValue', 'buyerEmail', 'buyerName', 'previousOwnerId',
    'reservedForName', 'reservedForEmail', 'reservedForPhone', 'depositStatus', 'depositAmount',
    'depositReceivedAt', 'availabilityStatus', 'status', 'passportId', 'transferredAt', 'claimedBy', 'claimedAt',
  ]
  const projectionFnMatch = /function publicPuppyProjection\([\s\S]*?\n\}/.exec(publicSrc)
  check('publicPuppyProjection() function was found for inspection', !!projectionFnMatch)
  if (projectionFnMatch) {
    const fnSrc = projectionFnMatch[0]
    for (const field of forbiddenFields) {
      check(`publicPuppyProjection() never references dog.${field}`, !fnSrc.includes(`dog.${field}`))
    }
  }

  check('api/rotate-showcase-share.js requires Breeder+Plus access (reuses checkBreederPlusAccess, not a bespoke check)',
    /checkBreederPlusAccess/.test(rotateSrc))
  check('api/rotate-showcase-share.js verifies litter+showcase ownership before writing (reuses loadOwnedLitter/loadOwnedShowcase)',
    /loadOwnedLitter/.test(rotateSrc) && /loadOwnedShowcase/.test(rotateSrc))
  check('api/rotate-showcase-share.js never persists the raw token anywhere — only its hash',
    /shareTokenHash: tokenHash/.test(rotateSrc) && !/shareToken: rawToken,\s*\n\s*shareTokenHash/.test(rotateSrc))

  check('api/update-showcase-share.js requires an existing token before allowing enable/disable/expiry changes',
    /SHARE_NOT_ROTATED_YET/.test(updateShareSrc))
  check('api/update-showcase-share.js never touches shareTokenHash (rotate is the only way to change the token itself)',
    !/tx\.update\(showcaseRef, \{[^}]*shareTokenHash/.test(updateShareSrc))

  // ── isShareLive() pure-function unit tests ──
  const baseLive = { enabled: true, shareEnabled: true, shareTokenHash: 'abc123', shareExpiresAt: null }
  check('isShareLive: fully live Showcase (enabled, shareEnabled, has a token, no expiry) is live', isShareLive(baseLive) === true)
  check('isShareLive: no token at all is never live, even if every other flag is true', isShareLive({ ...baseLive, shareTokenHash: null }) === false)
  check('isShareLive: shareEnabled=false is never live, even with a valid token', isShareLive({ ...baseLive, shareEnabled: false }) === false)
  check('isShareLive: enabled=false is never live, even with shareEnabled=true (base Showcase disabled must take the link down too)', isShareLive({ ...baseLive, enabled: false }) === false)
  check('isShareLive: a future expiry is still live', isShareLive({ ...baseLive, shareExpiresAt: new Date(Date.now() + 86_400_000).toISOString() }) === true)
  check('isShareLive: a past expiry is not live', isShareLive({ ...baseLive, shareExpiresAt: new Date(Date.now() - 86_400_000).toISOString() }) === false)
  check('isShareLive: an unparseable expiry fails closed (not live), never throws', isShareLive({ ...baseLive, shareExpiresAt: 'not-a-real-date' }) === false)
  check('isShareLive: a null showcase is never live (defensive — a caller must never crash on a not-found lookup)', isShareLive(null) === false)

  // ── token generation/hashing ──
  const tokenA = generateShareToken()
  const tokenB = generateShareToken()
  check('generateShareToken() produces a non-empty string', typeof tokenA === 'string' && tokenA.length > 0)
  check('generateShareToken() has at least 32 characters of base64url entropy (256-bit source)', tokenA.length >= 32)
  check('generateShareToken() is URL-safe (no +, /, or = padding characters)', !/[+/=]/.test(tokenA))
  check('generateShareToken() produces a DIFFERENT token on every call', tokenA !== tokenB)
  check('hashShareToken() is deterministic for the same input', hashShareToken(tokenA) === hashShareToken(tokenA))
  check('hashShareToken() produces different hashes for different tokens', hashShareToken(tokenA) !== hashShareToken(tokenB))
  check('hashShareToken() output never contains the raw token as a substring', !hashShareToken(tokenA).includes(tokenA))
  check('hashShareToken() output looks like a sha256 hex digest (64 lowercase hex chars)', /^[0-9a-f]{64}$/.test(hashShareToken(tokenA)))

  // ── expiry validation ──
  check('isValidExpiryIso: a valid near-future date is accepted', isValidExpiryIso(new Date(Date.now() + 86_400_000).toISOString()))
  check('isValidExpiryIso: a garbage string is rejected', !isValidExpiryIso('not-a-date'))
  check('isValidExpiryIso: an empty string is rejected', !isValidExpiryIso(''))
  check('isValidExpiryIso: a date further than MAX_SHARE_EXPIRY_DAYS in the future is rejected',
    !isValidExpiryIso(new Date(Date.now() + (MAX_SHARE_EXPIRY_DAYS + 10) * 86_400_000).toISOString()))
  check('isValidExpiryIso: a date in the past is still structurally valid (rotate/update decide whether to allow it — this just validates parseability/range)',
    isValidExpiryIso(new Date(Date.now() - 86_400_000).toISOString()))
}

// =========================================================================
// SECTION 2 — emulator end-to-end (token lifecycle + public read)
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  const { getFirestore } = await import('firebase-admin/firestore')
  const { __resetForTests: resetRateLimit } = await import('../api/_lib/rate-limit.js')

  const { default: createShowcaseHandler } = await import('../api/create-showcase.js')
  const { default: updatePuppyHandler } = await import('../api/update-showcase-puppy.js')
  const { default: setEnabledHandler } = await import('../api/set-showcase-enabled.js')
  const { default: rotateShareHandler } = await import('../api/rotate-showcase-share.js')
  const { default: updateShareHandler } = await import('../api/update-showcase-share.js')
  const { default: showcasePublicHandler } = await import('../api/showcase-public.js')

  const seedDb = getFirestore()

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')

  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'showcase-public-client')
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
  // puppyIds must be supplied up front — api/update-showcase-puppy.js
  // requires puppyId to be a CURRENT member of litter.puppyIds before
  // it will touch the Showcase's puppies map at all (see that file's
  // own header comment), so a litter seeded with an empty array here
  // would make every "mark this puppy visible" call in these tests
  // silently no-op.
  async function seedLitter(tenantUid, litterId, puppyIds = [], extra = {}) {
    await seedDb.collection('litters').doc(litterId).set({
      tenantId: tenantUid, damId: `dam_${litterId}`, sireName: 'Sire McSireface', name: 'PublicShowcaseTestLitter',
      notes: 'PRIVATE breeder note — must never appear publicly', actualBirthDate: '2026-01-01', puppyIds, ...extra,
    })
    await seedDb.collection('dogs').doc(`dam_${litterId}`).set({
      tenantId: tenantUid, currentOwnerId: tenantUid, name: 'Dam McDamface', sex: 'female', status: 'active',
    })
  }
  async function seedPuppy(tenantUid, puppyId, litterId, extra = {}) {
    await seedDb.collection('dogs').doc(puppyId).set({
      tenantId: tenantUid, currentOwnerId: tenantUid, createdByUserId: tenantUid,
      sourceType: 'BREEDER_ISSUED', name: 'Puppy ' + puppyId, sex: 'female', status: 'active',
      dateOfBirth: '2026-01-01', litterId, colour: 'Black', breed: 'Labrador', photos: [], ...extra,
    })
  }
  const breederPlusProfile = { role: 'breeder', plan: 'plus', email: 'x@example.com' }

  // Builds a fully-live, fully-public Showcase (litter + 1 visible puppy
  // + rotated/enabled share) and returns everything a test needs. Shared
  // by most of the tests below so each one only has to set up the ONE
  // thing it's actually testing.
  async function setupLiveShowcase(prefix, puppyExtra = {}) {
    const breeder = await newUser(`${prefix}breeder`, breederPlusProfile)
    const litterId = `${prefix}litter_${R}`
    const puppyId = `${prefix}puppy_${R}`
    await seedLitter(breeder.uid, litterId, [puppyId])
    await seedPuppy(breeder.uid, puppyId, litterId, puppyExtra)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())
    await setEnabledHandler(mockReq({ litterId, enabled: true }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId, visible: true, availability: 'available' }, breeder.idToken), mockRes())
    const rotateRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, breeder.idToken), rotateRes)
    return { breeder, litterId, puppyId, token: rotateRes.body.shareToken }
  }

  // ── Test 1: a valid, live token returns the litter + visible puppy,
  // with the allowlisted shape only ──
  {
    const { litterId, puppyId, token } = await setupLiveShowcase('t1')
    const res = mockRes()
    await showcasePublicHandler(mockGetReq({ token }, 't1-ip'), res)
    check('1', 'A valid, live token returns 200', res.statusCode === 200, JSON.stringify(res.body))
    check('1', 'The litter name is returned', res.body?.litter?.name === 'PublicShowcaseTestLitter')
    check('1', 'The dam name is resolved from damId', res.body?.litter?.damName === 'Dam McDamface')
    check('1', 'The sire name (already denormalized on Litter) is returned', res.body?.litter?.sireName === 'Sire McSireface')
    check('1', 'Exactly one visible puppy is returned', res.body?.puppies?.length === 1)
    check('1', 'The puppy id matches the visible puppy', res.body?.puppies?.[0]?.id === puppyId)
    check('1', 'The puppy\'s showcase-specific availability is returned', res.body?.puppies?.[0]?.availability === 'available')
    check('1', 'The response never includes the litter\'s private notes field', JSON.stringify(res.body).includes('PRIVATE breeder note') === false)
    check('1', 'The response never includes litterId/tenantId anywhere in the body', !JSON.stringify(res.body).includes(litterId))
  }

  // ── Test 2: an invalid/nonexistent token is denied generically ──
  {
    const res = mockRes()
    await showcasePublicHandler(mockGetReq({ token: 'this-token-was-never-issued' }, 't2-ip'), res)
    check('2', 'An unknown token returns a generic 404', res.statusCode === 404)
    check('2', 'The 404 body is the same generic shape as every other denial (no distinguishing detail)', res.body?.error === 'Not found')
  }

  // ── Test 3: a valid token whose Showcase is NOT enabled (Slice 1 flag)
  // is denied, even though shareEnabled is true ──
  {
    const { litterId, token } = await setupLiveShowcase('t3')
    // Disabled directly via the Admin SDK (setupLiveShowcase doesn't
    // return the breeder's idToken) — exactly equivalent from
    // showcase-public.js's point of view, since it only ever reads
    // `enabled` off the document, never how it got there.
    await seedDb.collection('litterShowcases').doc(litterId).update({ enabled: false })
    const res = mockRes()
    await showcasePublicHandler(mockGetReq({ token }, 't3-ip'), res)
    check('3', 'A disabled Showcase (enabled:false) is denied even with a valid, shareEnabled token', res.statusCode === 404)
  }

  // ── Test 4: shareEnabled:false (paused link) is denied even though
  // the base Showcase stays enabled ──
  {
    const { breeder, litterId, token } = await setupLiveShowcase('t4')
    await updateShareHandler(mockReq({ litterId, shareEnabled: false }, breeder.idToken), mockRes())
    const res = mockRes()
    await showcasePublicHandler(mockGetReq({ token }, 't4-ip'), res)
    check('4', 'A paused share link (shareEnabled:false) is denied', res.statusCode === 404)

    // Re-enabling WITHOUT rotating must restore the SAME link.
    await updateShareHandler(mockReq({ litterId, shareEnabled: true }, breeder.idToken), mockRes())
    const resumedRes = mockRes()
    await showcasePublicHandler(mockGetReq({ token }, 't4b-ip'), resumedRes)
    check('4', 'Re-enabling (without rotating) makes the ORIGINAL token work again', resumedRes.statusCode === 200)
  }

  // ── Test 5: an expired token is denied ──
  {
    const { breeder, litterId, token } = await setupLiveShowcase('t5')
    const pastExpiry = new Date(Date.now() - 60_000).toISOString()
    await seedDb.collection('litterShowcases').doc(litterId).update({ shareExpiresAt: pastExpiry })
    void breeder
    const res = mockRes()
    await showcasePublicHandler(mockGetReq({ token }, 't5-ip'), res)
    check('5', 'An expired token is denied', res.statusCode === 404)
  }

  // ── Test 6: rotating invalidates the OLD token immediately ──
  {
    const { breeder, litterId, token: oldToken } = await setupLiveShowcase('t6')
    const rotateRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, breeder.idToken), rotateRes)
    const newToken = rotateRes.body.shareToken
    check('6', 'Rotating produces a genuinely new token', newToken !== oldToken)

    const oldRes = mockRes()
    await showcasePublicHandler(mockGetReq({ token: oldToken }, 't6a-ip'), oldRes)
    check('6', 'The OLD token no longer works after rotation', oldRes.statusCode === 404)

    const newRes = mockRes()
    await showcasePublicHandler(mockGetReq({ token: newToken }, 't6b-ip'), newRes)
    check('6', 'The NEW token works immediately', newRes.statusCode === 200)
  }

  // ── Test 7: tenant isolation — breeder A's token never surfaces
  // breeder B's data, and litterId is provably irrelevant to the lookup ──
  {
    const a = await setupLiveShowcase('t7a')
    const b = await setupLiveShowcase('t7b')
    const resA = mockRes()
    await showcasePublicHandler(mockGetReq({ token: a.token, litterId: b.litterId }, 't7-ip'), resA)
    check('7', 'Breeder A\'s token returns breeder A\'s litter regardless of an unrelated litterId also present in the query string', resA.body?.puppies?.[0]?.id === a.puppyId)
    check('7', 'Breeder A\'s response never contains breeder B\'s puppy id', !JSON.stringify(resA.body).includes(b.puppyId))

    // IDOR check: a garbage token PLUS a real litterId for an existing,
    // live Showcase must still be denied — litterId must never be able
    // to substitute for a valid token.
    const idorRes = mockRes()
    await showcasePublicHandler(mockGetReq({ token: 'garbage-token-not-a-real-hash-match', litterId: a.litterId }, 't7c-ip'), idorRes)
    check('7', 'IDOR: supplying a real litterId alongside a garbage token is still denied — litterId never authorizes anything on its own', idorRes.statusCode === 404)
  }

  // ── Test 8: full private-field allowlist — a puppy seeded with every
  // sensitive field populated must have NONE of them survive into the
  // public response ──
  {
    const { token } = await setupLiveShowcase('t8', {
      microchip: '900000000000000', ankc: '2024001234', tenantId: 'SHOULD_NOT_LEAK',
      notes: 'PRIVATE PUPPY NOTE', breederIdType: 'DOGS_SA', breederIdValue: 'B999999',
      buyerEmail: 'buyer@example.com', buyerName: 'Jane Buyer', reservedForName: 'Jane Buyer',
      reservedForEmail: 'buyer@example.com', reservedForPhone: '0412345678',
      depositStatus: 'received', depositAmount: 500, depositReceivedAt: '2026-01-05',
      availabilityStatus: 'reserved', passportId: 'PUP-2026-SECRET',
    })
    const res = mockRes()
    await showcasePublicHandler(mockGetReq({ token }, 't8-ip'), res)
    const raw = JSON.stringify(res.body)
    const mustNotAppear = [
      '900000000000000', '2024001234', 'SHOULD_NOT_LEAK', 'PRIVATE PUPPY NOTE', 'DOGS_SA', 'B999999',
      'buyer@example.com', 'Jane Buyer', '0412345678', '500', '2026-01-05', 'PUP-2026-SECRET',
    ]
    for (const needle of mustNotAppear) {
      check('8', `Public response never contains the seeded private value "${needle}"`, !raw.includes(needle))
    }
    // The showcase-level `availability` (curated separately, 'available'
    // from setupLiveShowcase) must still be present and correct — proves
    // the allowlist isn't accidentally stripping EVERYTHING, only the
    // private fields.
    check('8', 'The showcase-curated availability is still present despite the dog\'s own (excluded) availabilityStatus being "reserved"', res.body?.puppies?.[0]?.availability === 'available')
  }

  // ── Test 9: a restricted puppy is still shown publicly (restricted
  // only affects the breeder's own EDITOR — see eda3eaae — never public
  // showcase visibility) ──
  {
    const { token, puppyId } = await setupLiveShowcase('t9', { status: 'restricted' })
    const res = mockRes()
    await showcasePublicHandler(mockGetReq({ token }, 't9-ip'), res)
    check('9', 'A restricted puppy still appears in the public Showcase (restricted gates editing, not public display)', res.body?.puppies?.[0]?.id === puppyId)
    check('9', 'The dog\'s internal status ("restricted") is never exposed in the public response', !JSON.stringify(res.body).includes('restricted'))
  }

  // ── Test 10: an invisible (visible:false) puppy never appears, even
  // though it exists in the same litter as a visible one ──
  {
    const breeder = await newUser('t10breeder', breederPlusProfile)
    const litterId = `t10litter_${R}`
    const visibleId = `t10visible_${R}`
    const hiddenId = `t10hidden_${R}`
    await seedLitter(breeder.uid, litterId, [visibleId, hiddenId])
    await seedPuppy(breeder.uid, visibleId, litterId)
    await seedPuppy(breeder.uid, hiddenId, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())
    await setEnabledHandler(mockReq({ litterId, enabled: true }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId: visibleId, visible: true }, breeder.idToken), mockRes())
    // hiddenId is deliberately left untouched — DEFAULT_SHOWCASE_PUPPY_ENTRY's visible:false applies.
    const rotateRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, breeder.idToken), rotateRes)
    const res = mockRes()
    await showcasePublicHandler(mockGetReq({ token: rotateRes.body.shareToken }, 't10-ip'), res)
    check('10', 'Only the explicitly-visible puppy is returned', res.body?.puppies?.length === 1 && res.body.puppies[0].id === visibleId)
    check('10', 'The hidden puppy\'s id never appears anywhere in the response', !JSON.stringify(res.body).includes(hiddenId))
  }

  // ── Test 11: rate limiting — hammering the SAME client key past the
  // configured max returns 429, with a Retry-After header ──
  {
    resetRateLimit()
    const { token } = await setupLiveShowcase('t11')
    let last
    for (let i = 0; i < 31; i++) {
      last = mockRes()
      await showcasePublicHandler(mockGetReq({ token }, 't11-fixed-ip'), last)
    }
    check('11', 'The 31st request from the same client within the window is rate-limited (429)', last.statusCode === 429)
    check('11', 'A 429 response includes a Retry-After header', typeof last.headers['Retry-After'] === 'string' && Number(last.headers['Retry-After']) > 0)
    resetRateLimit()
  }

  // ── Test 12: breeder-side share endpoints — auth/ownership, mirroring
  // this codebase's existing pattern for the other 4 showcase endpoints ──
  {
    const breeder = await newUser('t12breeder', breederPlusProfile)
    const stranger = await newUser('t12stranger', breederPlusProfile)
    const freeAcct = await newUser('t12free', { role: 'breeder', plan: 'free', email: 'f@example.com' })
    const litterId = `t12litter_${R}`
    await seedLitter(breeder.uid, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())

    const noAuthRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, undefined), noAuthRes)
    check('12', 'rotate-showcase-share denies an unauthenticated request', noAuthRes.statusCode === 401)

    const strangerRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, stranger.idToken), strangerRes)
    check('12', 'rotate-showcase-share denies a different tenant\'s breeder', strangerRes.statusCode === 403)

    const freeRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, freeAcct.idToken), freeRes)
    check('12', 'rotate-showcase-share denies a non-Plus-plan account', freeRes.statusCode === 403)

    const beforeRotateRes = mockRes()
    await updateShareHandler(mockReq({ litterId, shareEnabled: true }, breeder.idToken), beforeRotateRes)
    check('12', 'update-showcase-share is rejected before any rotate has ever happened for this litter', beforeRotateRes.statusCode === 409 && beforeRotateRes.body?.reason === 'SHARE_NOT_ROTATED_YET')

    const okRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, breeder.idToken), okRes)
    check('12', 'The owning, Plus-plan breeder can rotate successfully', okRes.statusCode === 200 && typeof okRes.body?.shareToken === 'string')

    const badExpiryRes = mockRes()
    await rotateShareHandler(mockReq({ litterId, shareExpiresAt: 'not-a-real-date' }, breeder.idToken), badExpiryRes)
    check('12', 'rotate-showcase-share rejects a malformed shareExpiresAt', badExpiryRes.statusCode === 400)
  }

  await summary()
} else {
  skip('Section 2 emulator end-to-end (Litter Showcase public share link)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
  summary()
}
