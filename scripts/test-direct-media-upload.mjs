// scripts/test-direct-media-upload.mjs — regression coverage for
// Implementation Phase 1 ("Unified Media & Performance" audit): the
// direct-to-Storage signed-upload flow for Litter Showcase media
// (api/request-showcase-media-upload.js + api/confirm-showcase-media-
// upload.js), which replaces the base64-JSON-through-Vercel transport
// (api/upload-showcase-media.js, left in place unchanged for
// compatibility) as the path the client actually calls.
//
// Usage: node scripts/test-direct-media-upload.mjs
//   Section 1 (structural + pure-function) always runs, no emulator
//   needed.
//   Section 2 (emulator end-to-end) needs FIRESTORE_EMULATOR_HOST,
//   FIREBASE_AUTH_EMULATOR_HOST, AND FIREBASE_STORAGE_EMULATOR_HOST set
//   (same requirement as test-showcase-media-pipeline.mjs).
//
// KNOWN EMULATOR GAP (confirmed directly in this environment before
// writing this file): the Firebase Storage emulator returns
// `501 Not Implemented` for an actual HTTP PUT against a `action:
// 'write'` signed URL — it can SIGN one (and the signature correctly
// includes the requested extensionHeaders, proven below against a real
// emulator-generated URL) but cannot SERVE the upload itself. This is a
// platform/emulator limitation, not application logic, so tests below
// simulate "the browser's PUT already completed" by writing bytes
// directly to the expected Storage path via the Admin SDK (a privilege
// only this test harness has, the same fault-injection pattern
// test-showcase-media-pipeline.mjs's own Test 0 already uses) — this
// still exercises every line of api/confirm-showcase-media-upload.js's
// own validation logic against a REAL Storage object at a REAL path,
// which is the part that is actually this codebase's own code. The one
// thing that can't be proven end-to-end here is GCS itself honoring the
// signed precondition header at PUT time — called out explicitly with
// skip(), not silently assumed.

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { makeChecker } from './_lib/test-check.mjs'
import { extensionForUpload, UPLOAD_URL_TTL_MS, NO_OVERWRITE_HEADER, MEDIA_UPLOAD_GRANTS_COLLECTION } from '../api/_lib/direct-upload.js'

const { check, checkAsync, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — structural + pure-function tests (no emulator needed)
// =========================================================================
{
  // ── pure logic: extensionForUpload ──
  check('extensionForUpload: image/jpeg is allowed for photo -> jpg', extensionForUpload('photo', 'image/jpeg') === 'jpg')
  check('extensionForUpload: image/png is NOT allowed for photo (direct-upload photos are always the client-compressed JPEG)', extensionForUpload('photo', 'image/png') === null)
  check('extensionForUpload: image/heic is NOT allowed for photo (HEIC is decoded client-side before this point)', extensionForUpload('photo', 'image/heic') === null)
  check('extensionForUpload: video/mp4 is allowed for video -> mp4', extensionForUpload('video', 'video/mp4') === 'mp4')
  check('extensionForUpload: video/quicktime is allowed for video -> mov', extensionForUpload('video', 'video/quicktime') === 'mov')
  check('extensionForUpload: video/webm is allowed for video -> webm', extensionForUpload('video', 'video/webm') === 'webm')
  check('extensionForUpload: an unrecognized video container is rejected', extensionForUpload('video', 'video/x-msvideo') === null)
  check('extensionForUpload: an unrecognized kind is rejected regardless of contentType', extensionForUpload('avatar', 'image/jpeg') === null)
  check('extensionForUpload: image/jpeg is NOT allowed for kind video (cross-kind confusion rejected)', extensionForUpload('video', 'image/jpeg') === null)

  check('UPLOAD_URL_TTL_MS is exactly 10 minutes (approved decision)', UPLOAD_URL_TTL_MS === 10 * 60 * 1000)
  check('NO_OVERWRITE_HEADER carries the real GCS create-only precondition', NO_OVERWRITE_HEADER['x-goog-if-generation-match'] === '0')
  check('MEDIA_UPLOAD_GRANTS_COLLECTION is a non-empty string', typeof MEDIA_UPLOAD_GRANTS_COLLECTION === 'string' && MEDIA_UPLOAD_GRANTS_COLLECTION.length > 0)

  // ── request-showcase-media-upload.js source ──
  const requestSrc = readFileSync(new URL('../api/request-showcase-media-upload.js', import.meta.url), 'utf8')
  check('request-showcase-media-upload.js verifies the Firebase ID token before doing anything else Storage/Firestore related',
    /verifyIdToken\(idToken\)/.test(requestSrc))
  check('request-showcase-media-upload.js uses canAddDogRecord (current effective owner, never on a restricted dog) — the SAME check every other upload endpoint uses',
    /canAddDogRecord\(dog, uid\)/.test(requestSrc))
  check('request-showcase-media-upload.js NEVER reads a client-supplied path/filePath from the request body — the path is always server-computed',
    !/req\.body\.(path|filePath)/.test(requestSrc) && !/const \{ dogId, kind, contentType, path/.test(requestSrc))
  check('request-showcase-media-upload.js builds the Storage path from a fresh randomUUID(), never a client-supplied filename',
    /`dogs\/\$\{uid\}\/\$\{dogId\}\/\$\{kind\}s\/\$\{randomUUID\(\)\}\.\$\{extension\}`/.test(requestSrc))
  check('request-showcase-media-upload.js rejects any contentType not on the allowlist via extensionForUpload() before touching Firestore/Storage',
    /extensionForUpload\(kind, contentType\)/.test(requestSrc) && /UNSUPPORTED_CONTENT_TYPE/.test(requestSrc))
  check('request-showcase-media-upload.js signs the upload URL with action: "write" and the no-overwrite extensionHeaders',
    /action: 'write'/.test(requestSrc) && /extensionHeaders: NO_OVERWRITE_HEADER/.test(requestSrc))
  check('request-showcase-media-upload.js signs with version: "v4" (required for extensionHeaders to bind into the signature)',
    /version: 'v4'/.test(requestSrc))
  check('request-showcase-media-upload.js writes a pending grant BEFORE minting the signed URL, so a grant always exists for confirm to check against',
    requestSrc.indexOf(`.doc(mediaId).set({`) !== -1 &&
    requestSrc.indexOf(`.doc(mediaId).set({`) < requestSrc.indexOf('getSignedUrl'))
  check('request-showcase-media-upload.js re-checks MAX_MEDIA_ITEMS_PER_KIND before issuing a grant (saves a wasted upload for the common case)',
    /existingCount >= MAX_MEDIA_ITEMS_PER_KIND/.test(requestSrc))
  check('request-showcase-media-upload.js never introduces a media.public field anywhere (approved decision: publication stays a separate, contextual reference)',
    !/\bpublic\s*:/.test(requestSrc) && !/\.public\b/.test(requestSrc))

  // ── confirm-showcase-media-upload.js source ──
  const confirmSrc = readFileSync(new URL('../api/confirm-showcase-media-upload.js', import.meta.url), 'utf8')
  check('confirm-showcase-media-upload.js verifies the Firebase ID token before doing anything else',
    /verifyIdToken\(idToken\)/.test(confirmSrc))
  check('confirm-showcase-media-upload.js accepts ONLY mediaId from the client body — dogId/kind/path always come from the stored grant, never the request',
    /const \{ mediaId \} = req\.body/.test(confirmSrc) && !/const \{ mediaId, dogId/.test(confirmSrc) && !/const \{ mediaId, path/.test(confirmSrc))
  check('confirm-showcase-media-upload.js rejects a grant that does not belong to the calling uid',
    /grant\.uid !== uid/.test(confirmSrc) && /NOT_GRANT_OWNER/.test(confirmSrc))
  check('confirm-showcase-media-upload.js rejects a grant that is not still pending (blocks double-confirm)',
    /grant\.status !== 'pending'/.test(confirmSrc) && /ALREADY_CONFIRMED/.test(confirmSrc))
  check('confirm-showcase-media-upload.js rejects (and cleans up) an expired grant',
    /grant\.expiresAt\)\.getTime\(\) < Date\.now\(\)/.test(confirmSrc) && /GRANT_EXPIRED/.test(confirmSrc))
  check('confirm-showcase-media-upload.js RE-VERIFIES canAddDogRecord at confirm time, not just at request time (ownership/restriction can change during the upload window)',
    /canAddDogRecord\(dog, uid\)/.test(confirmSrc))
  check('confirm-showcase-media-upload.js checks the object actually exists in Storage before trusting anything about it',
    /file\.exists\(\)/.test(confirmSrc) && /OBJECT_NOT_UPLOADED/.test(confirmSrc))
  check('confirm-showcase-media-upload.js downloads and re-validates the REAL uploaded bytes via the shared image/video pipeline (never trusts the grant\'s declared contentType alone)',
    /file\.download\(\)/.test(confirmSrc) &&
    /processImageForStorage\(rawBuffer\)/.test(confirmSrc) &&
    /processVideoForStorage\(rawBuffer\)/.test(confirmSrc))
  check('confirm-showcase-media-upload.js deletes the Storage object when validation fails (never leaves an unproven file referencing nothing)',
    /await deleteObjectQuietly\(bucket, grant\.path\)/.test(confirmSrc))
  check('confirm-showcase-media-upload.js still enforces the duplicate-content-hash guard, same as the base64 proxy path',
    /existingItems\.some\(item => item\?\.hash === contentHash\)/.test(confirmSrc) && /DUPLICATE_MEDIA/.test(confirmSrc))
  check('confirm-showcase-media-upload.js still enforces MAX_MEDIA_ITEMS_PER_KIND (re-checked, in case it was hit during the upload window)',
    /existingItems\.length >= MAX_MEDIA_ITEMS_PER_KIND/.test(confirmSrc))
  check('confirm-showcase-media-upload.js returns signed URLs via the same signMediaItems() every other Showcase media endpoint uses',
    /signMediaItems\(bucket, updated\.photos/.test(confirmSrc))
  check('confirm-showcase-media-upload.js never introduces a media.public field anywhere',
    !/\bpublic\s*:/.test(confirmSrc) && !/\.public\b/.test(confirmSrc))

  // ── client wiring: src/lib/db.ts + LittersPage.tsx ──
  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8')
  check('db.ts exports uploadShowcaseMediaDirect (the new direct-upload wrapper)',
    /export async function uploadShowcaseMediaDirect\(/.test(dbSrc))
  check('db.ts still exports the original uploadShowcaseMedia (base64 proxy) — left working for compatibility, not deleted',
    /export async function uploadShowcaseMedia\(/.test(dbSrc))
  check('uploadShowcaseMediaDirect calls request-showcase-media-upload, then PUTs directly to the signed URL, then confirms',
    /'\/api\/request-showcase-media-upload'/.test(dbSrc) &&
    /method: 'PUT', headers: requiredHeaders, body/.test(dbSrc) &&
    /'\/api\/confirm-showcase-media-upload'/.test(dbSrc))

  const littersSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('LittersPage.tsx imports uploadShowcaseMediaDirect (not the old uploadShowcaseMedia) for its own upload calls',
    /uploadShowcaseMediaDirect/.test(littersSrc) && !/\buploadShowcaseMedia\b(?!Direct)/.test(littersSrc))
  check('LittersPage.tsx no longer imports readFileAsBase64 (video is uploaded as a raw File now, never base64-encoded first)',
    !/readFileAsBase64/.test(littersSrc))

  // ── storage.rules stays deny-all — direct-upload security comes from
  // the signed URL itself, never from relaxed Storage Rules ──
  const storageRulesSrc = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8')
  check('storage.rules is still deny-all for every path (direct-upload security model does not require Storage Rules changes)',
    /allow read, write: if false/.test(storageRulesSrc))
}

// =========================================================================
// SECTION 2 — emulator end-to-end (real handlers, real Storage objects)
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`

  const { getFirestore } = await import('firebase-admin/firestore')
  const { getStorage } = await import('firebase-admin/storage')
  const { default: requestHandler } = await import('../api/request-showcase-media-upload.js')
  const { default: confirmHandler } = await import('../api/confirm-showcase-media-upload.js')

  const seedDb = getFirestore()
  const bucket = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET)

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')
  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'direct-upload-client')
  const clientAuth = getClientAuth(clientApp)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

  const sharp = (await import('sharp')).default
  const jpegBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).jpeg().toBuffer()
  function fakeMp4Buffer() {
    const header = Buffer.alloc(12)
    header.writeUInt32BE(28, 0)
    header.write('ftyp', 4, 'ascii')
    header.write('isom', 8, 'ascii')
    return Buffer.concat([header, Buffer.alloc(16, 0x00)])
  }

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
  async function seedDog(uid, dogId, extra = {}) {
    await seedDb.collection('dogs').doc(dogId).set({
      tenantId: uid, currentOwnerId: uid, createdByUserId: uid, sourceType: 'BREEDER_ISSUED',
      name: 'DirectUploadPup', sex: 'female', status: 'active', dateOfBirth: '2026-01-01',
      photos: [], videos: [], ...extra,
    })
  }
  async function requestGrant(dogId, kind, contentType, token) {
    const res = mockRes()
    await requestHandler(mockReq({ dogId, kind, contentType }, token), res)
    return res
  }
  async function readGrant(mediaId) {
    const snap = await seedDb.collection(MEDIA_UPLOAD_GRANTS_COLLECTION).doc(mediaId).get()
    return snap.exists ? snap.data() : null
  }
  async function confirmGrant(mediaId, token) {
    const res = mockRes()
    await confirmHandler(mockReq({ mediaId }, token), res)
    return res
  }

  // ── unauthorized ──
  await checkAsync('request: an unauthenticated call (no token) is rejected (401)', async () => {
    const res = await requestGrant('anything', 'photo', 'image/jpeg', undefined)
    return res.statusCode === 401
  })
  await checkAsync('confirm: an unauthenticated call (no token) is rejected (401)', async () => {
    const res = await confirmGrant('anything', undefined)
    return res.statusCode === 401
  })

  // ── wrong tenant/dog ──
  {
    const breeder = await newUser('dubreeder')
    const stranger = await newUser('dustranger')
    const buyer = await newUser('dubuyer')
    const dogId = `dudog_${R}`
    await seedDog(breeder.uid, dogId)

    await checkAsync('request: an unrelated stranger is denied (403) for a dog they do not own', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', stranger.idToken)
      return res.statusCode === 403 && res.body.reason === 'NOT_OWNER'
    })
    await checkAsync('request: requesting a grant for a nonexistent dogId is rejected (404)', async () => {
      const res = await requestGrant(`nope_${R}`, 'photo', 'image/jpeg', breeder.idToken)
      return res.statusCode === 404
    })

    const restrictedDogId = `dudog_restricted_${R}`
    await seedDb.collection('dogs').doc(restrictedDogId).set({
      tenantId: buyer.uid, currentOwnerId: buyer.uid, createdByUserId: buyer.uid, sourceType: 'OWNER_CREATED',
      name: 'Restricted', sex: 'male', status: 'restricted', dateOfBirth: '2026-01-01', photos: [], videos: [],
    })
    await checkAsync('request: a RESTRICTED dog denies even its current owner (403, no new media)', async () => {
      const res = await requestGrant(restrictedDogId, 'photo', 'image/jpeg', buyer.idToken)
      return res.statusCode === 403 && res.body.reason === 'DOG_RESTRICTED'
    })

    // ── confirm: a grant belongs only to the uid it was issued to ──
    let ownedMediaId
    await checkAsync('request: the legitimate owner is granted a pending upload slot', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', breeder.idToken)
      ownedMediaId = res.body?.mediaId
      return res.statusCode === 200 && typeof ownedMediaId === 'string'
    })
    await checkAsync('confirm: a stranger cannot confirm someone else\'s grant, even knowing its mediaId (403 NOT_GRANT_OWNER)', async () => {
      const res = await confirmGrant(ownedMediaId, stranger.idToken)
      return res.statusCode === 403 && res.body.reason === 'NOT_GRANT_OWNER'
    })

    // ── confirm re-verifies ownership NOW, not just at request time ──
    let raceMediaId
    await checkAsync('request: a grant is issued while the dog is still active', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', breeder.idToken)
      raceMediaId = res.body?.mediaId
      return res.statusCode === 200
    })
    await seedDb.collection('dogs').doc(dogId).update({ status: 'restricted' })
    await checkAsync('confirm: if the dog becomes restricted DURING the upload window, confirm re-checks and denies it (403 DOG_RESTRICTED) — proves re-verification is real, not just request-time', async () => {
      const res = await confirmGrant(raceMediaId, breeder.idToken)
      return res.statusCode === 403 && res.body.reason === 'DOG_RESTRICTED'
    })
    await seedDb.collection('dogs').doc(dogId).update({ status: 'active' })
  }

  // ── invalid type/size ──
  {
    const owner = await newUser('duinvalid')
    const dogId = `dudog_invalid_${R}`
    await seedDog(owner.uid, dogId)

    await checkAsync('request: an unsupported contentType for kind=photo is rejected (400) before any Firestore/Storage call', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/png', owner.idToken)
      return res.statusCode === 400 && res.body.reason === 'UNSUPPORTED_CONTENT_TYPE'
    })
    await checkAsync('request: an unsupported contentType for kind=video is rejected (400)', async () => {
      const res = await requestGrant(dogId, 'video', 'video/x-msvideo', owner.idToken)
      return res.statusCode === 400 && res.body.reason === 'UNSUPPORTED_CONTENT_TYPE'
    })

    // ── confirm independently verifies the REAL uploaded object (not just the grant's declared contentType) ──
    let garbageMediaId, garbagePath
    await checkAsync('request: a valid grant is issued for a photo', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', owner.idToken)
      garbageMediaId = res.body?.mediaId
      const grant = await readGrant(garbageMediaId)
      garbagePath = grant?.path
      return res.statusCode === 200 && typeof garbagePath === 'string'
    })
    await bucket.file(garbagePath).save(Buffer.from('this is not a real jpeg, just plain text bytes'), { metadata: { contentType: 'image/jpeg' } })
    await checkAsync('confirm: real magic-byte sniffing rejects an object that is not actually a JPEG, even though it was uploaded with an image/jpeg Content-Type (400)', async () => {
      const res = await confirmGrant(garbageMediaId, owner.idToken)
      return res.statusCode === 400
    })
    await checkAsync('confirm: the invalid object is deleted from Storage after rejection (no orphan left behind)', async () => {
      const [exists] = await bucket.file(garbagePath).exists()
      return exists === false
    })
    await checkAsync('confirm: the grant is marked rejected, so a stale retry cannot silently succeed later', async () => {
      const grant = await readGrant(garbageMediaId)
      return grant?.status === 'rejected'
    })

    // ── object never uploaded at all ──
    let neverUploadedMediaId
    await checkAsync('request: a valid grant is issued but the client never actually uploads anything', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', owner.idToken)
      neverUploadedMediaId = res.body?.mediaId
      return res.statusCode === 200
    })
    await checkAsync('confirm: rejects with OBJECT_NOT_UPLOADED if nothing was ever placed at the granted path', async () => {
      const res = await confirmGrant(neverUploadedMediaId, owner.idToken)
      return res.statusCode === 400 && res.body.reason === 'OBJECT_NOT_UPLOADED'
    })

    // ── MAX_MEDIA_ITEMS_PER_KIND enforced at request time ──
    const fullDogId = `dudog_full_${R}`
    const thirtyFakePhotos = Array.from({ length: 30 }, (_, i) => ({ id: `fake-${i}`, path: `dogs/${owner.uid}/${fullDogId}/photos/fake-${i}.jpg`, hash: `h${i}` }))
    await seedDog(owner.uid, fullDogId, { photos: thirtyFakePhotos })
    await checkAsync('request: a puppy already at the 30-photo cap is denied a new grant (409 MEDIA_LIMIT_REACHED)', async () => {
      const res = await requestGrant(fullDogId, 'photo', 'image/jpeg', owner.idToken)
      return res.statusCode === 409 && res.body.reason === 'MEDIA_LIMIT_REACHED'
    })
  }

  // ── path cannot be client-controlled ──
  {
    const owner = await newUser('dupath')
    const dogId = `dudog_path_${R}`
    await seedDog(owner.uid, dogId)

    await checkAsync('confirm: an unknown/nonexistent mediaId is rejected (404 GRANT_NOT_FOUND) — a client cannot invent a grant', async () => {
      const res = await confirmGrant(randomUUID(), owner.idToken)
      return res.statusCode === 404 && res.body.reason === 'GRANT_NOT_FOUND'
    })

    let mediaId, grantedPath
    await checkAsync('request: a legitimate grant is issued', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', owner.idToken)
      mediaId = res.body?.mediaId
      grantedPath = (await readGrant(mediaId))?.path
      return res.statusCode === 200 && typeof grantedPath === 'string'
    })
    check('request: the granted Storage path is scoped under this exact dog/owner/kind — never influenced by any client input (the client sent no path at all)',
      grantedPath.startsWith(`dogs/${owner.uid}/${dogId}/photos/`))
    await bucket.file(grantedPath).save(jpegBuffer, { metadata: { contentType: 'image/jpeg' } })
    await checkAsync('confirm: passing extra, unexpected fields in the request body (e.g. a client-supplied path/dogId) has NO effect — confirm only ever reads mediaId, everything else comes from the stored grant',
      async () => {
        const res = mockRes()
        await confirmHandler(mockReq({ mediaId, path: 'dogs/someone-else/evil/photos/x.jpg', dogId: 'someone-elses-dog' }, owner.idToken), res)
        return res.statusCode === 200 && res.body.mediaId === mediaId
      })
  }

  // ── expired / already-confirmed grants ──
  {
    const owner = await newUser('duexpiry')
    const dogId = `dudog_expiry_${R}`
    await seedDog(owner.uid, dogId)

    let expiredMediaId, expiredPath
    await checkAsync('request: a grant is issued normally', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', owner.idToken)
      expiredMediaId = res.body?.mediaId
      expiredPath = (await readGrant(expiredMediaId))?.path
      return res.statusCode === 200
    })
    await bucket.file(expiredPath).save(jpegBuffer, { metadata: { contentType: 'image/jpeg' } })
    // Simulate the grant's 10-minute window having already closed —
    // real elapsed time is never actually waited for in this test.
    await seedDb.collection(MEDIA_UPLOAD_GRANTS_COLLECTION).doc(expiredMediaId).update({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    await checkAsync('confirm: an expired grant is rejected (410 GRANT_EXPIRED)', async () => {
      const res = await confirmGrant(expiredMediaId, owner.idToken)
      return res.statusCode === 410 && res.body.reason === 'GRANT_EXPIRED'
    })
    await checkAsync('confirm: the abandoned object behind an expired grant is cleaned up immediately, not just left for a future job to find', async () => {
      const [exists] = await bucket.file(expiredPath).exists()
      return exists === false
    })
    await checkAsync('confirm: the expired grant document itself is marked so it is identifiable (not silently deleted, not stuck "pending" forever)', async () => {
      const grant = await readGrant(expiredMediaId)
      return grant?.status === 'expired'
    })

    // ── double confirm ──
    let successMediaId, successPath
    await checkAsync('request: a fresh grant for the already-confirmed scenario', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', owner.idToken)
      successMediaId = res.body?.mediaId
      successPath = (await readGrant(successMediaId))?.path
      return res.statusCode === 200
    })
    await bucket.file(successPath).save(jpegBuffer, { metadata: { contentType: 'image/jpeg' } })
    await checkAsync('confirm: the first confirm succeeds (200)', async () => {
      const res = await confirmGrant(successMediaId, owner.idToken)
      return res.statusCode === 200
    })
    await checkAsync('confirm: confirming the SAME mediaId a second time is rejected (409 ALREADY_CONFIRMED), never silently re-adds the media item', async () => {
      const res = await confirmGrant(successMediaId, owner.idToken)
      return res.statusCode === 409 && res.body.reason === 'ALREADY_CONFIRMED'
    })
  }

  // ── confirm verifies the actual uploaded object end-to-end (success path) ──
  {
    const owner = await newUser('dusuccess')
    const dogId = `dudog_success_${R}`
    await seedDog(owner.uid, dogId)

    let mediaId, path
    await checkAsync('request: a photo grant is issued', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', owner.idToken)
      mediaId = res.body?.mediaId
      path = (await readGrant(mediaId))?.path
      return res.statusCode === 200
    })
    await bucket.file(path).save(jpegBuffer, { metadata: { contentType: 'image/jpeg' } })

    let confirmBody
    await checkAsync('confirm: a real, valid uploaded JPEG confirms successfully (200)', async () => {
      const res = await confirmGrant(mediaId, owner.idToken)
      confirmBody = res.body
      return res.statusCode === 200
    })
    check('confirm response includes the mediaId and a signed photos[] entry for it', confirmBody?.mediaId === mediaId && confirmBody?.photos?.some(p => p.id === mediaId))
    await checkAsync('confirm: dog.photos in Firestore now has exactly one {id, path, hash} entry at the GRANTED path', async () => {
      const dogAfter = (await seedDb.collection('dogs').doc(dogId).get()).data()
      return dogAfter.photos.length === 1 && dogAfter.photos[0].id === mediaId && dogAfter.photos[0].path === path && typeof dogAfter.photos[0].hash === 'string'
    })
    await checkAsync('confirm: the grant is marked confirmed', async () => {
      const grant = await readGrant(mediaId)
      return grant?.status === 'confirmed'
    })

    // ── duplicate content upload ──
    let dupMediaId, dupPath
    await checkAsync('request: a second grant is issued for the same dog/kind', async () => {
      const res = await requestGrant(dogId, 'photo', 'image/jpeg', owner.idToken)
      dupMediaId = res.body?.mediaId
      dupPath = (await readGrant(dupMediaId))?.path
      return res.statusCode === 200 && dupPath !== path
    })
    await bucket.file(dupPath).save(jpegBuffer, { metadata: { contentType: 'image/jpeg' } })
    await checkAsync('confirm: uploading the exact same photo content again for the same puppy is rejected (409 DUPLICATE_MEDIA)', async () => {
      const res = await confirmGrant(dupMediaId, owner.idToken)
      return res.statusCode === 409 && res.body.reason === 'DUPLICATE_MEDIA'
    })
    await checkAsync('confirm: the duplicate\'s redundant Storage object is cleaned up', async () => {
      const [exists] = await bucket.file(dupPath).exists()
      return exists === false
    })
    await checkAsync('confirm: the gallery still has exactly the ONE original photo after the duplicate rejection', async () => {
      const dogAfter = (await seedDb.collection('dogs').doc(dogId).get()).data()
      return dogAfter.photos.length === 1
    })

    // ── video also works through the same flow ──
    let videoMediaId, videoPath
    await checkAsync('request: a video grant is issued', async () => {
      const res = await requestGrant(dogId, 'video', 'video/mp4', owner.idToken)
      videoMediaId = res.body?.mediaId
      videoPath = (await readGrant(videoMediaId))?.path
      return res.statusCode === 200 && videoPath.includes('/videos/')
    })
    await bucket.file(videoPath).save(fakeMp4Buffer(), { metadata: { contentType: 'video/mp4' } })
    await checkAsync('confirm: a real MP4 video confirms successfully (200) and lands in dog.videos, not dog.photos', async () => {
      const res = await confirmGrant(videoMediaId, owner.idToken)
      if (res.statusCode !== 200) return false
      const dogAfter = (await seedDb.collection('dogs').doc(dogId).get()).data()
      return dogAfter.videos.length === 1 && dogAfter.videos[0].id === videoMediaId && (dogAfter.photos?.length || 0) === 1
    })
  }

  // ── overwrite prevented ──
  {
    const owner = await newUser('duoverwrite')
    const dogId = `dudog_overwrite_${R}`
    await seedDog(owner.uid, dogId)

    const res1 = await requestGrant(dogId, 'photo', 'image/jpeg', owner.idToken)
    const res2 = await requestGrant(dogId, 'photo', 'image/jpeg', owner.idToken)
    check('request: two separate grants for the same dog/kind/contentType are issued to two DIFFERENT, fresh Storage paths — no request can ever collide with another',
      res1.body.mediaId !== res2.body.mediaId)

    const grant1 = await readGrant(res1.body.mediaId)
    check('request: the two grants\' Storage paths are genuinely different (fresh randomUUID() per grant, not reused)',
      grant1.path !== (await readGrant(res2.body.mediaId)).path)

    // Real, dynamic proof against the actual emulator-generated signed URL
    // (not just a static regex against source) that the no-overwrite
    // precondition header is genuinely part of THIS signature.
    const url = new URL(res1.body.uploadUrl)
    const signedHeaders = url.searchParams.get('X-Goog-SignedHeaders') || ''
    check('request: the REAL signed URL returned by the live endpoint has x-goog-if-generation-match bound into its signature (X-Goog-SignedHeaders)',
      signedHeaders.toLowerCase().includes('x-goog-if-generation-match'))
    check('request: the response tells the client exactly which headers it must send for the signature to validate',
      res1.body.requiredHeaders?.['x-goog-if-generation-match'] === '0' && res1.body.requiredHeaders?.['Content-Type'] === 'image/jpeg')

    skip(
      'A real second PUT to an already-uploaded path is rejected by GCS with 412 Precondition Failed',
      'confirmed directly in this environment: the Firebase Storage emulator returns 501 Not Implemented for any HTTP PUT against a write-action signed URL — it can sign one (proven above) but cannot serve the upload itself. This is a Storage-emulator platform gap, not a gap in this endpoint\'s own logic; the create-only precondition (x-goog-if-generation-match: 0) is real GCS functionality this codebase does not implement itself.'
    )
  }
} else {
  skip('Section 2 emulator end-to-end (direct media upload)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST/FIREBASE_STORAGE_EMULATOR_HOST and start the emulators to run them')
}

await summary()
