// scripts/test-litter-showcase.mjs — regression coverage for the iDogs
// Litter Showcase MVP, Slice 1 (create/edit/enable/disable a Showcase,
// per-puppy visibility + availability, deliberate bulk actions, and the
// authorization boundary around all of it).
//
// Same established pattern as test-h7-litter-delete-ledger-backfill.mjs
// / test-passport-uniqueness.mjs / test-claim-transferred-dogs.mjs:
//   1. Pure-logic unit tests against the REAL api/_lib/showcase-schema.js
//      functions (not a hand-copied mirror).
//   2. Structural assertions on firestore.rules and LittersPage.tsx.
//   3. Emulator-only behavioral tests that import and call the REAL
//      api/*.js handlers directly with mock req/res objects, against a
//      local Firestore/Auth emulator — skipped gracefully (not silently
//      dropped from the pass count) when no emulator is reachable.
//
// Usage:
//   1. firebase emulators:start --only auth,firestore --project demo-idogs-qa
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//      node scripts/test-litter-showcase.mjs

const { readFileSync } = await import('node:fs')
const { makeChecker } = await import('./_lib/test-check.mjs')
const { check, checkAsync, skip, summary } = makeChecker()

// ── Section 1: pure-logic coverage of api/_lib/showcase-schema.js ──
{
  const {
    mergePuppyEntry, validatePuppyPatch, applyBulkAction, validateBulkAction,
    AVAILABILITY_VALUES, DEFAULT_AVAILABILITY, DEFAULT_VISIBLE, ShowcaseValidationError,
  } = await import('../api/_lib/showcase-schema.js')

  check('AVAILABILITY_VALUES is exactly the four Slice-1 states', JSON.stringify(AVAILABILITY_VALUES) === JSON.stringify(['available', 'on_hold', 'reserved', 'unavailable']))
  check('A puppy defaults to hidden', DEFAULT_VISIBLE === false)
  check('A puppy defaults to available', DEFAULT_AVAILABILITY === 'available')

  // Requirement 5: availability changes must never alter visibility, and vice versa.
  {
    const withVisibleTrue = mergePuppyEntry(undefined, { visible: true })
    check('mergePuppyEntry: setting visible on a never-touched puppy defaults availability to "available"', withVisibleTrue.visible === true && withVisibleTrue.availability === 'available')

    const afterAvailabilityOnly = mergePuppyEntry(withVisibleTrue, { availability: 'reserved' })
    check('mergePuppyEntry: changing ONLY availability leaves a previously-set visible=true untouched', afterAvailabilityOnly.visible === true && afterAvailabilityOnly.availability === 'reserved')

    const hiddenReserved = mergePuppyEntry(afterAvailabilityOnly, { visible: false })
    check('mergePuppyEntry: changing ONLY visible leaves the existing availability untouched', hiddenReserved.visible === false && hiddenReserved.availability === 'reserved')
  }

  check('validatePuppyPatch rejects an empty patch', (() => { try { validatePuppyPatch({}); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
  check('validatePuppyPatch rejects an unknown field', (() => { try { validatePuppyPatch({ visible: true, foo: 1 }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
  check('validatePuppyPatch rejects a non-boolean visible', (() => { try { validatePuppyPatch({ visible: 'yes' }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
  check('validatePuppyPatch rejects an out-of-enum availability', (() => { try { validatePuppyPatch({ availability: 'sold' }); return false } catch (e) { return e instanceof ShowcaseValidationError } })())
  check('validatePuppyPatch accepts visible-only', JSON.stringify(validatePuppyPatch({ visible: true })) === JSON.stringify({ visible: true }))
  check('validatePuppyPatch accepts availability-only', JSON.stringify(validatePuppyPatch({ availability: 'on_hold' })) === JSON.stringify({ availability: 'on_hold' }))

  check('validateBulkAction accepts the three defined actions', ['select_all', 'clear_all', 'show_available_only'].every(a => validateBulkAction(a) === a))
  check('validateBulkAction rejects an unknown action', (() => { try { validateBulkAction('show_all_and_sold'); return false } catch (e) { return e instanceof ShowcaseValidationError } })())

  // Requirement 2/3: a brand-new reconciliation (empty existing map) never invents a visible puppy.
  {
    const map = applyBulkAction('select_all', {}, ['p1', 'p2', 'p3'])
    check('applyBulkAction select_all sets every current puppy visible', Object.values(map).every(e => e.visible === true) && Object.keys(map).length === 3)
  }
  {
    const existing = { p1: { visible: true, availability: 'available' }, p2: { visible: true, availability: 'reserved' } }
    const map = applyBulkAction('clear_all', existing, ['p1', 'p2'])
    check('applyBulkAction clear_all hides every current puppy', Object.values(map).every(e => e.visible === false))
    check('applyBulkAction never touches availability', map.p1.availability === 'available' && map.p2.availability === 'reserved')
  }
  {
    const existing = {
      p1: { visible: false, availability: 'available' },
      p2: { visible: true, availability: 'on_hold' },
      p3: { visible: false, availability: 'reserved' },
      p4: { visible: false, availability: 'unavailable' },
    }
    const map = applyBulkAction('show_available_only', existing, ['p1', 'p2', 'p3', 'p4'])
    check('applyBulkAction show_available_only shows ONLY puppies whose stored availability is "available"', map.p1.visible === true && map.p2.visible === false && map.p3.visible === false && map.p4.visible === false)
    // A never-touched puppy (no existing entry) defaults to availability
    // 'available', so show_available_only legitimately includes it.
    const withUntouched = applyBulkAction('show_available_only', existing, ['p1', 'p5'])
    check('applyBulkAction show_available_only includes a never-touched puppy (defaults to "available")', withUntouched.p5.visible === true && withUntouched.p5.availability === 'available')
  }
  {
    // A puppy removed from the litter since the Showcase was last touched
    // must be pruned, not carried forward forever.
    const existing = { p1: { visible: true, availability: 'available' }, removedPup: { visible: true, availability: 'available' } }
    const map = applyBulkAction('select_all', existing, ['p1'])
    check('applyBulkAction drops entries for puppies no longer in litter.puppyIds', !('removedPup' in map) && Object.keys(map).length === 1)
  }
}

// ── Section 2: structural coverage ──
{
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const showcaseBlock = (rules.match(/match \/litterShowcases\/\{litterId\} \{[\s\S]*?\n    \}/) || [''])[0]
  check('firestore.rules has a litterShowcases match block', showcaseBlock.length > 0)
  check('litterShowcases denies all direct client create/update/delete (Admin SDK endpoints only)', /allow create, update, delete: if false;/.test(showcaseBlock))
  check('litterShowcases read is scoped to the owning tenant only (no anonymous/public read in Slice 1)', /allow read: if isSignedIn\(\) && resource\.data\.tenantId == request\.auth\.uid;/.test(showcaseBlock))

  const littersPageSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('LittersPage.tsx manages Showcase via lib/db.ts server-endpoint wrappers, not direct Firestore writes', /createShowcase\(litterId\)/.test(littersPageSrc) && /setShowcaseEnabled\(litterId, !current\.enabled\)/.test(littersPageSrc) && /updateShowcasePuppy\(litterId, puppyId, \{ visible \}\)/.test(littersPageSrc) && /bulkUpdateShowcasePuppies\(litterId, action\)/.test(littersPageSrc))
  check('LittersPage.tsx gates Showcase management to Plus-plan accounts client-side (server is still the authoritative gate)', /profile\?\.plan !== 'plus'/.test(littersPageSrc))
  check('LittersPage.tsx never reads/writes the dogs collection when handling Showcase puppy state (Requirement 7)', !/updateDoc\([^)]*dogs[^)]*visible/.test(littersPageSrc))

  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  check('lib/db.ts Showcase mutations all call trusted server endpoints (never a direct Firestore write to litterShowcases)', /fetch\('\/api\/create-showcase'/.test(dbSrc) && /fetch\('\/api\/set-showcase-enabled'/.test(dbSrc) && /fetch\('\/api\/update-showcase-puppy'/.test(dbSrc) && /fetch\('\/api\/bulk-update-showcase-puppies'/.test(dbSrc))
  check('lib/db.ts Showcase read uses getDoc directly (Rules-scoped to the owning tenant, no server round-trip needed)', /getDoc\(doc\(db, 'litterShowcases', litterId\)\)/.test(dbSrc))
}

// ── Section 3: emulator-only end-to-end behavioral tests ──
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  const { getFirestore } = await import('firebase-admin/firestore')

  // Import the real handlers FIRST so their own initializeApp() (default
  // app) runs before anything else touches the Admin SDK.
  const { default: createShowcaseHandler } = await import('../api/create-showcase.js')
  const { default: setEnabledHandler } = await import('../api/set-showcase-enabled.js')
  const { default: updatePuppyHandler } = await import('../api/update-showcase-puppy.js')
  const { default: bulkHandler } = await import('../api/bulk-update-showcase-puppies.js')

  const seedDb = getFirestore()

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')
  const { getFirestore: getClientFirestore, connectFirestoreEmulator, doc, getDoc, setDoc } = await import('firebase/firestore')

  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'showcase-client')
  const clientAuth = getClientAuth(clientApp)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const clientDb = getClientFirestore(clientApp)
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080)

  function isDenied(err) { return err && (err.code === 'permission-denied' || /permission/i.test(err.message)) }

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
  async function seedLitter(tenantUid, litterId, puppyIds = []) {
    await seedDb.collection('litters').doc(litterId).set({
      tenantId: tenantUid, damId: `dam_${litterId}`, name: 'ShowcaseTestLitter', notes: '', actualBirthDate: '2026-01-01', puppyIds,
    })
  }
  async function seedPuppy(tenantUid, puppyId, litterId) {
    await seedDb.collection('dogs').doc(puppyId).set({
      tenantId: tenantUid, currentOwnerId: tenantUid, createdByUserId: tenantUid,
      sourceType: 'BREEDER_ISSUED', name: puppyId, sex: 'female', status: 'active', dateOfBirth: '2026-01-01', litterId,
    })
  }
  const breederPlusProfile = { role: 'breeder', plan: 'plus', email: 'x@example.com' }

  // ── Test 1: a fresh Showcase exposes zero puppies by default ──
  {
    const breeder = await newUser('sc1breeder', breederPlusProfile)
    const litterId = `litter1_${R}`
    await seedLitter(breeder.uid, litterId, [`p1_${R}`, `p2_${R}`])
    await seedPuppy(breeder.uid, `p1_${R}`, litterId)
    await seedPuppy(breeder.uid, `p2_${R}`, litterId)

    const res = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), res)
    check('1', 'create-showcase succeeds (200)', res.statusCode === 200, JSON.stringify(res.body))
    check('1', 'A brand-new Showcase starts disabled', res.body?.showcase?.enabled === false)
    check('1', 'A brand-new Showcase has an empty puppies map — zero puppies shown by default', JSON.stringify(res.body?.showcase?.puppies) === '{}')

    const secondAttempt = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), secondAttempt)
    check('1', 'A second create attempt for the same litter is rejected (one Showcase per litter)', secondAttempt.statusCode === 409 && secondAttempt.body?.reason === 'SHOWCASE_ALREADY_EXISTS')
  }

  // ── Test 2: only explicitly selected puppies are shown ──
  {
    const breeder = await newUser('sc2breeder', breederPlusProfile)
    const litterId = `litter2_${R}`
    const p1 = `p1_${R}_2`, p2 = `p2_${R}_2`
    await seedLitter(breeder.uid, litterId, [p1, p2])
    await seedPuppy(breeder.uid, p1, litterId)
    await seedPuppy(breeder.uid, p2, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())

    const res = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true }, breeder.idToken), res)
    check('2', 'update-showcase-puppy succeeds', res.statusCode === 200, JSON.stringify(res.body))
    const puppies = res.body.showcase.puppies
    check('2', 'The explicitly-selected puppy is visible', puppies[p1]?.visible === true)
    check('2', 'The untouched sibling puppy stays hidden — no other puppy was implicitly shown', !puppies[p2] || puppies[p2].visible === false)

    const foreignRes = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: `not-in-litter_${R}`, visible: true }, breeder.idToken), foreignRes)
    check('2', 'A puppyId not currently in this litter is rejected (409 PUPPY_NOT_IN_LITTER)', foreignRes.statusCode === 409 && foreignRes.body?.reason === 'PUPPY_NOT_IN_LITTER', JSON.stringify(foreignRes.body))
  }

  // ── Test 3: "Clear all" hides every puppy; "Select all" / "Show available only" ──
  {
    const breeder = await newUser('sc3breeder', breederPlusProfile)
    const litterId = `litter3_${R}`
    const [p1, p2, p3] = [`p1_${R}_3`, `p2_${R}_3`, `p3_${R}_3`]
    await seedLitter(breeder.uid, litterId, [p1, p2, p3])
    for (const p of [p1, p2, p3]) await seedPuppy(breeder.uid, p, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())

    // Give each puppy a distinct availability before testing bulk actions.
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, availability: 'available' }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId: p2, availability: 'on_hold' }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId: p3, availability: 'reserved' }, breeder.idToken), mockRes())

    const selectAllRes = mockRes()
    await bulkHandler(mockReq({ litterId, action: 'select_all' }, breeder.idToken), selectAllRes)
    check('3', 'select_all shows every current puppy', Object.values(selectAllRes.body.showcase.puppies).every(e => e.visible === true))

    const showAvailRes = mockRes()
    await bulkHandler(mockReq({ litterId, action: 'show_available_only' }, breeder.idToken), showAvailRes)
    const p = showAvailRes.body.showcase.puppies
    check('3', 'show_available_only shows the "available" puppy', p[p1].visible === true)
    check('3', 'show_available_only excludes the "on_hold" puppy', p[p2].visible === false)
    check('3', 'show_available_only excludes the "reserved" puppy', p[p3].visible === false)

    const clearAllRes = mockRes()
    await bulkHandler(mockReq({ litterId, action: 'clear_all' }, breeder.idToken), clearAllRes)
    check('3', 'clear_all hides every puppy, including the one just shown by show_available_only', Object.values(clearAllRes.body.showcase.puppies).every(e => e.visible === false))
    check('3', 'clear_all does not alter any puppy\'s availability', clearAllRes.body.showcase.puppies[p2].availability === 'on_hold' && clearAllRes.body.showcase.puppies[p3].availability === 'reserved')
  }

  // ── Test 4: availability changes never alter visibility, end to end ──
  {
    const breeder = await newUser('sc4breeder', breederPlusProfile)
    const litterId = `litter4_${R}`
    const p1 = `p1_${R}_4`
    await seedLitter(breeder.uid, litterId, [p1])
    await seedPuppy(breeder.uid, p1, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())

    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true }, breeder.idToken), mockRes())
    const afterAvailability = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, availability: 'reserved' }, breeder.idToken), afterAvailability)
    check('4', 'Changing availability alone leaves a previously-shown puppy visible', afterAvailability.body.showcase.puppies[p1].visible === true && afterAvailability.body.showcase.puppies[p1].availability === 'reserved')

    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: false }, breeder.idToken), mockRes())
    const afterAvailability2 = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, availability: 'unavailable' }, breeder.idToken), afterAvailability2)
    check('4', 'Changing availability alone leaves a previously-hidden puppy hidden', afterAvailability2.body.showcase.puppies[p1].visible === false && afterAvailability2.body.showcase.puppies[p1].availability === 'unavailable')
  }

  // ── Test 5: cross-tenant and non-owner access is denied on every endpoint ──
  {
    const owner = await newUser('sc5owner', breederPlusProfile)
    const stranger = await newUser('sc5stranger', breederPlusProfile)
    const litterId = `litter5_${R}`
    const p1 = `p1_${R}_5`
    await seedLitter(owner.uid, litterId, [p1])
    await seedPuppy(owner.uid, p1, litterId)
    await createShowcaseHandler(mockReq({ litterId }, owner.idToken), mockRes())

    await seedLitter(owner.uid, `litter5b_${R}`, [])
    const createRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId: `litter5b_${R}` }, stranger.idToken), createRes)
    check('5', 'create-showcase denies a stranger creating a Showcase for someone else\'s litter', createRes.statusCode === 403)

    const enableRes = mockRes()
    await setEnabledHandler(mockReq({ litterId, enabled: true }, stranger.idToken), enableRes)
    check('5', 'set-showcase-enabled denies a stranger', enableRes.statusCode === 403)

    const puppyRes = mockRes()
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true }, stranger.idToken), puppyRes)
    check('5', 'update-showcase-puppy denies a stranger', puppyRes.statusCode === 403)

    const bulkRes = mockRes()
    await bulkHandler(mockReq({ litterId, action: 'select_all' }, stranger.idToken), bulkRes)
    check('5', 'bulk-update-showcase-puppies denies a stranger', bulkRes.statusCode === 403)

    const showcaseAfter = await seedDb.collection('litterShowcases').doc(litterId).get()
    check('5', 'None of the denied cross-tenant attempts mutated the real Showcase document', JSON.stringify(showcaseAfter.data()?.puppies || {}) === '{}')
  }

  // ── Test 6: Owner and Free-plan roles cannot manage Showcases ──
  {
    const owner = await newUser('sc6owner', { role: 'owner', plan: 'plus', email: 'o@example.com' })
    const freeBreeder = await newUser('sc6free', { role: 'breeder', plan: 'free', email: 'f@example.com' })
    const noProfileUser = await newUser('sc6noprofile', null)
    const breeder = await newUser('sc6breeder', breederPlusProfile)
    const litterId = `litter6_${R}`
    await seedLitter(breeder.uid, litterId, [])

    const ownerRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, owner.idToken), ownerRes)
    check('6', 'A Pet Owner role is denied with SHOWCASE_ROLE_GATE (403), even for their OWN litter', ownerRes.statusCode === 403 && ownerRes.body?.reason === 'SHOWCASE_ROLE_GATE')

    const freeRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, freeBreeder.idToken), freeRes)
    check('6', 'A Free-plan breeder is denied with SHOWCASE_PLAN_GATE (403)', freeRes.statusCode === 403 && freeRes.body?.reason === 'SHOWCASE_PLAN_GATE')

    const noProfileRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, noProfileUser.idToken), noProfileRes)
    check('6', 'A user with no profile document at all is denied (fails closed, not open)', noProfileRes.statusCode === 403)

    const okRes = mockRes()
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), okRes)
    check('6', 'Sanity: the actual owning Plus-plan breeder IS allowed', okRes.statusCode === 200)
  }

  // ── Test 7: disabling a Showcase preserves its configuration ──
  {
    const breeder = await newUser('sc7breeder', breederPlusProfile)
    const litterId = `litter7_${R}`
    const p1 = `p1_${R}_7`
    await seedLitter(breeder.uid, litterId, [p1])
    await seedPuppy(breeder.uid, p1, litterId)
    await createShowcaseHandler(mockReq({ litterId }, breeder.idToken), mockRes())
    await updatePuppyHandler(mockReq({ litterId, puppyId: p1, visible: true, availability: 'reserved' }, breeder.idToken), mockRes())

    const disableRes = mockRes()
    await setEnabledHandler(mockReq({ litterId, enabled: false }, breeder.idToken), disableRes)
    check('7', 'Disabling succeeds', disableRes.statusCode === 200 && disableRes.body.showcase.enabled === false)
    check('7', 'Disabling preserves the puppy visible/availability configuration', disableRes.body.showcase.puppies[p1].visible === true && disableRes.body.showcase.puppies[p1].availability === 'reserved')

    const reenableRes = mockRes()
    await setEnabledHandler(mockReq({ litterId, enabled: true }, breeder.idToken), reenableRes)
    check('7', 'Re-enabling does NOT reset puppy selection back to zero — only a brand-new Showcase starts at zero', reenableRes.body.showcase.puppies[p1].visible === true && reenableRes.body.showcase.puppies[p1].availability === 'reserved')
  }

  // ── Test 8: firestore.rules deny direct client writes and scope reads to the owning tenant ──
  {
    const { signInWithEmailAndPassword, signOut } = await import('firebase/auth')
    async function signInAs(u) {
      await signOut(clientAuth).catch(() => {})
      await signInWithEmailAndPassword(clientAuth, u.email, PW)
    }

    const owner = await newUser('sc8owner', breederPlusProfile)
    const stranger = await newUser('sc8stranger', breederPlusProfile)
    const litterId = `litter8_${R}`
    await seedLitter(owner.uid, litterId, [])
    await createShowcaseHandler(mockReq({ litterId }, owner.idToken), mockRes())

    await signInAs(owner)
    let readAllowed = false
    try { const snap = await getDoc(doc(clientDb, 'litterShowcases', litterId)); readAllowed = snap.exists() } catch { readAllowed = false }
    check('8', 'The owning tenant can read their own Showcase directly via the client SDK', readAllowed)

    let directWriteDenied = false
    try { await setDoc(doc(clientDb, 'litterShowcases', litterId), { enabled: true }, { merge: true }) } catch (err) { directWriteDenied = isDenied(err) }
    check('8', 'A direct client write to litterShowcases (even by the owning tenant) is denied — Admin SDK endpoints only', directWriteDenied)

    await signInAs(stranger)
    let strangerReadDenied = false
    try { await getDoc(doc(clientDb, 'litterShowcases', litterId)) } catch (err) { strangerReadDenied = isDenied(err) }
    check('8', 'A stranger cannot read someone else\'s Showcase directly', strangerReadDenied)

    await signOut(clientAuth).catch(() => {})
  }

  await summary()
} else {
  skip('Section 3 (emulator end-to-end behavioral tests)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
  await summary()
}
