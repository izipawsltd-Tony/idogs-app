// scripts/test-showcase-enquiry.mjs — regression coverage for the
// Litter Showcase public "Customer enquiries" feature (Slice 2, commit
// 4/5). Nothing here existed before this commit — confirmed via a
// pre-implementation audit that grepped the whole repo for
// enquir(e)/inquir(e) and found zero matches anywhere.
//
// Trust model under test, matching api/showcase-public.js's own
// precedent: tenantId/litterId are NEVER accepted as raw client input —
// they are resolved server-side from the caller-supplied share TOKEN,
// the same hash-lookup + isShareLive() check the read endpoint uses.
// This is what makes "tenant-scope enquiries and retain litter/puppy
// attribution" a real security property rather than just a field that
// happens to be named correctly.
//
// Usage: node scripts/test-showcase-enquiry.mjs
//   Section 1 (structural + pure-function) always runs.
//   Section 2 (emulator end-to-end) needs FIRESTORE_EMULATOR_HOST +
//   FIREBASE_AUTH_EMULATOR_HOST set and the local Firebase emulator
//   running (Storage is not needed for this file).

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { sanitizeEnquiryInput, EnquiryValidationError } from '../api/_lib/enquiry-schema.js'

const { check, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — structural + pure-function tests (no emulator needed)
// =========================================================================
{
  // ── sanitizeEnquiryInput() ──
  const validInput = { name: 'Jane Buyer', email: 'jane@example.com', message: 'Interested in the black male puppy', consent: true }

  check('sanitizeEnquiryInput: a fully valid submission (email) passes and normalizes cleanly', (() => {
    const r = sanitizeEnquiryInput(validInput)
    return r.name === 'Jane Buyer' && r.email === 'jane@example.com' && r.phone === null && r.consent === true && r.honeypotFilled === false
  })())
  check('sanitizeEnquiryInput: a fully valid submission (phone only, no email) passes', (() => {
    const r = sanitizeEnquiryInput({ ...validInput, email: undefined, phone: '0412 345 678' })
    return r.email === null && r.phone === '0412 345 678'
  })())
  check('sanitizeEnquiryInput: missing name throws', (() => {
    try { sanitizeEnquiryInput({ ...validInput, name: '' }); return false }
    catch (e) { return e instanceof EnquiryValidationError }
  })())
  check('sanitizeEnquiryInput: name that is only whitespace throws (trimmed to empty)', (() => {
    try { sanitizeEnquiryInput({ ...validInput, name: '   ' }); return false }
    catch (e) { return e instanceof EnquiryValidationError }
  })())
  check('sanitizeEnquiryInput: missing BOTH email and phone throws', (() => {
    try { sanitizeEnquiryInput({ ...validInput, email: undefined }); return false }
    catch (e) { return e instanceof EnquiryValidationError }
  })())
  check('sanitizeEnquiryInput: a malformed email throws', (() => {
    try { sanitizeEnquiryInput({ ...validInput, email: 'not-an-email' }); return false }
    catch (e) { return e instanceof EnquiryValidationError }
  })())
  check('sanitizeEnquiryInput: a malformed phone (letters) throws', (() => {
    try { sanitizeEnquiryInput({ ...validInput, email: undefined, phone: 'call me maybe' }); return false }
    catch (e) { return e instanceof EnquiryValidationError }
  })())
  check('sanitizeEnquiryInput: missing message throws', (() => {
    try { sanitizeEnquiryInput({ ...validInput, message: '' }); return false }
    catch (e) { return e instanceof EnquiryValidationError }
  })())
  check('sanitizeEnquiryInput: consent !== true (missing) throws', (() => {
    try { sanitizeEnquiryInput({ ...validInput, consent: undefined }); return false }
    catch (e) { return e instanceof EnquiryValidationError }
  })())
  check('sanitizeEnquiryInput: consent as a truthy non-boolean ("yes") is still rejected — must be the literal boolean true', (() => {
    try { sanitizeEnquiryInput({ ...validInput, consent: 'yes' }); return false }
    catch (e) { return e instanceof EnquiryValidationError }
  })())
  check('sanitizeEnquiryInput: a non-object payload throws instead of crashing', (() => {
    try { sanitizeEnquiryInput('not an object'); return false }
    catch (e) { return e instanceof EnquiryValidationError }
  })())
  check('sanitizeEnquiryInput: control characters are stripped from free-text fields', (() => {
    const r = sanitizeEnquiryInput({ ...validInput, name: 'Jane\x00\x07Buyer' })
    return r.name === 'JaneBuyer'
  })())
  check('sanitizeEnquiryInput: an overlong name is truncated, not rejected outright', (() => {
    const r = sanitizeEnquiryInput({ ...validInput, name: 'A'.repeat(500) })
    return r.name.length === 200
  })())
  check('sanitizeEnquiryInput: an overlong message is truncated, not rejected outright', (() => {
    const r = sanitizeEnquiryInput({ ...validInput, message: 'B'.repeat(5000) })
    return r.message.length === 3000
  })())
  check('sanitizeEnquiryInput: the honeypot ("website") field being filled sets honeypotFilled — never throws, so a bot gets no distinguishing error signal', (() => {
    const r = sanitizeEnquiryInput({ ...validInput, website: 'http://spam.example' })
    return r.honeypotFilled === true
  })())
  check('sanitizeEnquiryInput: an empty/absent honeypot field is honeypotFilled: false', sanitizeEnquiryInput(validInput).honeypotFilled === false)
  check('sanitizeEnquiryInput: a valid puppyRef string passes through trimmed (Codex fix-round: opaque reference, resolved server-side by the caller)', sanitizeEnquiryInput({ ...validInput, puppyRef: '  abc123opaque  ' }).puppyRef === 'abc123opaque')
  check('sanitizeEnquiryInput: an absent puppyRef normalizes to null (general litter enquiry)', sanitizeEnquiryInput(validInput).puppyRef === null)

  // ── firestore.rules ──
  const rulesSrc = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  check('firestore.rules declares a showcaseEnquiries match block', /match \/showcaseEnquiries\/\{enquiryId\}/.test(rulesSrc))
  const enquiryRuleMatch = /match \/showcaseEnquiries\/\{enquiryId\} \{([\s\S]*?)\n    \}/.exec(rulesSrc)
  check('showcaseEnquiries rule block was found for inspection', !!enquiryRuleMatch)
  if (enquiryRuleMatch) {
    const block = enquiryRuleMatch[1]
    check('showcaseEnquiries read is scoped to the owning tenant only (isSignedIn + tenantId match, same posture as litters/litterShowcases)',
      /allow read: if isSignedIn\(\) && resource\.data\.tenantId == request\.auth\.uid/.test(block))
    check('showcaseEnquiries deliberately has NO resource==null guard (that pattern is for single-doc getDoc() lookups, not list queries — see this collection\'s own rule comment)',
      !/resource == null/.test(block))
    check('showcaseEnquiries denies every direct client write outright — the public submission must go through the trusted Admin SDK endpoint',
      /allow create, update, delete: if false/.test(block))
  }

  // ── api/create-showcase-enquiry.js ──
  const enquirySrc = readFileSync(new URL('../api/create-showcase-enquiry.js', import.meta.url), 'utf8')
  check('create-showcase-enquiry.js rate-limits BEFORE any token lookup or validation',
    enquirySrc.indexOf('checkDurableRateLimit') < enquirySrc.indexOf("collection('litterShowcases')"))
  check('create-showcase-enquiry.js uses the DURABLE (Firestore-transaction-backed) rate limiter, not the in-memory one (Codex fix-round: "Rate limiting")',
    /from '\.\/_lib\/durable-rate-limit\.js'/.test(enquirySrc) && !/checkRateLimit\(/.test(enquirySrc))
  check('create-showcase-enquiry.js uses a namespaced rate-limit key distinct from both api/passport.js and api/showcase-public.js',
    /checkDurableRateLimit\(\s*\n\s*db,\s*\n\s*'showcase-enquiry',/.test(enquirySrc))
  check('create-showcase-enquiry.js uses a STRICTER rate limit than the read endpoint (a lower default max)',
    /ENQUIRY_RATE_LIMIT_MAX_REQUESTS.*\|\| 5/.test(enquirySrc))
  check('create-showcase-enquiry.js resolves tenantId from the token-matched Showcase, never from client-supplied input',
    /tenantId: showcase\.tenantId/.test(enquirySrc) && !/req\.body\.tenantId/.test(enquirySrc) && !/body\.tenantId/.test(enquirySrc))
  check('create-showcase-enquiry.js resolves litterId from the Showcase document id, never from client-supplied input',
    /litterId,\s*\n\s*puppyId: resolvedPuppyId/.test(enquirySrc) && !/req\.body\.litterId/.test(enquirySrc) && !/body\.litterId/.test(enquirySrc))
  check('create-showcase-enquiry.js verifies the Litter belongs to the same tenant as the Showcase before accepting any enquiry (Codex fix-round: "Tenant-chain validation")',
    /litterSnap\.data\(\)\.tenantId !== showcase\.tenantId/.test(enquirySrc))
  check('create-showcase-enquiry.js resolves a submitted puppyRef via the SHARED resolveVisiblePuppyByRef() helper (Codex re-review: single source of truth, also used by api/showcase-media.js)',
    /import \{ resolveVisiblePuppyByRef \} from '\.\/_lib\/showcase-media-access\.js'/.test(enquirySrc) &&
    /resolveVisiblePuppyByRef\(db, showcase, litterId, sanitized\.puppyRef, litterPuppyIds\)/.test(enquirySrc))
  check('create-showcase-enquiry.js builds litterPuppyIds from the ALREADY-fetched litterSnap — no extra Firestore read for the legacy-litterId fallback',
    /const litterPuppyIds = new Set\(litterSnap\.data\(\)\.puppyIds \|\| \[\]\)/.test(enquirySrc))
  check('resolveVisiblePuppyByRef() (shared helper) delegates tenant/litterId verification to the single-source-of-truth isValidShowcasePuppyDoc() — never a separately-maintained duplicate check',
    /isValidShowcasePuppyDoc\(dogId, dog, showcase\.tenantId, litterId, litterPuppyIds\)/.test(readFileSync(new URL('../api/_lib/showcase-media-access.js', import.meta.url), 'utf8')))
  check('create-showcase-enquiry.js never accepts a raw dogId as puppyRef — sanitizeEnquiryInput() only ever exposes puppyRef, never puppyId',
    !/sanitized\.puppyId/.test(enquirySrc))
  check('create-showcase-enquiry.js checks isShareLive() before accepting any submission',
    /isShareLive\(showcase\)/.test(enquirySrc))
  check('create-showcase-enquiry.js returns a FAKE success (never a distinguishing error) when the honeypot is tripped',
    /if \(sanitized\.honeypotFilled\)[\s\S]{0,80}res\.status\(200\)\.json\(\{ success: true \}\)/.test(enquirySrc))
  check('create-showcase-enquiry.js writes createdAt as a trusted server timestamp, never a client-supplied value',
    /createdAt: FieldValue\.serverTimestamp\(\)/.test(enquirySrc))

  // ── db.ts ──
  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  check('getEnquiriesForLitter uses where() only, never orderBy() (this project\'s own composite-index-avoidance convention)',
    /getEnquiriesForLitter[\s\S]{0,300}where\('litterId', '==', litterId\)/.test(dbSrc) && !/getEnquiriesForLitter[\s\S]{0,400}orderBy/.test(dbSrc))
  check('getEnquiriesForLitter ALSO filters on tenantId == uid() — required for the list query to be provably safe under firestore.rules (confirmed empirically; a litterId-only filter throws a Rules evaluation error — see this function\'s own comment)',
    /getEnquiriesForLitter[\s\S]{0,400}where\('tenantId', '==', uid\(\)\)/.test(dbSrc))
  check('getEnquiriesForLitter sorts client-side after the query', /enquiries\.sort\(/.test(dbSrc))

  // ── ShowcasePublicPage.tsx ──
  const pageSrc = readFileSync(new URL('../src/pages/ShowcasePublicPage.tsx', import.meta.url), 'utf8')
  check('ShowcasePublicPage posts to api/create-showcase-enquiry with the token and the OPAQUE puppyRef (never a raw dogId field name)',
    /fetch\('\/api\/create-showcase-enquiry'/.test(pageSrc) && /token, puppyRef: selectedPuppy \|\| undefined/.test(pageSrc))
  check('The enquiry form includes a honeypot field named "website"', /name="website"/.test(pageSrc))
  check('The honeypot field is visually/semantically hidden (aria-hidden, off-screen, unreachable by tab order)',
    /aria-hidden="true"[\s\S]{0,400}tabIndex=\{-1\}/.test(pageSrc))
  check('The consent checkbox is required before the form can be submitted', /required checked=\{form\.consent\}/.test(pageSrc) && /disabled=\{state === 'sending' \|\| !form\.consent\}/.test(pageSrc))

  // Tony live-staging finding, round 1: the confirmation copy read as
  // claiming an email notification was sent, with no indication of
  // where. At the time, this endpoint only ever persisted a Firestore
  // document — no email was ever sent — so that round's fix reworded
  // the copy to stop over-claiming.
  //
  // Tony live-staging finding, round 2 ("enquiry destination unclear"):
  // even the reworded copy still didn't say WHERE the enquiry went or
  // whether the breeder would ever actually see it. This round adds a
  // REAL best-effort email notification (see the create-showcase-
  // enquiry.js checks below) and makes the frontend copy depend on the
  // server's own `notified` result — never optimistic, never assumed.
  check('The success copy branches on the server-reported `notified` flag, never a hardcoded optimistic claim',
    /notified\s*\?[\s\S]{0,80}Enquiry sent successfully[\s\S]{0,80}The breeder has been notified/.test(pageSrc))
  check('The "not notified" branch accurately describes persistence only, matching this round\'s required UX copy exactly',
    /Enquiry submitted successfully/.test(pageSrc) && /The breeder can view it in iDogs\./.test(pageSrc))
  check('`notified` is read from the server JSON response, never assumed true on a bare 200',
    /setNotified\(data\.notified === true\)/.test(pageSrc))
  check('The visitor email field is labeled as their own contact info, not the enquiry destination',
    /Your email <span[^>]*>\(so the breeder can contact you back\)<\/span>/.test(pageSrc))
  check('The success UI never displays the breeder\'s own destination email address anywhere in this component',
    !/breederEmail/.test(pageSrc))

  // ── create-showcase-enquiry.js DOES now send a real best-effort email
  // notification — via the SAME existing Resend provider/domain/sender
  // this codebase already uses (api/send-email.js, api/survey.js), never
  // a new one — confirms the copy above matches actual behavior. The
  // actual send logic lives in api/_lib/showcase-notification.js (a
  // Firebase-free pure module, so it can be unit-tested directly without
  // real credentials — see scripts/test-showcase-fix-round2.mjs); this
  // file only checks create-showcase-enquiry.js correctly imports and
  // calls it. ──
  check('create-showcase-enquiry.js imports sendShowcaseEnquiryNotification (and sendShowcaseEnquiryConfirmation) from the shared _lib module, never redefining either inline',
    /import \{ sendShowcaseEnquiryNotification, sendShowcaseEnquiryConfirmation \} from '\.\/_lib\/showcase-notification\.js'/.test(enquirySrc))
  check('create-showcase-enquiry.js actually calls sendShowcaseEnquiryNotification (imported, not just referenced)',
    /await sendShowcaseEnquiryNotification\(\{/.test(enquirySrc))
  check('create-showcase-enquiry.js actually calls sendShowcaseEnquiryConfirmation (imported, not just referenced)',
    /await sendShowcaseEnquiryConfirmation\(\{/.test(enquirySrc))
  {
    const notificationLibSrc = readFileSync(new URL('../api/_lib/showcase-notification.js', import.meta.url), 'utf8')
    check('api/_lib/showcase-notification.js sends via Resend, the SAME provider api/send-email.js and api/survey.js already use — not a new one',
      /api\.resend\.com\/emails/.test(notificationLibSrc))
    check('api/_lib/showcase-notification.js uses the SAME verified sender domain (noreply@idogs.com.au) — no new domain/credential introduced',
      /noreply@idogs\.com\.au/.test(notificationLibSrc))
    check('api/_lib/showcase-notification.js gracefully no-ops (does not throw or block) when RESEND_API_KEY is unset — the current real state on idogs-app-staging',
      /if \(!RESEND_API_KEY\) return \{ notified: false, errorCode: null \}/.test(notificationLibSrc))
    check('api/_lib/showcase-notification.js has NO Firebase Admin SDK import at all — stays independently unit-testable without real credentials',
      !/firebase-admin/.test(notificationLibSrc))
  }
  check('create-showcase-enquiry.js resolves the recipient EXCLUSIVELY via Firebase Auth getUser(showcase.tenantId) — never from req.body/sanitized input',
    /getAuth\(\)\.getUser\(showcase\.tenantId\)/.test(enquirySrc) &&
    !/getUser\(\s*(req\.body|body|sanitized)/.test(enquirySrc))
  check('create-showcase-enquiry.js never reads any client-supplied recipient/to/breederEmail field from the request body',
    !/body\.(to|toEmail|to_email|recipient|breederEmail)\b/.test(enquirySrc))
  check('a failed/unresolved recipient (getUser throws) is caught, never left to crash the whole request',
    /try \{\s*\n\s*const breederUser = await getAuth\(\)\.getUser\(showcase\.tenantId\)/.test(enquirySrc) && /catch \{\s*\n\s*breederEmail = null\s*\n\s*\}/.test(enquirySrc))
  check('the Firestore enquiry write always includes `notified`, regardless of the email outcome — storage is never conditioned on notification success',
    /notified,\s*\n\s*\.\.\.\(notificationErrorCode \? \{ notificationErrorCode \} : \{\}\)/.test(enquirySrc))
  check('a notification failure is logged with a fixed reason code only — never a raw provider error, email address, or credential',
    /console\.error\('create-showcase-enquiry notification:', \{ code: notificationErrorCode \}\)/.test(enquirySrc) &&
    !/console\.error\([^)]*breederEmail/.test(enquirySrc))
  check('the API response never echoes back the resolved breederEmail (only the boolean `notified`)',
    /res\.status\(200\)\.json\(\{ success: true, notified \}\)/.test(enquirySrc) && !/notified, breederEmail/.test(enquirySrc))

  // ── ShowcaseEnquiry type ──
  const typesSrc = readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8')
  check('ShowcaseEnquiry type declares tenantId/litterId/puppyId', /interface ShowcaseEnquiry \{[\s\S]{0,200}tenantId: string[\s\S]{0,100}litterId: string[\s\S]{0,100}puppyId: string \| null/.test(typesSrc))
}

// =========================================================================
// SECTION 2 — emulator end-to-end
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  const { getFirestore } = await import('firebase-admin/firestore')
  const { hashClientKey, getClientIp } = await import('../api/_lib/rate-limit.js')
  const { __resetDurableRateLimitForTests } = await import('../api/_lib/durable-rate-limit.js')
  const { opaquePuppyRef } = await import('../api/_lib/showcase-media-access.js')

  const { default: createShowcaseHandler } = await import('../api/create-showcase.js')
  const { default: updatePuppyHandler } = await import('../api/update-showcase-puppy.js')
  const { default: setEnabledHandler } = await import('../api/set-showcase-enabled.js')
  const { default: rotateShareHandler } = await import('../api/rotate-showcase-share.js')
  const { default: enquiryHandler } = await import('../api/create-showcase-enquiry.js')

  const seedDb = getFirestore()

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } = await import('firebase/auth')
  const { getFirestore: getClientFirestore, connectFirestoreEmulator, collection, query, where, getDocs } = await import('firebase/firestore')

  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'showcase-enquiry-client')
  const clientAuth = getClientAuth(clientApp)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const clientDb = getClientFirestore(clientApp)
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080)

  function isDenied(err) { return err && (err.code === 'permission-denied' || /permission/i.test(err.message)) }
  function mockReq(body) { return { method: 'POST', headers: {}, body } }
  function mockAuthedReq(body, token) { return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body } }

  // Every mockReq() above carries no IP-identifying header at all, so
  // getClientIp() falls back to the same 'unknown' value on every call —
  // meaning every test in this file shares ONE durable rate-limit bucket
  // ('showcase-enquiry:unknown'). Resetting it (rather than giving each
  // test its own fake IP) mirrors the ORIGINAL in-memory limiter's own
  // __resetForTests() semantics (a full clear) closely enough to keep
  // this file's existing test structure intact.
  const sharedRateLimitKey = hashClientKey(getClientIp({ headers: {} }))
  async function resetRateLimit() {
    await __resetDurableRateLimitForTests(seedDb, 'showcase-enquiry', sharedRateLimitKey)
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
  async function newUser(name) {
    const email = `${name}.${R}@emulator.local`
    const { user } = await createUserWithEmailAndPassword(clientAuth, email, PW)
    const idToken = await user.getIdToken()
    await signOut(clientAuth)
    return { uid: user.uid, idToken, email }
  }
  async function seedLitter(tenantUid, litterId, puppyIds = []) {
    await seedDb.collection('litters').doc(litterId).set({
      tenantId: tenantUid, damId: `dam_${litterId}`, name: 'EnquiryTestLitter', notes: '', actualBirthDate: '2026-01-01', puppyIds,
    })
  }
  async function seedPuppy(tenantUid, puppyId, litterId) {
    await seedDb.collection('dogs').doc(puppyId).set({
      tenantId: tenantUid, currentOwnerId: tenantUid, createdByUserId: tenantUid,
      sourceType: 'BREEDER_ISSUED', name: 'EnquiryTestPup', sex: 'female', status: 'active', dateOfBirth: '2026-01-01', litterId,
    })
  }
  const breederPlusProfile = { role: 'breeder', plan: 'plus', email: 'x@example.com' }

  async function setupLiveShowcase(prefix, puppyIds = []) {
    const breeder = await newUser(`${prefix}breeder`)
    await seedDb.collection('users').doc(breeder.uid).set(breederPlusProfile)
    const litterId = `${prefix}litter_${R}`
    await seedLitter(breeder.uid, litterId, puppyIds)
    for (const p of puppyIds) await seedPuppy(breeder.uid, p, litterId)
    await createShowcaseHandler(mockAuthedReq({ litterId }, breeder.idToken), mockRes())
    await setEnabledHandler(mockAuthedReq({ litterId, enabled: true }, breeder.idToken), mockRes())
    for (const p of puppyIds) {
      await updatePuppyHandler(mockAuthedReq({ litterId, puppyId: p, visible: true, availability: 'available' }, breeder.idToken), mockRes())
    }
    const rotateRes = mockRes()
    await rotateShareHandler(mockAuthedReq({ litterId }, breeder.idToken), rotateRes)
    return { breeder, litterId, token: rotateRes.body.shareToken }
  }

  const validBody = { name: 'Jane Buyer', email: 'jane@example.com', message: 'Interested in this litter!', consent: true }

  // ── Test 1: a valid enquiry against a live token succeeds, and the
  // WRITTEN document's tenantId/litterId come from the token, never from
  // client input (even when the client tries to inject its own) ──
  {
    await resetRateLimit()
    const { breeder, litterId, token } = await setupLiveShowcase('e1')
    const strangerTenantId = 'INJECTED_TENANT_SHOULD_BE_IGNORED'
    const strangerLitterId = 'INJECTED_LITTER_SHOULD_BE_IGNORED'
    const res = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token, tenantId: strangerTenantId, litterId: strangerLitterId }), res)
    check('1', 'A valid enquiry against a live token succeeds (200)', res.statusCode === 200, JSON.stringify(res.body))

    const snap = await seedDb.collection('showcaseEnquiries').where('litterId', '==', litterId).get()
    check('1', 'Exactly one enquiry document was written', snap.size === 1)
    const doc = snap.docs[0].data()
    check('1', 'tenantId on the written document is the REAL owner, not the injected value', doc.tenantId === breeder.uid && doc.tenantId !== strangerTenantId)
    check('1', 'litterId on the written document is the REAL litter, not the injected value', doc.litterId === litterId && doc.litterId !== strangerLitterId)
    check('1', 'name/email/message were stored as submitted', doc.name === 'Jane Buyer' && doc.email === 'jane@example.com' && doc.message === 'Interested in this litter!')
    check('1', 'puppyId is null for a general (non-puppy-specific) enquiry', doc.puppyId === null)
  }

  // ── Test 2: field validation is enforced server-side (a direct API
  // caller bypassing the public page's own client-side checks) ──
  {
    await resetRateLimit()
    const { token } = await setupLiveShowcase('e2')
    const missingName = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token, name: '' }), missingName)
    check('2', 'Missing name is rejected (400)', missingName.statusCode === 400)

    const noContact = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token, email: undefined }), noContact)
    check('2', 'Missing both email and phone is rejected (400)', noContact.statusCode === 400)

    const badEmail = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token, email: 'not-an-email' }), badEmail)
    check('2', 'A malformed email is rejected (400)', badEmail.statusCode === 400)

    const noConsent = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token, consent: false }), noConsent)
    check('2', 'consent:false is rejected (400)', noConsent.statusCode === 400)
  }

  // ── Test 3: honeypot — a filled honeypot returns a fake success and
  // writes NOTHING ──
  {
    await resetRateLimit()
    const { litterId, token } = await setupLiveShowcase('e3')
    const res = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token, website: 'http://spam.example' }), res)
    check('3', 'A tripped honeypot still returns 200 (indistinguishable from a real success)', res.statusCode === 200)
    check('3', 'No enquiry document was actually written', (await seedDb.collection('showcaseEnquiries').where('litterId', '==', litterId).get()).empty)
  }

  // ── Test 4: an invalid/unknown token is denied with the SAME generic
  // 404 the read endpoint uses ──
  {
    await resetRateLimit()
    const res = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token: 'this-token-was-never-issued' }), res)
    check('4', 'An unknown token returns a generic 404', res.statusCode === 404)
    check('4', 'The 404 body matches api/showcase-public.js\'s own generic shape', res.body?.error === 'Not found')
  }

  // ── Test 5: a disabled/paused Showcase denies enquiries too, not just
  // reads ──
  {
    await resetRateLimit()
    const { litterId, token } = await setupLiveShowcase('e5')
    await seedDb.collection('litterShowcases').doc(litterId).update({ enabled: false })
    const res = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token }), res)
    check('5', 'A disabled Showcase denies new enquiries (404)', res.statusCode === 404)
  }

  // ── Test 5b (Codex fix-round, "Tenant-chain validation"): a Litter
  // whose tenantId has drifted from the Showcase's own tenantId denies
  // ALL enquiries against it, not just reads ──
  {
    await resetRateLimit()
    const { litterId, token } = await setupLiveShowcase('e5b')
    await seedDb.collection('litters').doc(litterId).update({ tenantId: 'some-other-tenant-entirely' })
    const res = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token }), res)
    check('5b', 'A tenant-drifted Litter denies new enquiries (404)', res.statusCode === 404)
  }

  // ── Test 6 (Codex fix-round, "Public identifiers" / opaque enquiry
  // attribution): puppyRef is an OPAQUE reference, resolved server-side
  // by recomputing opaquePuppyRef(litterId, dogId) against every
  // currently-visible puppy in the TOKEN-RESOLVED Showcase — never a raw
  // dogId accepted directly, and never a ref that resolves against a
  // DIFFERENT Showcase's puppies ──
  {
    await resetRateLimit()
    const aPupId = `e6a_pup_${R}`
    const bPupId = `e6b_pup_${R}`
    const a = await setupLiveShowcase('e6a', [aPupId])
    const b = await setupLiveShowcase('e6b', [bPupId])

    // 6a — submitting the RAW real dogId (not its opaque ref) must fail:
    // a raw id never happens to collide with its own sha256-derived ref.
    const rawIdRes = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token: a.token, puppyRef: aPupId }), rawIdRes)
    check('6', 'Submitting the RAW real dogId as puppyRef is rejected (404) — the ref must be the opaque hash, never the id itself', rawIdRes.statusCode === 404)

    // 6b — a puppyRef correctly computed for a DIFFERENT Showcase's
    // puppy is rejected when submitted against Showcase A's token (IDOR):
    // reaching Showcase B's puppy list at all requires Showcase B's own
    // valid token, which this request never presents.
    const crossShowcaseRef = opaquePuppyRef(b.litterId, bPupId)
    const crossRes = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token: a.token, puppyRef: crossShowcaseRef }), crossRes)
    check('6', 'A puppyRef belonging to a DIFFERENT Showcase is rejected (404, IDOR)', crossRes.statusCode === 404)

    // 6c — the CORRECT opaque ref for Showcase A's own visible puppy is
    // accepted, and the enquiry is attributed to the REAL dogId
    // server-side (the breeder's own dashboard needs the real id — see
    // LittersPage.tsx's enquiry list, which matches against its own
    // puppyDogs by real id).
    const legitRef = opaquePuppyRef(a.litterId, aPupId)
    const legitRes = mockRes()
    await enquiryHandler(mockReq({ ...validBody, token: a.token, puppyRef: legitRef }), legitRes)
    check('6', 'The correct opaque ref for a genuinely visible puppy is accepted', legitRes.statusCode === 200, JSON.stringify(legitRes.body))
    const written = (await seedDb.collection('showcaseEnquiries').where('litterId', '==', a.litterId).get()).docs
    check('6', 'The accepted enquiry is attributed to the REAL dogId, resolved server-side from the opaque ref', written.some(d => d.data().puppyId === aPupId))
  }

  // ── Test 7: rate limiting — stricter than the read endpoint's default ──
  {
    await resetRateLimit()
    const { token } = await setupLiveShowcase('e7')
    let last
    for (let i = 0; i < 6; i++) {
      last = mockRes()
      await enquiryHandler(mockReq({ ...validBody, token, email: `e7-${i}@example.com` }), last)
    }
    check('7', 'The 6th enquiry submission from the same client within the window is rate-limited (429)', last.statusCode === 429)
    check('7', 'A 429 response includes a Retry-After header', typeof last.headers['Retry-After'] === 'string' && Number(last.headers['Retry-After']) > 0)
    await resetRateLimit()
  }

  // ── Test 8: tenant isolation on READ — the owning breeder can read
  // their own enquiries directly (client SDK); an unrelated breeder
  // cannot ──
  {
    await resetRateLimit()
    const { breeder, litterId, token } = await setupLiveShowcase('e8')
    const stranger = await newUser('e8stranger')
    await enquiryHandler(mockReq({ ...validBody, token }), mockRes())

    await signInWithEmailAndPassword(clientAuth, breeder.email, PW)
    // Mirrors getEnquiriesForLitter()'s own real query shape exactly
    // (litterId AND tenantId) — see that function's own comment for why
    // filtering on litterId alone throws a Rules evaluation error rather
    // than a clean deny.
    const ownReadSnap = await getDocs(query(collection(clientDb, 'showcaseEnquiries'), where('litterId', '==', litterId), where('tenantId', '==', breeder.uid)))
    check('8', 'The owning breeder can read their own litter\'s enquiries', ownReadSnap.size === 1)
    await signOut(clientAuth)

    await signInWithEmailAndPassword(clientAuth, stranger.email, PW)
    let strangerErr = null
    try {
      await getDocs(query(collection(clientDb, 'showcaseEnquiries'), where('litterId', '==', litterId), where('tenantId', '==', stranger.uid)))
    } catch (e) { strangerErr = e }
    // Firestore Rules deny per-document, not per-query — a query whose
    // results would include a document the caller can't read fails the
    // whole query. Querying with the stranger's OWN uid as a filter
    // returns an empty (allowed) result instead of a permission error,
    // so this proves isolation via emptiness, matching how the
    // litterShowcases precedent tests this same class of check.
    const strangerOwnSnap = await getDocs(query(collection(clientDb, 'showcaseEnquiries'), where('tenantId', '==', stranger.uid)))
    check('8', 'An unrelated breeder\'s own tenantId-scoped query returns zero of the other breeder\'s enquiries', strangerOwnSnap.empty)
    void strangerErr
    await signOut(clientAuth)
  }

  await summary()
} else {
  skip('Section 2 emulator end-to-end (Litter Showcase customer enquiries)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST and start the emulator to run them')
  summary()
}
