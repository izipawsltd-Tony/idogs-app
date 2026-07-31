// scripts/test-showcase-integration-hardening.mjs — Slice 2, commit 5/5.
// Two things: (1) coverage for a genuine cross-cutting IDOR/policy gap
// found during an integration sweep of commits 1-4 (a downgraded
// breeder's public link/enquiries kept working indefinitely — see
// api/_lib/showcase-share.js's isTenantPlusEligible() for the full
// story), and (2) one full end-to-end integration test that exercises
// every commit in this Slice as a single realistic flow (create litter
// -> puppy -> showcase -> rotate share -> upload photo -> public read
// -> enquiry -> breeder reads it back), which no single commit's own
// test file exercises as one continuous story.
//
// Usage: node scripts/test-showcase-integration-hardening.mjs
//   Section 1 (structural + pure-function) always runs.
//   Section 2 (emulator end-to-end) needs FIRESTORE_EMULATOR_HOST,
//   FIREBASE_AUTH_EMULATOR_HOST, AND FIREBASE_STORAGE_EMULATOR_HOST set.

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { isTenantPlusEligible } from '../api/_lib/showcase-share.js'

const { check, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — structural + pure-function (no emulator needed)
// =========================================================================
{
  check('isTenantPlusEligible: a Plus-plan profile is eligible', isTenantPlusEligible({ plan: 'plus' }) === true)
  check('isTenantPlusEligible: a Free-plan profile is not eligible', isTenantPlusEligible({ plan: 'free' }) === false)
  check('isTenantPlusEligible: a missing/null profile is not eligible (fails closed)', isTenantPlusEligible(null) === false)
  check('isTenantPlusEligible: an unrecognized plan value defaults to not-eligible (same safe default as computeEffectivePlan)', isTenantPlusEligible({ plan: 'enterprise' }) === false)
  check('isTenantPlusEligible: a Plus profile past its 7-day past_due grace is no longer eligible',
    isTenantPlusEligible({ plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() }) === false)
  check('isTenantPlusEligible: a Plus profile WITHIN its 7-day past_due grace is still eligible',
    isTenantPlusEligible({ plan: 'plus', subscriptionStatus: 'past_due', pastDueSince: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() }) === true)

  const publicSrc = readFileSync(new URL('../api/showcase-public.js', import.meta.url), 'utf8')
  const enquirySrc = readFileSync(new URL('../api/create-showcase-enquiry.js', import.meta.url), 'utf8')
  check('api/showcase-public.js re-checks the tenant\'s CURRENT plan (not just the Showcase document\'s own flags) before returning any data',
    /isTenantPlusEligible\(profileSnap\.exists \? profileSnap\.data\(\) : null\)/.test(publicSrc))
  check('api/showcase-public.js\'s plan check reads a FRESH users/{tenantId} doc, never a cached/stale value',
    /db\.collection\('users'\)\.doc\(showcase\.tenantId\)\.get\(\)/.test(publicSrc))
  check('A non-eligible tenant gets the SAME generic 404 as every other denial reason on the read endpoint',
    /if \(!isTenantPlusEligible\(profileSnap\.exists \? profileSnap\.data\(\) : null\)\) \{\s*\n\s*return res\.status\(404\)\.json\(\{ error: 'Not found' \}\)/.test(publicSrc))
  check('api/create-showcase-enquiry.js ALSO re-checks the tenant\'s current plan (same gap, same fix, both public endpoints)',
    /isTenantPlusEligible\(profileSnap\.exists \? profileSnap\.data\(\) : null\)/.test(enquirySrc))
}

// =========================================================================
// SECTION 2 — emulator end-to-end
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`

  const { getFirestore } = await import('firebase-admin/firestore')
  const { getStorage } = await import('firebase-admin/storage')
  const { default: createShowcaseHandler } = await import('../api/create-showcase.js')
  const { default: updatePuppyHandler } = await import('../api/update-showcase-puppy.js')
  const { default: setEnabledHandler } = await import('../api/set-showcase-enabled.js')
  const { default: rotateShareHandler } = await import('../api/rotate-showcase-share.js')
  const { default: showcasePublicHandler } = await import('../api/showcase-public.js')
  const { default: uploadMediaHandler } = await import('../api/upload-showcase-media.js')
  const { default: enquiryHandler } = await import('../api/create-showcase-enquiry.js')

  const seedDb = getFirestore()
  const bucket = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET)

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } = await import('firebase/auth')
  const { getFirestore: getClientFirestore, connectFirestoreEmulator, collection, query, where, getDocs } = await import('firebase/firestore')

  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'showcase-integration-client')
  const clientAuth = getClientAuth(clientApp)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const clientDb = getClientFirestore(clientApp)
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080)

  const sharp = (await import('sharp')).default
  const jpegBase64 = (await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).jpeg().toBuffer()).toString('base64')

  function mockReq(body, token) {
    return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }
  }
  function mockGetReq(query) { return { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' }, query } }
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
    await signOut(clientAuth)
    return { uid: user.uid, idToken, email }
  }
  const breederPlusProfile = { role: 'breeder', plan: 'plus', email: 'x@example.com' }

  // ── Test 1: a Showcase that's otherwise fully live becomes
  // unreachable — for BOTH reads and enquiries — the moment its owning
  // tenant is no longer Plus-eligible, without the Showcase document
  // itself changing at all ──
  {
    const breeder = await newUser('h1breeder', breederPlusProfile)
    const litterId = `h1litter_${R}`
    const puppyId = `h1pup_${R}`
    await seedDb.collection('litters').doc(litterId).set({ tenantId: breeder.uid, damId: null, name: 'HardeningLitter', notes: '', actualBirthDate: '2026-01-01', puppyIds: [puppyId] })
    await seedDb.collection('dogs').doc(puppyId).set({ tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED', name: 'HardeningPup', sex: 'male', status: 'active', dateOfBirth: '2026-01-01' })
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())
    await setEnabledHandler(mockReq({ litterId, enabled: true }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId, visible: true }, breeder.idToken), mockRes())
    const rotateRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, breeder.idToken), rotateRes)
    const token = rotateRes.body.shareToken

    const beforeDowngrade = mockRes()
    await showcasePublicHandler(mockGetReq({ token }), beforeDowngrade)
    check('1', 'Sanity: the link works normally while the breeder is still Plus', beforeDowngrade.statusCode === 200)

    // Downgrade — the Showcase document itself is completely untouched.
    await seedDb.collection('users').doc(breeder.uid).set({ ...breederPlusProfile, plan: 'free' })

    const afterDowngradeRead = mockRes()
    await showcasePublicHandler(mockGetReq({ token }), afterDowngradeRead)
    check('1', 'After downgrading to Free, the SAME link now returns 404 on read', afterDowngradeRead.statusCode === 404)

    const afterDowngradeEnquiry = mockRes()
    await enquiryHandler(mockReq({ token, name: 'Buyer', email: 'buyer@example.com', message: 'hi', consent: true }), afterDowngradeEnquiry)
    check('1', 'After downgrading to Free, the SAME link also refuses enquiries (404)', afterDowngradeEnquiry.statusCode === 404)
    check('1', 'No enquiry was written for the downgraded tenant\'s litter', (await seedDb.collection('showcaseEnquiries').where('litterId', '==', litterId).get()).empty)

    // Re-upgrade — the ORIGINAL link (never rotated) works again
    // immediately, proving this is a live plan check, not something
    // that permanently invalidated the token.
    await seedDb.collection('users').doc(breeder.uid).set(breederPlusProfile)
    const afterReupgrade = mockRes()
    await showcasePublicHandler(mockGetReq({ token }), afterReupgrade)
    check('1', 'Re-upgrading to Plus restores the ORIGINAL (never-rotated) link immediately', afterReupgrade.statusCode === 200)
  }

  // ── Test 2: full end-to-end flow across every commit in this Slice,
  // as one continuous story ──
  {
    const breeder = await newUser('h2breeder', breederPlusProfile)
    const litterId = `h2litter_${R}`
    const puppyId = `h2pup_${R}`

    // Commit 1/Slice-1 foundation: litter + puppy + showcase.
    await seedDb.collection('litters').doc(litterId).set({ tenantId: breeder.uid, damId: null, sireName: 'Rex', name: 'FullFlowLitter', notes: 'private', actualBirthDate: '2026-01-01', puppyIds: [puppyId] })
    await seedDb.collection('dogs').doc(puppyId).set({ tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED', name: 'Buddy', sex: 'male', breed: 'Labrador', colour: 'Gold', status: 'active', dateOfBirth: '2026-01-01', photos: [] })
    const createRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), createRes)
    check('2', 'Showcase created', createRes.statusCode === 200)

    await setEnabledHandler(mockReq({ litterId, enabled: true }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId, visible: true, availability: 'available' }, breeder.idToken), mockRes())

    // Commit 1: rotate a share link.
    const rotateRes = mockRes()
    await rotateShareHandler(mockReq({ litterId }, breeder.idToken), rotateRes)
    check('2', 'Share link created', rotateRes.statusCode === 200 && typeof rotateRes.body.shareToken === 'string')
    const token = rotateRes.body.shareToken

    // Commit 3: upload a photo for the puppy.
    const uploadRes = mockRes()
    await uploadMediaHandler(mockReq({ dogId: puppyId, base64: jpegBase64, kind: 'photo' }, breeder.idToken), uploadRes)
    check('2', 'Photo uploaded to the puppy\'s gallery', uploadRes.statusCode === 200 && uploadRes.body.photos.length === 1)

    // Commit 2: the public page's data source shows the litter, the
    // puppy, AND the just-uploaded photo — proving Commits 1-3 compose
    // correctly end to end, not just in isolation.
    const publicRes = mockRes()
    await showcasePublicHandler(mockGetReq({ token }), publicRes)
    check('2', 'Public read succeeds', publicRes.statusCode === 200)
    check('2', 'The public response includes the litter name', publicRes.body.litter.name === 'FullFlowLitter')
    check('2', 'The public response includes the puppy', publicRes.body.puppies.length === 1 && publicRes.body.puppies[0].name === 'Buddy')
    check('2', 'The public response includes the photo just uploaded via the media pipeline', publicRes.body.puppies[0].photos.length === 1)
    check('2', 'The private litter notes never leaked into the public response', !JSON.stringify(publicRes.body).includes('private'))

    // Commit 4: a buyer submits an enquiry about that exact puppy.
    const enquiryRes = mockRes()
    await enquiryHandler(mockReq({ token, puppyId, name: 'Interested Buyer', email: 'buyer@example.com', message: 'Is Buddy still available?', consent: true }), enquiryRes)
    check('2', 'Enquiry submitted successfully', enquiryRes.statusCode === 200)

    // Commit 4: the breeder reads it back through their own authenticated view.
    await signInWithEmailAndPassword(clientAuth, breeder.email, PW)
    const enquirySnap = await getDocs(query(collection(clientDb, 'showcaseEnquiries'), where('litterId', '==', litterId), where('tenantId', '==', breeder.uid)))
    check('2', 'The breeder can read the enquiry back through their own dashboard query', enquirySnap.size === 1 && enquirySnap.docs[0].data().puppyId === puppyId)
    await signOut(clientAuth)

    // Storage sanity: the uploaded file genuinely exists (Commit 3's own
    // Storage-emulator guarantee, re-confirmed here as part of the whole
    // flow rather than in isolation).
    const path = uploadRes.body.fileUrl.replace(`https://storage.googleapis.com/${bucket.name}/`, '')
    check('2', 'The uploaded photo file genuinely exists in Storage', (await bucket.file(path).exists())[0] === true)
  }

  await summary()
} else {
  skip('Section 2 emulator end-to-end (integration hardening + full flow)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST/FIREBASE_STORAGE_EMULATOR_HOST and start the emulators to run them')
  summary()
}
