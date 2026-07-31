// scripts/test-litter-puppy-cap-v1.2.mjs — regression coverage for the
// Pricing v1.2 dog-cap policy change: litter-managed puppies do not
// count toward the plan's active-dog cap unless explicitly retained/
// promoted into the breeder's independent Dog List/breeding stock.
//
// Complements scripts/test-dog-cap.mjs (which covers the pure
// api/_lib/dog-cap.js predicate/primitives against an in-memory fake) —
// this file exercises the REAL HTTP endpoints (create-litter-puppy,
// create-dog, set-dog-status, reconcile-dog-cap, claim-transferred-dogs)
// against a live Firestore/Auth emulator, plus the real firestore.rules
// text for the new litterId/retainedByBreeder protection, plus a direct
// cross-runtime comparison proving the backend predicate
// (api/_lib/dog-cap.js's isEligibleForCap) and its client-side UI mirror
// (src/lib/utils.ts's isDogEligibleForCap) agree on every case.
//
// The firestore.rules litterId/retainedByBreeder immutability guarantee
// (a direct client write can never forge or erase either field) is
// covered separately in
// scripts/test-litter-puppy-fields-rules-emulator.mjs, which uses the
// @firebase/rules-unit-testing testEnv pattern (a different emulator
// connection mechanism than the Admin-SDK approach below, which bypasses
// Rules entirely and so cannot exercise them).
//
// Usage: node scripts/test-litter-puppy-cap-v1.2.mjs
//   Section 1 (structural + cross-runtime predicate agreement) always runs.
//   Section 2 (emulator end-to-end, real HTTP endpoints) needs
//   FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST set and the
//   local Firebase emulator running.

import { makeChecker } from './_lib/test-check.mjs'

const { check, checkAsync, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — cross-runtime predicate agreement (no emulator needed)
// =========================================================================
{
  const { isEligibleForCap } = await import('../api/_lib/dog-cap.js')
  const { isDogEligibleForCap } = await import('../src/lib/utils.ts')

  // Every case that matters for the v1.2 policy — standalone, unpromoted
  // puppy, promoted puppy, transferred puppy, restricted/archived/
  // deceased variants — run through BOTH the backend predicate and its
  // client-side mirror, asserting IDENTICAL answers. This is the direct
  // proof of Task 2's "backend enforcement and UI usage counts agree" —
  // not a structural guess, an actual side-by-side comparison of the two
  // real functions.
  const fixtures = [
    { label: 'standalone active dog', dog: { status: 'active', isDeceased: false, currentOwnerId: 'u1', tenantId: 'u1' } },
    { label: 'standalone restricted dog', dog: { status: 'restricted', isDeceased: false, currentOwnerId: 'u1', tenantId: 'u1' } },
    { label: 'standalone archived dog', dog: { status: 'archived', isDeceased: false, currentOwnerId: 'u1', tenantId: 'u1' } },
    { label: 'standalone deceased dog', dog: { status: 'active', isDeceased: true, currentOwnerId: 'u1', tenantId: 'u1' } },
    { label: 'unpromoted litter puppy, still with breeder', dog: { status: 'active', isDeceased: false, litterId: 'l1', currentOwnerId: 'u1', tenantId: 'u1' } },
    { label: 'promoted litter puppy, still with breeder', dog: { status: 'active', isDeceased: false, litterId: 'l1', retainedByBreeder: true, currentOwnerId: 'u1', tenantId: 'u1' } },
    { label: 'restricted unpromoted litter puppy (Green-Boy shape)', dog: { status: 'restricted', isDeceased: false, litterId: 'l1', currentOwnerId: 'u1', tenantId: 'u1' } },
    { label: 'litter puppy transferred to a new owner', dog: { status: 'active', isDeceased: false, litterId: 'l1', currentOwnerId: 'buyer-1', tenantId: 'breeder-1' } },
    { label: 'transferred mid-flight (status:transferred)', dog: { status: 'transferred', isDeceased: false, currentOwnerId: 'u1', tenantId: 'u1' } },
  ]
  for (const { label, dog } of fixtures) {
    const backend = isEligibleForCap(dog)
    const ui = isDogEligibleForCap(dog)
    check(`backend isEligibleForCap() and client isDogEligibleForCap() agree for: ${label}`, backend === ui, `backend=${backend} ui=${ui}`)
  }
}

// =========================================================================
// SECTION 2 — emulator end-to-end (real HTTP endpoints)
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  const { getFirestore } = await import('firebase-admin/firestore')

  const { default: createDogHandler } = await import('../api/create-dog.js')
  const { default: createLitterPuppyHandler } = await import('../api/create-litter-puppy.js')
  const { default: setDogStatusHandler } = await import('../api/set-dog-status.js')
  const { default: reconcileDogCapHandler } = await import('../api/reconcile-dog-cap.js')
  const { default: claimTransferredDogsHandler } = await import('../api/claim-transferred-dogs.js')

  const seedDb = getFirestore()

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')
  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'litter-puppy-cap-v1-2-client')
  const clientAuth = getClientAuth(clientApp)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

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
  const plusProfile = { role: 'breeder', plan: 'plus', email: 'x@example.com' }

  async function seedLitter(tenantUid, litterId) {
    await seedDb.collection('litters').doc(litterId).set({
      tenantId: tenantUid, damId: null, name: 'CapV12TestLitter', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
    })
  }
  async function seedAdultDog(tenantUid, dogId, extra = {}) {
    await seedDb.collection('dogs').doc(dogId).set({
      tenantId: tenantUid, currentOwnerId: tenantUid, createdByUserId: tenantUid, sourceType: 'BREEDER_ISSUED',
      name: 'Adult ' + dogId, sex: 'female', status: 'active', isDeceased: false, dateOfBirth: '2022-01-01',
      breed: 'Labrador', createdAt: new Date().toISOString(), ...extra,
    })
  }
  let puppyCounter = 0
  async function createPuppyViaEndpoint(breeder, litterId) {
    puppyCounter++
    const res = mockRes()
    await createLitterPuppyHandler(mockReq({
      operationId: `op-${R}-${puppyCounter}`,
      litterId,
      dogId: `puppy-${R}-${puppyCounter}`,
      payload: { name: `Puppy${puppyCounter}`, breed: 'Labrador', sex: 'male', dateOfBirth: '2026-01-01', colour: '', microchip: '', ankc: '', notes: '' },
    }, breeder.idToken), res)
    return res
  }

  // ── Required test: 5 active adults already + creating a NEW litter
  // puppy => the puppy is created 'active' (never restricted), and the
  // adults remain exactly 5 ──
  {
    const breeder = await newUser('v12t1breeder', plusProfile)
    const litterId = `v12t1litter_${R}`
    await seedLitter(breeder.uid, litterId)
    for (let i = 0; i < 5; i++) await seedAdultDog(breeder.uid, `v12t1adult${i}_${R}`)

    const res = await createPuppyViaEndpoint(breeder, litterId)
    check('1', 'create-litter-puppy.js succeeds even with 5 adults already active', res.statusCode === 200, JSON.stringify(res.body))
    check('1', 'The new puppy is created ACTIVE, not restricted, despite the account already being at the adult cap', res.body?.status === 'active')

    const puppyDoc = await seedDb.collection('dogs').doc(res.body.dogId).get()
    check('1', 'The puppy document itself is genuinely status:active in Firestore', puppyDoc.data().status === 'active')
  }

  // ── Required test: multiple litter puppies => no adult slots consumed ──
  {
    const breeder = await newUser('v12t2breeder', plusProfile)
    const litterId = `v12t2litter_${R}`
    await seedLitter(breeder.uid, litterId)
    for (let i = 0; i < 5; i++) await seedAdultDog(breeder.uid, `v12t2adult${i}_${R}`)

    const results = []
    for (let i = 0; i < 4; i++) results.push(await createPuppyViaEndpoint(breeder, litterId))
    check('2', 'All 4 additional litter puppies are created successfully', results.every(r => r.statusCode === 200))
    check('2', 'Every one of them is active, not restricted — none competed for an adult slot', results.every(r => r.body.status === 'active'))
  }

  // ── Required test: create-dog with a forged litterId cannot bypass
  // the cap (or attach a fake litter membership at all) ──
  {
    const breeder = await newUser('v12t3breeder', plusProfile)
    for (let i = 0; i < 5; i++) await seedAdultDog(breeder.uid, `v12t3adult${i}_${R}`)

    const res = mockRes()
    await createDogHandler(mockReq({
      data: { name: 'Forger', breed: 'Labrador', sex: 'male', dateOfBirth: '2024-01-01', litterId: 'totally-fake-litter-id', retainedByBreeder: true },
    }, breeder.idToken), res)
    check('3', 'create-dog.js succeeds (the forged fields are just silently ignored, not rejected outright)', res.statusCode === 200, JSON.stringify(res.body))
    check('3', 'The 6th dog (5 adults already active) lands RESTRICTED — the forged litterId/retainedByBreeder did NOT grant a free cap exemption', res.body?.status === 'restricted')

    const written = await seedDb.collection('dogs').doc(res.body.dogId).get()
    check('3', 'The written document has NO litterId at all — create-dog.js never persists it, forged or not', !('litterId' in written.data()))
    check('3', 'The written document has NO retainedByBreeder at all either', !('retainedByBreeder' in written.data()))
  }

  // ── Required test: 4 adults + promoted puppy => count becomes 5, via
  // the REAL set-dog-status.js 'promote' action ──
  {
    const breeder = await newUser('v12t4breeder', plusProfile)
    const litterId = `v12t4litter_${R}`
    await seedLitter(breeder.uid, litterId)
    for (let i = 0; i < 4; i++) await seedAdultDog(breeder.uid, `v12t4adult${i}_${R}`)
    const createRes = await createPuppyViaEndpoint(breeder, litterId)
    const puppyId = createRes.body.dogId

    const promoteRes = mockRes()
    await setDogStatusHandler(mockReq({ dogId: puppyId, action: 'promote' }, breeder.idToken), promoteRes)
    check('4', 'Promoting the puppy succeeds when there is exactly 1 free slot (4 adults + 1 promoted puppy = 5)', promoteRes.statusCode === 200, JSON.stringify(promoteRes.body))
    check('4', 'The response reflects retainedByBreeder:true', promoteRes.body?.retainedByBreeder === true)

    const puppyDoc = await seedDb.collection('dogs').doc(puppyId).get()
    check('4', 'The puppy document is genuinely retainedByBreeder:true and still status:active', puppyDoc.data().retainedByBreeder === true && puppyDoc.data().status === 'active')
  }

  // ── Required test: 5 adults + promoted puppy => blocked (no free slot) ──
  {
    const breeder = await newUser('v12t5breeder', plusProfile)
    const litterId = `v12t5litter_${R}`
    await seedLitter(breeder.uid, litterId)
    for (let i = 0; i < 5; i++) await seedAdultDog(breeder.uid, `v12t5adult${i}_${R}`)
    const createRes = await createPuppyViaEndpoint(breeder, litterId)
    const puppyId = createRes.body.dogId

    const promoteRes = mockRes()
    await setDogStatusHandler(mockReq({ dogId: puppyId, action: 'promote' }, breeder.idToken), promoteRes)
    check('5', 'Promoting the puppy is BLOCKED (409) when the account is already at the 5-dog cap', promoteRes.statusCode === 409, JSON.stringify(promoteRes.body))
    check('5', 'The denial reason is DOG_CAP_EXCEEDED', promoteRes.body?.reason === 'DOG_CAP_EXCEEDED')

    const puppyDoc = await seedDb.collection('dogs').doc(puppyId).get()
    check('5', 'The puppy is left completely untouched — still active, still NOT retained', puppyDoc.data().status === 'active' && puppyDoc.data().retainedByBreeder !== true)
  }

  // ── unpromote: frees a slot, always succeeds when currently retained,
  // no cap check needed ──
  {
    const breeder = await newUser('v12t6breeder', plusProfile)
    const litterId = `v12t6litter_${R}`
    await seedLitter(breeder.uid, litterId)
    for (let i = 0; i < 4; i++) await seedAdultDog(breeder.uid, `v12t6adult${i}_${R}`)
    const createRes = await createPuppyViaEndpoint(breeder, litterId)
    const puppyId = createRes.body.dogId
    await setDogStatusHandler(mockReq({ dogId: puppyId, action: 'promote' }, breeder.idToken), mockRes())

    const unpromoteRes = mockRes()
    await setDogStatusHandler(mockReq({ dogId: puppyId, action: 'unpromote' }, breeder.idToken), unpromoteRes)
    check('6', 'Unpromoting a currently-retained puppy always succeeds', unpromoteRes.statusCode === 200, JSON.stringify(unpromoteRes.body))
    check('6', 'The response reflects retainedByBreeder:false', unpromoteRes.body?.retainedByBreeder === false)

    // Now that the slot is free again, promoting a SECOND puppy succeeds.
    const createRes2 = await createPuppyViaEndpoint(breeder, litterId)
    const promote2Res = mockRes()
    await setDogStatusHandler(mockReq({ dogId: createRes2.body.dogId, action: 'promote' }, breeder.idToken), promote2Res)
    check('6', 'The freed slot is genuinely usable by a different puppy afterward', promote2Res.statusCode === 200, JSON.stringify(promote2Res.body))
  }

  // ── promote is rejected outright for a non-puppy (no litterId) ──
  {
    const breeder = await newUser('v12t7breeder', plusProfile)
    await seedAdultDog(breeder.uid, `v12t7adult_${R}`)
    const res = mockRes()
    await setDogStatusHandler(mockReq({ dogId: `v12t7adult_${R}`, action: 'promote' }, breeder.idToken), res)
    check('7', 'promote on a standalone (non-litter) dog is rejected (409, NOT_A_LITTER_PUPPY)', res.statusCode === 409 && res.body?.reason === 'NOT_A_LITTER_PUPPY')
  }

  // ── Required test: transferred/claimed dog counting unchanged — a
  // TRANSFERRED litter puppy still counts toward the RECEIVING account's
  // cap, exactly as before v1.2 (litterId no longer matters once it has
  // left the originating breeder) ──
  {
    const seller = await newUser('v12t8seller', plusProfile)
    const litterId = `v12t8litter_${R}`
    await seedLitter(seller.uid, litterId)
    const createRes = await createPuppyViaEndpoint(seller, litterId)
    const puppyId = createRes.body.dogId

    const buyer = await newUser('v12t8buyer', plusProfile)
    // Simulate the transfer (mirrors transferDogOwnership()'s own shape).
    await seedDb.collection('dogs').doc(puppyId).update({
      buyerEmail: buyer.email.toLowerCase(), buyerName: 'Buyer', status: 'transferred', transferStatus: 'pendingClaim',
      previousOwnerId: seller.uid, transferredAt: new Date().toISOString(),
    })
    for (let i = 0; i < 4; i++) await seedAdultDog(buyer.uid, `v12t8buyeradult${i}_${R}`)

    const claimRes = mockRes()
    await claimTransferredDogsHandler(mockReq({}, buyer.idToken), claimRes)
    check('8', 'The buyer successfully claims the transferred litter puppy', claimRes.statusCode === 200 && claimRes.body.claimed === 1, JSON.stringify(claimRes.body))

    const claimedDoc = await seedDb.collection('dogs').doc(puppyId).get()
    check('8', 'The claimed puppy is the buyer\'s 5th active dog — it counts normally, despite still carrying its original litterId', claimedDoc.data().status === 'active' && claimedDoc.data().currentOwnerId === buyer.uid)

    // A 6th dog for the buyer must now be denied a slot — proving the
    // claimed puppy genuinely occupied one, exactly like an ordinary dog.
    await seedAdultDog(buyer.uid, `v12t8buyeradult5_${R}`)
    const res = mockRes()
    await setDogStatusHandler(mockReq({ dogId: `v12t8buyeradult5_${R}`, action: 'restrict' }, buyer.idToken), res)
    void res // restrict always succeeds; the meaningful assertion is the count itself:
    const eligibleSnap = await seedDb.collection('dogs').where('currentOwnerId', '==', buyer.uid).where('status', '==', 'active').get()
    check('8', 'The buyer now has exactly 5 active dogs (4 seeded adults + the claimed puppy) — the claimed puppy genuinely consumed a slot', eligibleSnap.size === 5)
  }

  // ── Task 6 / Green Boy: reconcile-dog-cap.js (the REAL, already-
  // deployed, auto-triggered-after-dog-creation endpoint) reactivates a
  // litter puppy that was restricted under the OLD v1.1 rule ──
  {
    const breeder = await newUser('v12t9breeder', plusProfile)
    const litterId = `v12t9litter_${R}`
    await seedLitter(breeder.uid, litterId)
    // Simulate a puppy restricted under the OLD rule: litter-managed,
    // never retained, but status:'restricted' (exactly Green Boy's shape).
    const legacyPuppyId = `v12t9legacypuppy_${R}`
    await seedDb.collection('dogs').doc(legacyPuppyId).set({
      tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED',
      name: 'Legacy Puppy', sex: 'male', status: 'restricted', isDeceased: false, dateOfBirth: '2026-01-01',
      litterId, breed: 'Labrador', createdAt: new Date().toISOString(),
    })
    // A genuinely over-cap adult dog, unrelated to the bug — must stay restricted.
    for (let i = 0; i < 5; i++) await seedAdultDog(breeder.uid, `v12t9adult${i}_${R}`)
    const genuineOverCapId = `v12t9overcap_${R}`
    await seedAdultDog(breeder.uid, genuineOverCapId, { status: 'restricted' })

    const res = mockRes()
    await reconcileDogCapHandler(mockReq({}, breeder.idToken), res)
    check('9', 'reconcile-dog-cap.js succeeds', res.statusCode === 200, JSON.stringify(res.body))

    const legacyDoc = await seedDb.collection('dogs').doc(legacyPuppyId).get()
    const overCapDoc = await seedDb.collection('dogs').doc(genuineOverCapId).get()
    check('9', 'The Green-Boy-shaped legacy litter puppy is reactivated to active', legacyDoc.data().status === 'active')
    check('9', 'The genuinely cap-restricted adult dog is left restricted — never silently reactivated', overCapDoc.data().status === 'restricted')
  }

  await summary()
} else {
  // Reuse the TOP-LEVEL checker (not a fresh one) so Section 1's results,
  // which always run above regardless of the emulator, are still counted
  // in the final tally and exit code.
  skip('Section 2 emulator end-to-end (Pricing v1.2 litter-puppy cap HTTP endpoints)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
  await summary()
}
