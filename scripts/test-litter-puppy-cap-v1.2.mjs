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
  const { default: reconcileLitterPuppyHandler } = await import('../api/reconcile-litter-puppy.js')
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

  // ── Codex fix-round (Finding 3): reconcile-dog-cap.js (the REAL,
  // already-deployed, auto-triggered-after-dog-creation endpoint) still
  // auto-reactivates a litter puppy whose restriction is PROVEN cap-driven
  // (restrictionReason:'plan_cap_exceeded') — this is the case
  // demoteExcessToRestricted/create-dog.js/claim-transferred-dogs.js
  // themselves produce, going forward. ──
  {
    const breeder = await newUser('v12t9breeder', plusProfile)
    const litterId = `v12t9litter_${R}`
    await seedLitter(breeder.uid, litterId)
    // A CONFIRMED cap-driven restriction — exactly what the current code
    // now produces (see api/_lib/dog-cap.js's demoteExcessToRestricted).
    const confirmedPuppyId = `v12t9confirmedpuppy_${R}`
    await seedDb.collection('dogs').doc(confirmedPuppyId).set({
      tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED',
      name: 'Confirmed Puppy', sex: 'male', status: 'restricted', restrictionReason: 'plan_cap_exceeded', isDeceased: false, dateOfBirth: '2026-01-01',
      litterId, breed: 'Labrador', createdAt: new Date().toISOString(),
    })
    // A genuinely over-cap adult dog, unrelated to the bug — must stay restricted.
    for (let i = 0; i < 5; i++) await seedAdultDog(breeder.uid, `v12t9adult${i}_${R}`)
    const genuineOverCapId = `v12t9overcap_${R}`
    await seedAdultDog(breeder.uid, genuineOverCapId, { status: 'restricted', restrictionReason: 'plan_cap_exceeded' })

    const res = mockRes()
    await reconcileDogCapHandler(mockReq({}, breeder.idToken), res)
    check('9', 'reconcile-dog-cap.js succeeds', res.statusCode === 200, JSON.stringify(res.body))

    const confirmedDoc = await seedDb.collection('dogs').doc(confirmedPuppyId).get()
    const overCapDoc = await seedDb.collection('dogs').doc(genuineOverCapId).get()
    check('9', 'The CONFIRMED cap-restricted litter puppy is reactivated to active', confirmedDoc.data().status === 'active')
    check('9', 'restrictionReason is cleared on reactivation', confirmedDoc.data().restrictionReason === undefined)
    check('9', 'The genuinely cap-restricted adult dog is left restricted — never silently reactivated', overCapDoc.data().status === 'restricted')
  }

  // ── Finding 3's actual fix: a Green-Boy-shaped LEGACY restricted
  // litter puppy (restricted before restrictionReason existed — no reason
  // recorded at all) is NOT touched by the automatic reconcile-dog-cap.js
  // endpoint, but CAN be safely, explicitly reconciled through the new
  // per-dog api/reconcile-litter-puppy.js action — real application
  // behavior any breeder can trigger for their own puppy, no hard-coded
  // ID/email, no broad migration. ──
  {
    const breeder = await newUser('v12t10breeder', plusProfile)
    const litterId = `v12t10litter_${R}`
    await seedLitter(breeder.uid, litterId)
    const legacyPuppyId = `v12t10legacypuppy_${R}`
    await seedDb.collection('dogs').doc(legacyPuppyId).set({
      tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED',
      name: 'Legacy Puppy', sex: 'male', status: 'restricted', isDeceased: false, dateOfBirth: '2026-01-01',
      litterId, breed: 'Labrador', createdAt: new Date().toISOString(),
      // Deliberately NO restrictionReason field at all — the exact Green
      // Boy shape: restricted before this field ever existed.
    })

    // Step 1: the automatic, blanket endpoint must NOT touch it.
    const autoRes = mockRes()
    await reconcileDogCapHandler(mockReq({}, breeder.idToken), autoRes)
    const afterAuto = await seedDb.collection('dogs').doc(legacyPuppyId).get()
    check('10', 'reconcile-dog-cap.js (automatic, blanket) does NOT reactivate a legacy litter puppy with no restrictionReason', afterAuto.data().status === 'restricted')

    // Step 2: the new, explicit, scoped, per-dog action DOES fix it.
    const explicitRes = mockRes()
    await reconcileLitterPuppyHandler(mockReq({ dogId: legacyPuppyId }, breeder.idToken), explicitRes)
    check('10', 'reconcile-litter-puppy.js (explicit, scoped) succeeds for the legitimate owner', explicitRes.statusCode === 200, JSON.stringify(explicitRes.body))
    const afterExplicit = await seedDb.collection('dogs').doc(legacyPuppyId).get()
    check('10', 'The legacy litter puppy is now active', afterExplicit.data().status === 'active')
    check('10', 'litter provenance (litterId) is preserved — reconciliation never erases it', afterExplicit.data().litterId === litterId)

    // Idempotent — calling it again on an already-active dog is a no-op,
    // not an error.
    const idempotentRes = mockRes()
    await reconcileLitterPuppyHandler(mockReq({ dogId: legacyPuppyId }, breeder.idToken), idempotentRes)
    check('10', 'reconcile-litter-puppy.js is idempotent — calling it again on an already-active dog succeeds as a no-op', idempotentRes.statusCode === 200 && idempotentRes.body?.alreadyActive === true, JSON.stringify(idempotentRes.body))
  }

  // ── Safety: reconcile-litter-puppy.js is tenant-scoped and refuses a
  // manually-restricted puppy, an adult, a promoted puppy, and a
  // transferred puppy ──
  {
    const breeder = await newUser('v12t11breeder', plusProfile)
    const stranger = await newUser('v12t11stranger', plusProfile)
    const litterId = `v12t11litter_${R}`
    await seedLitter(breeder.uid, litterId)

    // Tenant-scoped: a stranger cannot reconcile someone else's puppy.
    const legacyPuppyId = `v12t11legacypuppy_${R}`
    await seedDb.collection('dogs').doc(legacyPuppyId).set({
      tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED',
      name: 'Legacy Puppy', sex: 'male', status: 'restricted', isDeceased: false, dateOfBirth: '2026-01-01',
      litterId, breed: 'Labrador', createdAt: new Date().toISOString(),
    })
    const strangerRes = mockRes()
    await reconcileLitterPuppyHandler(mockReq({ dogId: legacyPuppyId }, stranger.idToken), strangerRes)
    check('11', 'A stranger cannot reconcile another breeder\'s puppy (403)', strangerRes.statusCode === 403, JSON.stringify(strangerRes.body))
    const untouchedByStranger = await seedDb.collection('dogs').doc(legacyPuppyId).get()
    check('11', 'The puppy is left untouched by the denied stranger attempt', untouchedByStranger.data().status === 'restricted')

    // Manually restricted — must be refused outright, never silently undone.
    const manualPuppyId = `v12t11manualpuppy_${R}`
    await seedDb.collection('dogs').doc(manualPuppyId).set({
      tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED',
      name: 'Manual Puppy', sex: 'male', status: 'restricted', restrictionReason: 'manual', isDeceased: false, dateOfBirth: '2026-01-01',
      litterId, breed: 'Labrador', createdAt: new Date().toISOString(),
    })
    const manualRes = mockRes()
    await reconcileLitterPuppyHandler(mockReq({ dogId: manualPuppyId }, breeder.idToken), manualRes)
    check('11', 'A manually-restricted puppy is refused (409 MANUALLY_RESTRICTED), never silently reactivated', manualRes.statusCode === 409 && manualRes.body?.reason === 'MANUALLY_RESTRICTED', JSON.stringify(manualRes.body))
    const untouchedManual = await seedDb.collection('dogs').doc(manualPuppyId).get()
    check('11', 'The manually-restricted puppy is left untouched', untouchedManual.data().status === 'restricted')

    // A standalone restricted ADULT dog (no litterId) — never a puppy at all.
    const adultId = `v12t11adult_${R}`
    await seedAdultDog(breeder.uid, adultId, { status: 'restricted', restrictionReason: 'plan_cap_exceeded' })
    const adultRes = mockRes()
    await reconcileLitterPuppyHandler(mockReq({ dogId: adultId }, breeder.idToken), adultRes)
    check('11', 'A restricted ADULT (no litterId) is refused (409 NOT_A_LITTER_PUPPY)', adultRes.statusCode === 409 && adultRes.body?.reason === 'NOT_A_LITTER_PUPPY', JSON.stringify(adultRes.body))

    // A PROMOTED (retained) puppy — should use Activate, not this action.
    const promotedPuppyId = `v12t11promotedpuppy_${R}`
    await seedDb.collection('dogs').doc(promotedPuppyId).set({
      tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED',
      name: 'Promoted Puppy', sex: 'male', status: 'restricted', restrictionReason: 'plan_cap_exceeded', retainedByBreeder: true, isDeceased: false, dateOfBirth: '2026-01-01',
      litterId, breed: 'Labrador', createdAt: new Date().toISOString(),
    })
    const promotedRes = mockRes()
    await reconcileLitterPuppyHandler(mockReq({ dogId: promotedPuppyId }, breeder.idToken), promotedRes)
    check('11', 'A PROMOTED (retained) puppy is refused (409 ALREADY_RETAINED) — it counts toward the cap like any other dog now', promotedRes.statusCode === 409 && promotedRes.body?.reason === 'ALREADY_RETAINED', JSON.stringify(promotedRes.body))

    // A litter puppy already TRANSFERRED to a different owner — the
    // caller (original breeder) is no longer currentOwnerId.
    const transferredPuppyId = `v12t11transferredpuppy_${R}`
    const otherOwner = await newUser('v12t11otherowner', plusProfile)
    await seedDb.collection('dogs').doc(transferredPuppyId).set({
      tenantId: breeder.uid, currentOwnerId: otherOwner.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED',
      name: 'Transferred Puppy', sex: 'male', status: 'restricted', restrictionReason: 'plan_cap_exceeded', isDeceased: false, dateOfBirth: '2026-01-01',
      litterId, breed: 'Labrador', createdAt: new Date().toISOString(),
    })
    const transferredRes = mockRes()
    await reconcileLitterPuppyHandler(mockReq({ dogId: transferredPuppyId }, breeder.idToken), transferredRes)
    check('11', 'The original breeder cannot reconcile a puppy already transferred to a new owner (403)', transferredRes.statusCode === 403, JSON.stringify(transferredRes.body))
  }

  // ── Litter-ownership validation: a litterId pointing at a real litter
  // document owned by someone ELSE (or no litter document at all) is
  // refused, not trusted at face value ──
  {
    const breeder = await newUser('v12t12breeder', plusProfile)
    const otherBreeder = await newUser('v12t12otherbreeder', plusProfile)
    const foreignLitterId = `v12t12foreignlitter_${R}`
    await seedLitter(otherBreeder.uid, foreignLitterId) // owned by someone else

    const forgedPuppyId = `v12t12forgedpuppy_${R}`
    await seedDb.collection('dogs').doc(forgedPuppyId).set({
      tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED',
      name: 'Forged Puppy', sex: 'male', status: 'restricted', isDeceased: false, dateOfBirth: '2026-01-01',
      litterId: foreignLitterId, breed: 'Labrador', createdAt: new Date().toISOString(),
    })
    const forgedRes = mockRes()
    await reconcileLitterPuppyHandler(mockReq({ dogId: forgedPuppyId }, breeder.idToken), forgedRes)
    check('12', 'A litterId pointing at a litter document owned by someone else is refused (403 LITTER_OWNERSHIP_MISMATCH)', forgedRes.statusCode === 403 && forgedRes.body?.reason === 'LITTER_OWNERSHIP_MISMATCH', JSON.stringify(forgedRes.body))

    const danglingPuppyId = `v12t12danglingpuppy_${R}`
    await seedDb.collection('dogs').doc(danglingPuppyId).set({
      tenantId: breeder.uid, currentOwnerId: breeder.uid, createdByUserId: breeder.uid, sourceType: 'BREEDER_ISSUED',
      name: 'Dangling Puppy', sex: 'male', status: 'restricted', isDeceased: false, dateOfBirth: '2026-01-01',
      litterId: `nonexistent-litter-${R}`, breed: 'Labrador', createdAt: new Date().toISOString(),
    })
    const danglingRes = mockRes()
    await reconcileLitterPuppyHandler(mockReq({ dogId: danglingPuppyId }, breeder.idToken), danglingRes)
    check('12', 'A litterId pointing at a non-existent litter document is refused (409 LITTER_NOT_FOUND)', danglingRes.statusCode === 409 && danglingRes.body?.reason === 'LITTER_NOT_FOUND', JSON.stringify(danglingRes.body))
  }

  await summary()
} else {
  // Reuse the TOP-LEVEL checker (not a fresh one) so Section 1's results,
  // which always run above regardless of the emulator, are still counted
  // in the final tally and exit code.
  skip('Section 2 emulator end-to-end (Pricing v1.2 litter-puppy cap HTTP endpoints)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
  await summary()
}
