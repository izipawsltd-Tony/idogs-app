// scripts/test-reconcile-litter-puppy.mjs — regression coverage for
// api/reconcile-litter-puppy.js (Codex fix-round, Finding 3), which had
// NO dedicated test file before this one despite being the actual fix
// for Tony's live-staging report ("Not authorized to upload media for
// this dog" on the second puppy of an owned litter).
//
// Root-cause recap: that error was NOT an ownership/authorization bug —
// api/_lib/dog-access.js's canAddDogRecord() correctly, consistently
// blocks writes to ANY dog with status:'restricted', for every puppy,
// every time. The puppies Tony hit this on were genuinely restricted —
// over the plan's dog limit BEFORE litter puppies became cap-exempt
// (Pricing v1.2) — and a LEGACY restriction like that (no
// restrictionReason recorded — see api/_lib/dog-cap.js's header comment)
// is deliberately never auto-reactivated by anything. This endpoint is
// the correct, existing, narrowly-scoped fix; the actual gap was that
// LittersPage.tsx's Showcase panel gave a breeder no way to reach it (or
// even understand why the upload failed) from where they were actually
// working — see src/lib/db.ts's reconcileLitterPuppy() and
// LittersPage.tsx's ShowcaseManager for the client-side fix that reuses
// this endpoint inline.
//
// Usage: node scripts/test-reconcile-litter-puppy.mjs
//   Section 1 (structural) always runs.
//   Section 2 (emulator end-to-end) needs FIRESTORE_EMULATOR_HOST and
//   FIREBASE_AUTH_EMULATOR_HOST set.

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'

const { check, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — structural
// =========================================================================
{
  const src = readFileSync(new URL('../api/reconcile-litter-puppy.js', import.meta.url), 'utf8')
  check('requires a valid Firebase ID token', /verifyIdToken/.test(src))
  check('requires the caller to be BOTH currentOwnerId and tenantId — never a former breeder or a buyer who merely claimed it',
    /dog\.currentOwnerId !== uid \|\| dog\.tenantId !== uid/.test(src))
  check('refuses a dog with no litterId (not a litter puppy at all)', /NOT_A_LITTER_PUPPY/.test(src))
  check('refuses an already-retained puppy (it counts toward the cap like any other dog now)', /ALREADY_RETAINED/.test(src))
  check('refuses a deceased dog', /DECEASED/.test(src))
  check('is idempotent — calling it on an already-active dog is a success, not an error', /alreadyActive:\s*true/.test(src))
  check('refuses anything not currently status:\'restricted\' (other than the idempotent active case)', /INVALID_STATUS_TRANSITION/.test(src))
  check('NEVER reactivates a restrictionReason:\'manual\' dog — the one deliberate, non-cap restriction path', /MANUALLY_RESTRICTED/.test(src) && /restrictionReason === 'manual'/.test(src))
  check('independently validates REAL litter ownership (not just the stored litterId string) before writing anything',
    /collection\('litters'\)\.doc\(dog\.litterId\)/.test(src) && /litter\.tenantId !== uid/.test(src))
  check('the write clears restrictionReason via FieldValue.delete() — a stale reason must never linger past reactivation', /restrictionReason: FieldValue\.delete\(\)/.test(src))
  check('scoped to exactly one dog per call (a single dogId body field, never a batch/account sweep)', /const \{ dogId \} = body/.test(src) && !/\.where\(/.test(src))

  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  check('src/lib/db.ts wraps this endpoint (reconcileLitterPuppy) in the same pattern as every other Showcase call',
    /export async function reconcileLitterPuppy\(dogId: string\)/.test(dbSrc) &&
    /fetch\('\/api\/reconcile-litter-puppy'/.test(dbSrc))

  const littersPageSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('LittersPage imports reconcileLitterPuppy from lib/db', /reconcileLitterPuppy/.test(littersPageSrc.slice(0, littersPageSrc.indexOf('function ShowcaseManager'))))
  check('ShowcaseManager disables the inline media manager for a restricted puppy (never lets the breeder attempt a doomed upload)',
    /mediaOpenFor === puppy\.id && !isPuppyRestricted/.test(littersPageSrc))
  check('ShowcaseManager offers the one-click "Reconcile this puppy" action for the legacy-restricted-litter-puppy case specifically',
    /isRestrictedLitterPuppyCandidate[\s\S]{0,1000}?Reconcile this puppy/.test(littersPageSrc))
  check('ShowcaseManager shows a DIFFERENT, non-reconcile message for a genuinely-restricted (over-cap or manually-restricted) puppy',
    /over your plan's dog limit and is read-only/.test(littersPageSrc))

  const uploadSrc = readFileSync(new URL('../api/upload-showcase-media.js', import.meta.url), 'utf8')
  const updateSrc = readFileSync(new URL('../api/update-showcase-media.js', import.meta.url), 'utf8')
  check('upload-showcase-media.js\'s 403 distinguishes DOG_RESTRICTED from NOT_OWNER (diagnostic only — the write is still denied either way)',
    /reason = hasDogWriteAccess\(dog, uid\) && dog\?\.status === 'restricted' \? 'DOG_RESTRICTED' : 'NOT_OWNER'/.test(uploadSrc))
  check('update-showcase-media.js\'s 403 distinguishes DOG_RESTRICTED from NOT_OWNER the same way',
    /reason = hasDogWriteAccess\(dog, uid\) && dog\?\.status === 'restricted' \? 'DOG_RESTRICTED' : 'NOT_OWNER'/.test(updateSrc))
}

// =========================================================================
// SECTION 2 — emulator end-to-end
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')

  const { getFirestore } = await import('firebase-admin/firestore')
  const { default: reconcileHandler } = await import('../api/reconcile-litter-puppy.js')

  const seedDb = getFirestore()

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')
  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'reconcile-litter-puppy-client')
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
  async function newUser(name) {
    const email = `${name}.${R}@emulator.local`
    const { user } = await createUserWithEmailAndPassword(clientAuth, email, PW)
    return { uid: user.uid, idToken: await user.getIdToken() }
  }
  async function seedLitter(tenantUid, litterId) {
    await seedDb.collection('litters').doc(litterId).set({
      tenantId: tenantUid, damId: `dam_${litterId}`, name: 'ReconcileTestLitter', notes: '', actualBirthDate: '2026-01-01', puppyIds: [],
    })
  }
  async function seedPuppy(uid, dogId, extra = {}) {
    await seedDb.collection('dogs').doc(dogId).set({
      tenantId: uid, currentOwnerId: uid, createdByUserId: uid, sourceType: 'BREEDER_ISSUED',
      name: dogId, sex: 'female', status: 'active', dateOfBirth: '2026-01-01', photos: [], videos: [], ...extra,
    })
  }

  // ── Test 1: the exact real-world case — a legacy restricted litter
  // puppy (no restrictionReason recorded) is reconciled successfully ──
  {
    const owner = await newUser('r1owner')
    const litterId = `r1litter_${R}`
    const dogId = `r1dog_${R}`
    await seedLitter(owner.uid, litterId)
    await seedPuppy(owner.uid, dogId, { litterId, status: 'restricted' })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('1', 'A legacy restricted litter puppy (no restrictionReason) is reconciled to active', res.statusCode === 200 && res.body.status === 'active')
    const after = (await seedDb.collection('dogs').doc(dogId).get()).data()
    check('1', 'restrictionReason is absent after reconciliation', after.restrictionReason === undefined)
    check('1', 'status is genuinely active in Firestore, not just in the response', after.status === 'active')
  }

  // ── Test 2: idempotent — calling it again (or on an already-active
  // dog) is a success, not an error ──
  {
    const owner = await newUser('r2owner')
    const litterId = `r2litter_${R}`
    const dogId = `r2dog_${R}`
    await seedLitter(owner.uid, litterId)
    await seedPuppy(owner.uid, dogId, { litterId, status: 'active' })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('2', 'Reconciling an already-active puppy is a success (idempotent no-op)', res.statusCode === 200 && res.body.status === 'active' && res.body.alreadyActive === true)
  }

  // ── Test 3: refuses a 'plan_cap_exceeded' puppy too — that's the
  // AUTOMATIC reconciliation's job (api/_lib/dog-cap.js), not this
  // endpoint's. This endpoint should still handle it safely regardless
  // (same success path — it's still a genuinely restricted, unretained,
  // still-with-originating-breeder litter puppy), proving the two
  // reconciliation paths don't conflict. ──
  {
    const owner = await newUser('r3owner')
    const litterId = `r3litter_${R}`
    const dogId = `r3dog_${R}`
    await seedLitter(owner.uid, litterId)
    await seedPuppy(owner.uid, dogId, { litterId, status: 'restricted', restrictionReason: 'plan_cap_exceeded' })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('3', 'A plan_cap_exceeded-tagged litter puppy is also reconciled successfully through this endpoint', res.statusCode === 200 && res.body.status === 'active')
  }

  // ── Test 4: NEVER reactivates a manually-restricted dog, even if it
  // otherwise looks exactly like an eligible litter puppy ──
  {
    const owner = await newUser('r4owner')
    const litterId = `r4litter_${R}`
    const dogId = `r4dog_${R}`
    await seedLitter(owner.uid, litterId)
    await seedPuppy(owner.uid, dogId, { litterId, status: 'restricted', restrictionReason: 'manual' })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('4', 'A manually-restricted dog is refused (409)', res.statusCode === 409 && res.body?.reason === 'MANUALLY_RESTRICTED')
    const after = (await seedDb.collection('dogs').doc(dogId).get()).data()
    check('4', 'Its status is genuinely unchanged in Firestore', after.status === 'restricted' && after.restrictionReason === 'manual')
  }

  // ── Test 5: refuses an already-retained puppy ──
  {
    const owner = await newUser('r5owner')
    const litterId = `r5litter_${R}`
    const dogId = `r5dog_${R}`
    await seedLitter(owner.uid, litterId)
    await seedPuppy(owner.uid, dogId, { litterId, status: 'restricted', retainedByBreeder: true })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('5', 'An already-retained puppy is refused (409 ALREADY_RETAINED)', res.statusCode === 409 && res.body?.reason === 'ALREADY_RETAINED')
  }

  // ── Test 6: refuses a dog with no litterId at all (a standalone
  // adult dog, restricted for an ordinary over-cap reason) ──
  {
    const owner = await newUser('r6owner')
    const dogId = `r6dog_${R}`
    await seedPuppy(owner.uid, dogId, { status: 'restricted' })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('6', 'A non-litter dog is refused (409 NOT_A_LITTER_PUPPY)', res.statusCode === 409 && res.body?.reason === 'NOT_A_LITTER_PUPPY')
  }

  // ── Test 7: a stranger/wrong tenant is denied — fail-closed, no
  // client-supplied field can establish ownership ──
  {
    const owner = await newUser('r7owner')
    const stranger = await newUser('r7stranger')
    const litterId = `r7litter_${R}`
    const dogId = `r7dog_${R}`
    await seedLitter(owner.uid, litterId)
    await seedPuppy(owner.uid, dogId, { litterId, status: 'restricted' })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, stranger.idToken), res)
    check('7', 'A stranger is denied (403 Not your dog)', res.statusCode === 403)
    const after = (await seedDb.collection('dogs').doc(dogId).get()).data()
    check('7', 'The dog is genuinely untouched', after.status === 'restricted')
  }

  // ── Test 8: a FORMER owner (transferred away — currentOwnerId no
  // longer the caller, even though tenantId still is) is denied ──
  {
    const owner = await newUser('r8owner')
    const buyer = await newUser('r8buyer')
    const litterId = `r8litter_${R}`
    const dogId = `r8dog_${R}`
    await seedLitter(owner.uid, litterId)
    await seedPuppy(owner.uid, dogId, { litterId, status: 'restricted', currentOwnerId: buyer.uid })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('8', 'A former owner (transferred away) is denied (403)', res.statusCode === 403)
  }

  // ── Test 9: a dangling/forged litterId — the referenced litter
  // document doesn't exist at all — is denied, not silently allowed ──
  {
    const owner = await newUser('r9owner')
    const dogId = `r9dog_${R}`
    await seedPuppy(owner.uid, dogId, { litterId: `nonexistent_litter_${R}`, status: 'restricted' })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('9', 'A dangling litterId (litter document does not exist) is denied (409 LITTER_NOT_FOUND)', res.statusCode === 409 && res.body?.reason === 'LITTER_NOT_FOUND')
  }

  // ── Test 10: the litterId string points at a REAL litter, but one
  // owned by a DIFFERENT tenant — proves this endpoint validates real
  // litter ownership, not just trusting the stored string ──
  {
    const owner = await newUser('r10owner')
    const otherBreeder = await newUser('r10other')
    const litterId = `r10litter_${R}`
    const dogId = `r10dog_${R}`
    await seedLitter(otherBreeder.uid, litterId)
    await seedPuppy(owner.uid, dogId, { litterId, status: 'restricted' })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('10', 'A litterId pointing at someone ELSE\'s real litter is denied (403 LITTER_OWNERSHIP_MISMATCH)', res.statusCode === 403 && res.body?.reason === 'LITTER_OWNERSHIP_MISMATCH')
  }

  // ── Test 11: missing/forged identifiers ──
  {
    const owner = await newUser('r11owner')
    const res1 = mockRes()
    await reconcileHandler(mockReq({}, owner.idToken), res1)
    check('11', 'A missing dogId is rejected (400)', res1.statusCode === 400)

    const res2 = mockRes()
    await reconcileHandler(mockReq({ dogId: `nonexistent_dog_${R}` }, owner.idToken), res2)
    check('11', 'A nonexistent dogId is rejected (404)', res2.statusCode === 404)

    const res3 = mockRes()
    await reconcileHandler(mockReq({ dogId: `x_${R}` }, null), res3)
    check('11', 'An unauthenticated request is rejected (401)', res3.statusCode === 401)
  }

  // ── Test 12: a deceased dog is refused ──
  {
    const owner = await newUser('r12owner')
    const litterId = `r12litter_${R}`
    const dogId = `r12dog_${R}`
    await seedLitter(owner.uid, litterId)
    await seedPuppy(owner.uid, dogId, { litterId, status: 'restricted', isDeceased: true })

    const res = mockRes()
    await reconcileHandler(mockReq({ dogId }, owner.idToken), res)
    check('12', 'A deceased dog is refused (409 DECEASED)', res.statusCode === 409 && res.body?.reason === 'DECEASED')
  }

  summary()
} else {
  skip('Section 2 emulator end-to-end (reconcile-litter-puppy)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulators to run them')
  summary()
}
