// scripts/test-showcase-media-pipeline.mjs — regression coverage for the
// Litter Showcase media/HEIC pipeline (Slice 2, commit 3/5).
//
// Root cause recap (see api/_lib/image-pipeline.js's own header comment
// for the full story): api/upload.js already had a HEIC conversion
// branch, but (1) trusted a client-supplied mediaType with zero
// verification against the actual bytes, and (2) called
// `sharp(buffer).jpeg(...)` directly on raw HEIC bytes — sharp's
// official prebuilt binaries do not bundle libheif, confirmed directly
// in this environment (`sharp(...).heif({compression:'hevc'})` fails
// with "heifsave: Unsupported compression") — so that branch was very
// likely ALREADY silently broken for real HEIC uploads before this
// pipeline existed. This file tests the fix (api/_lib/image-pipeline.js,
// using heic-convert for the actual decode) plus the two new endpoints
// built on it for litter/puppy Showcase media.
//
// Usage: node scripts/test-showcase-media-pipeline.mjs
//   Section 1 (structural + pure-function) always runs.
//   Section 2 (emulator end-to-end) needs FIRESTORE_EMULATOR_HOST,
//   FIREBASE_AUTH_EMULATOR_HOST, AND FIREBASE_STORAGE_EMULATOR_HOST set
//   (this file is the first in this suite to need the Storage emulator
//   — see storage.rules' own header comment for why it was added).

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import {
  sniffImageMimeType, sniffVideoMimeType, processImageForStorage, processVideoForStorage,
  ImagePipelineError, MAX_IMAGE_INPUT_BYTES, MAX_VIDEO_INPUT_BYTES,
} from '../api/_lib/image-pipeline.js'

const { check, checkAsync, skip, summary } = makeChecker()

// =========================================================================
// SECTION 1 — structural + pure-function tests (no emulator needed)
// =========================================================================
{
  // ── real magic-byte fixtures (built with sharp, which CAN encode
  // JPEG/PNG/WebP fine — only HEIF *encoding* is unavailable in this
  // environment, confirmed separately; decoding real photos taken by an
  // iPhone is what heic-convert is for, tested via a realistic-but-
  // synthetic ftyp/brand header below) ──
  const sharp = (await import('sharp')).default
  const jpegBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).jpeg().toBuffer()
  const pngBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'blue' } }).png().toBuffer()
  const webpBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'green' } }).webp().toBuffer()

  // A real HEIC file's first 12 bytes: a 4-byte box-size field (value
  // irrelevant to sniffing), literal ASCII "ftyp", then a 4-character
  // brand code. This is genuinely what every real HEIC photo's header
  // looks like — what follows it here is NOT valid HEIC image data
  // (there's no real encoder available in this environment — see this
  // file's own header comment), so this fixture proves sniffing AND the
  // "corrupt file past the header" decode-failure path, but not a full
  // successful real-photo decode (heic-convert's own upstream test
  // suite is what verifies actual decode correctness).
  function fakeHeicBuffer(brand, bodyLength = 200) {
    const header = Buffer.alloc(12)
    header.writeUInt32BE(header.length + bodyLength, 0)
    header.write('ftyp', 4, 'ascii')
    header.write(brand, 8, 'ascii')
    return Buffer.concat([header, Buffer.alloc(bodyLength, 0x00)])
  }
  function fakeMp4Buffer(brand = 'isom') {
    const header = Buffer.alloc(12)
    header.writeUInt32BE(28, 0)
    header.write('ftyp', 4, 'ascii')
    header.write(brand, 8, 'ascii')
    return Buffer.concat([header, Buffer.alloc(16, 0x00)])
  }
  function fakeWebmBuffer() {
    return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16, 0x00)])
  }

  // ── sniffImageMimeType ──
  check('sniffImageMimeType: recognizes a real JPEG (sharp-encoded)', sniffImageMimeType(jpegBuffer) === 'image/jpeg')
  check('sniffImageMimeType: recognizes a real PNG (sharp-encoded)', sniffImageMimeType(pngBuffer) === 'image/png')
  check('sniffImageMimeType: recognizes a real WebP (sharp-encoded)', sniffImageMimeType(webpBuffer) === 'image/webp')
  check('sniffImageMimeType: recognizes a HEIC ftyp/brand header ("heic")', sniffImageMimeType(fakeHeicBuffer('heic')) === 'image/heic')
  check('sniffImageMimeType: recognizes an HEIF image-sequence brand ("mif1")', sniffImageMimeType(fakeHeicBuffer('mif1')) === 'image/heic')
  check('sniffImageMimeType: an MP4 ftyp/brand ("isom") is NEVER misidentified as an image', sniffImageMimeType(fakeMp4Buffer('isom')) === null)
  check('sniffImageMimeType: a MOV ftyp/brand ("qt  ") is NEVER misidentified as an image', sniffImageMimeType(fakeMp4Buffer('qt  ')) === null)
  check('sniffImageMimeType: plain text bytes are not recognized as any image type', sniffImageMimeType(Buffer.from('not an image, just text', 'utf8')) === null)
  check('sniffImageMimeType: an empty buffer is not recognized', sniffImageMimeType(Buffer.alloc(0)) === null)
  check('sniffImageMimeType: a non-Buffer input never throws, just returns null', sniffImageMimeType('not a buffer') === null)
  check('sniffImageMimeType: mediaType is NEVER an input to this function at all — it only ever reads bytes (verified structurally: the function signature takes exactly one argument)',
    sniffImageMimeType.length === 1)

  // ── sniffVideoMimeType ──
  check('sniffVideoMimeType: recognizes an MP4 ftyp/brand ("isom")', sniffVideoMimeType(fakeMp4Buffer('isom')) === 'video/mp4')
  check('sniffVideoMimeType: recognizes a MOV ftyp/brand ("qt  ")', sniffVideoMimeType(fakeMp4Buffer('qt  ')) === 'video/quicktime')
  check('sniffVideoMimeType: recognizes a WebM EBML header', sniffVideoMimeType(fakeWebmBuffer()) === 'video/webm')
  check('sniffVideoMimeType: a HEIC ftyp/brand ("heic") is NEVER misidentified as a video', sniffVideoMimeType(fakeHeicBuffer('heic')) === null)
  check('sniffVideoMimeType: a real JPEG is not recognized as any video type', sniffVideoMimeType(jpegBuffer) === null)

  // ── processImageForStorage: JPEG/PNG/WebP behavior preservation ──
  await checkAsync('processImageForStorage: a real JPEG passes through byte-for-byte unchanged (Slice 2: "Preserve JPG/PNG/WebP behavior")', async () => {
    const result = await processImageForStorage(jpegBuffer)
    return result.mimeType === 'image/jpeg' && result.extension === 'jpg' && result.buffer.equals(jpegBuffer)
  })
  await checkAsync('processImageForStorage: a real PNG passes through byte-for-byte unchanged', async () => {
    const result = await processImageForStorage(pngBuffer)
    return result.mimeType === 'image/png' && result.extension === 'png' && result.buffer.equals(pngBuffer)
  })
  await checkAsync('processImageForStorage: a real WebP passes through byte-for-byte unchanged', async () => {
    const result = await processImageForStorage(webpBuffer)
    return result.mimeType === 'image/webp' && result.extension === 'webp' && result.buffer.equals(webpBuffer)
  })

  // ── processImageForStorage: HEIC path (decode failure is the
  // realistically-testable case here — see this file's own header
  // comment on why a full successful decode isn't) ──
  await checkAsync('processImageForStorage: a HEIC-shaped but corrupt/unreal file fails with a clean HEIC_DECODE_FAILED, never an unhandled exception', async () => {
    try {
      await processImageForStorage(fakeHeicBuffer('heic'))
      return false // must have thrown
    } catch (err) {
      return err instanceof ImagePipelineError && err.code === 'HEIC_DECODE_FAILED'
    }
  })

  // ── processImageForStorage: rejection paths ──
  await checkAsync('processImageForStorage: an empty buffer throws EMPTY_FILE', async () => {
    try { await processImageForStorage(Buffer.alloc(0)); return false }
    catch (err) { return err instanceof ImagePipelineError && err.code === 'EMPTY_FILE' }
  })
  await checkAsync('processImageForStorage: an unrecognized file type throws UNSUPPORTED_IMAGE_TYPE', async () => {
    try { await processImageForStorage(Buffer.from('not an image', 'utf8')); return false }
    catch (err) { return err instanceof ImagePipelineError && err.code === 'UNSUPPORTED_IMAGE_TYPE' }
  })
  await checkAsync('processImageForStorage: a buffer over MAX_IMAGE_INPUT_BYTES throws FILE_TOO_LARGE, even with a valid JPEG header', async () => {
    const oversized = Buffer.concat([jpegBuffer, Buffer.alloc(MAX_IMAGE_INPUT_BYTES)])
    try { await processImageForStorage(oversized); return false }
    catch (err) { return err instanceof ImagePipelineError && err.code === 'FILE_TOO_LARGE' }
  })

  // ── processVideoForStorage ──
  await checkAsync('processVideoForStorage: a real MP4 header passes through unchanged', async () => {
    const buf = fakeMp4Buffer('isom')
    const result = await processVideoForStorage(buf)
    return result.mimeType === 'video/mp4' && result.extension === 'mp4' && result.buffer.equals(buf)
  })
  await checkAsync('processVideoForStorage: a real MOV header passes through unchanged with a .mov extension', async () => {
    const result = await processVideoForStorage(fakeMp4Buffer('qt  '))
    return result.mimeType === 'video/quicktime' && result.extension === 'mov'
  })
  await checkAsync('processVideoForStorage: a real WebM header passes through unchanged', async () => {
    const result = await processVideoForStorage(fakeWebmBuffer())
    return result.mimeType === 'video/webm' && result.extension === 'webm'
  })
  await checkAsync('processVideoForStorage: an unrecognized file throws UNSUPPORTED_VIDEO_TYPE', async () => {
    try { await processVideoForStorage(Buffer.from('not a video', 'utf8')); return false }
    catch (err) { return err instanceof ImagePipelineError && err.code === 'UNSUPPORTED_VIDEO_TYPE' }
  })
  await checkAsync('processVideoForStorage: a buffer over MAX_VIDEO_INPUT_BYTES throws FILE_TOO_LARGE', async () => {
    const oversized = Buffer.concat([fakeWebmBuffer(), Buffer.alloc(MAX_VIDEO_INPUT_BYTES)])
    try { await processVideoForStorage(oversized); return false }
    catch (err) { return err instanceof ImagePipelineError && err.code === 'FILE_TOO_LARGE' }
  })

  // ── api/upload.js: the fix itself ──
  const uploadSrc = readFileSync(new URL('../api/upload.js', import.meta.url), 'utf8')
  check('api/upload.js no longer imports sharp directly (only image-pipeline.js does, now the single place HEIC conversion happens)',
    !/^import sharp from 'sharp'/m.test(uploadSrc))
  check('api/upload.js no longer reads mediaType from the request body at all — the real pipeline sniffs bytes instead',
    !/const \{ base64, mediaType, dogId \}/.test(uploadSrc))
  check('api/upload.js imports and uses the shared processImageForStorage pipeline',
    /processImageForStorage/.test(uploadSrc))
  check('api/upload.js maps an ImagePipelineError to a client 400, not a generic 500',
    /if \(err instanceof ImagePipelineError\)/.test(uploadSrc) && /res\.status\(400\)/.test(uploadSrc))
  check('api/upload.js no longer contains the old broken direct sharp(...).jpeg() HEIC branch',
    !/sharp\(buffer\)\.jpeg\(\{ quality: 85 \}\)/.test(uploadSrc))

  // ── api/upload-showcase-media.js / api/update-showcase-media.js ──
  const uploadMediaSrc = readFileSync(new URL('../api/upload-showcase-media.js', import.meta.url), 'utf8')
  const updateMediaSrc = readFileSync(new URL('../api/update-showcase-media.js', import.meta.url), 'utf8')

  check('upload-showcase-media.js requires a valid Firebase ID token', /verifyIdToken/.test(uploadMediaSrc))
  check('upload-showcase-media.js reuses canAddDogRecord (ownership + not-restricted), not a bespoke check',
    /canAddDogRecord\(dog, uid\)/.test(uploadMediaSrc))
  check('upload-showcase-media.js generates a safe, unguessable filename via crypto.randomUUID(), never a client-supplied name',
    /randomUUID\(\)/.test(uploadMediaSrc) && !/req\.body\.\w*[Nn]ame/.test(uploadMediaSrc))
  check('upload-showcase-media.js enforces a maximum media-item count per puppy',
    /MEDIA_LIMIT_REACHED/.test(uploadMediaSrc))

  check('update-showcase-media.js also reuses canAddDogRecord',
    /canAddDogRecord\(dog, uid\)/.test(updateMediaSrc))
  check('update-showcase-media.js rejects an order[] entry that isn\'t already part of the current media (never a way to inject a new URL)',
    /UNKNOWN_MEDIA_ITEM/.test(updateMediaSrc))
  check('update-showcase-media.js rejects duplicate entries in order[]',
    /must not contain duplicate entries/.test(updateMediaSrc))
  check('update-showcase-media.js\'s Storage cleanup for removed items is wrapped so a cleanup failure can never fail the whole request',
    /try \{\s*\n\s*await bucket\.file\(item\.path\)\.delete\(\)/.test(updateMediaSrc))

  // ── client-side HEIC consolidation ──
  const heicLibSrc = readFileSync(new URL('../src/lib/heic.ts', import.meta.url), 'utf8')
  const photoUploadSrc = readFileSync(new URL('../src/components/ui/PhotoUpload.tsx', import.meta.url), 'utf8')
  const dogDetailSrc = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
  check('src/lib/heic.ts exports the shared isHeicFile()', /export function isHeicFile\(file: File\): boolean/.test(heicLibSrc))
  check('PhotoUpload.tsx imports isHeicFile from the shared module (no duplicated inline copy)',
    /import \{ isHeicFile \} from '\.\.\/\.\.\/lib\/heic'/.test(photoUploadSrc) && !/function isHeic\(file: File\)/.test(photoUploadSrc))
  check('DogDetailPage.tsx imports isHeicFile from the shared module (no duplicated inline copy)',
    /import \{ isHeicFile \} from '\.\.\/lib\/heic'/.test(dogDetailSrc) && !/function isHeic\(file: File\)/.test(dogDetailSrc))

  // ── Dog type additions ──
  const typesSrc = readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8')
  // Tony live-staging fix round ("duplicate upload"): MediaItem gained
  // an optional `hash` field (content dedup) — the check now allows that
  // addition while still failing if a `url`/`fileUrl` field ever sneaks
  // in, which is the actual invariant this test protects.
  {
    const mediaItemMatch = /export interface MediaItem \{\s*\n\s*id: string\s*\n\s*path: string\s*\n([\s\S]{0,600}?)\n\}/.exec(typesSrc)
    check('MediaItem is declared as {id, path[, hash]} — a private Storage path, never a public URL',
      !!mediaItemMatch && !/\b(url|fileUrl)\b/.test(mediaItemMatch[1]))
  }
  check('Dog.photos is an ordered MediaItem[] (index 0 = cover — no separate isCover flag needed)', /photos: MediaItem\[\]/.test(typesSrc))
  check('Dog declares an optional videos?: MediaItem[] field, same ordered-array convention', /videos\?: MediaItem\[\]/.test(typesSrc))

  // Several header comments in this fix-round deliberately document the
  // ABSENCE of makePublic() in prose (e.g. "no file.makePublic() anywhere
  // in this file") — a plain substring/regex search for "makePublic"
  // would false-positive on that very documentation. This checks that
  // every occurrence is confined to a comment line, never a real call.
  function neverActuallyCalls(src, needle) {
    return src.split('\n').every(line => !line.includes(needle) || line.trim().startsWith('//'))
  }

  // ── Codex fix-round ("Revocable media delivery") ──
  const accessSrc = readFileSync(new URL('../api/_lib/showcase-media-access.js', import.meta.url), 'utf8')
  check('showcase-media-access.js never calls file.makePublic() anywhere', neverActuallyCalls(accessSrc, 'makePublic'))
  check('signMediaItems() generates a short-lived signed URL (action: read, expires)', /getSignedUrl\(\{ action: 'read', expires:/.test(accessSrc))
  check('signMediaItems() silently drops an item whose Storage object no longer exists (never throws for the whole batch)', /if \(!exists\) return null/.test(accessSrc))
  check('opaquePuppyRef() is a deterministic hash of litterId+dogId (sha256), never a persisted/random id', /createHash\('sha256'\)\.update\(`\$\{litterId\}:\$\{dogId\}`/.test(accessSrc))

  check('upload-showcase-media.js never calls file.makePublic() anywhere', neverActuallyCalls(uploadMediaSrc, 'makePublic'))
  check('upload-showcase-media.js stores only {id, path, hash} on dog.photos/videos, never a public fileUrl string',
    /const mediaItem = \{ id: mediaId, path: filePath, hash: contentHash \}/.test(uploadMediaSrc))
  check('upload-showcase-media.js returns freshly-signed URLs via signMediaItems(), not a raw Storage path/URL',
    /signMediaItems\(bucket, updated\.photos/.test(uploadMediaSrc))

  // ── Codex fix-round ("Upload consistency") — orphan cleanup ──
  check('upload-showcase-media.js deletes the just-uploaded Storage object if the Firestore write that references it fails',
    /catch \(writeErr\) \{[\s\S]*?await file\.delete\(\)[\s\S]*?throw writeErr/.test(uploadMediaSrc))

  // ── update-showcase-media.js: id-based reorder/delete (Codex fix-round) ──
  check('update-showcase-media.js validates order[] as an array of media ID strings, never URLs',
    /order must be an array of media id strings/.test(updateMediaSrc))
  check('update-showcase-media.js resolves removed items via a Map keyed by id, deletes their Storage object by item.path',
    /const currentById = new Map\(current\.map\(item => \[item\.id, item\]\)\)/.test(updateMediaSrc) &&
    /await bucket\.file\(item\.path\)\.delete\(\)/.test(updateMediaSrc))
  check('update-showcase-media.js returns freshly-signed URLs, never a raw path/URL',
    /signMediaItems\(bucket, updated\.photos/.test(updateMediaSrc))

  // ── api/get-showcase-media-urls.js — breeder's own authenticated view ──
  const getUrlsSrc = readFileSync(new URL('../api/get-showcase-media-urls.js', import.meta.url), 'utf8')
  check('get-showcase-media-urls.js requires a valid Firebase ID token', /verifyIdToken/.test(getUrlsSrc))
  check('get-showcase-media-urls.js authorizes via tenantId OR currentOwnerId (viewing, not writing — a restricted dog\'s existing photos must still be viewable)',
    /dog\.tenantId === uid \|\| dog\.currentOwnerId === uid/.test(getUrlsSrc))
  check('get-showcase-media-urls.js returns signed URLs for both photos and videos', /signMediaItems\(bucket, dog\.photos/.test(getUrlsSrc) && /signMediaItems\(bucket, dog\.videos/.test(getUrlsSrc))
}

// =========================================================================
// SECTION 2 — emulator end-to-end (real Storage writes)
// =========================================================================
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  await import('./test-helpers/emulator-credentials.mjs')
  process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`

  const { getFirestore } = await import('firebase-admin/firestore')
  const { getStorage } = await import('firebase-admin/storage')
  const { default: uploadMediaHandler } = await import('../api/upload-showcase-media.js')
  const { default: updateMediaHandler } = await import('../api/update-showcase-media.js')
  const { default: getMediaUrlsHandler } = await import('../api/get-showcase-media-urls.js')

  const seedDb = getFirestore()
  const bucket = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET)

  const { initializeApp } = await import('firebase/app')
  const { getAuth: getClientAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import('firebase/auth')
  const clientApp = initializeApp({ projectId: 'demo-idogs-qa', apiKey: 'fake-api-key' }, 'showcase-media-client')
  const clientAuth = getClientAuth(clientApp)
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true })

  const sharp = (await import('sharp')).default
  const jpegBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).jpeg().toBuffer()
  const jpegBase64 = jpegBuffer.toString('base64')
  function fakeMp4Base64() {
    const header = Buffer.alloc(12)
    header.writeUInt32BE(28, 0)
    header.write('ftyp', 4, 'ascii')
    header.write('isom', 8, 'ascii')
    return Buffer.concat([header, Buffer.alloc(16, 0x00)]).toString('base64')
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
      name: 'MediaTestPup', sex: 'female', status: 'active', dateOfBirth: '2026-01-01',
      photos: [], videos: [], ...extra,
    })
  }

  // ── Test 0 (Codex fix-round, "Upload consistency"): if the Firestore
  // write AFTER a successful Storage write fails, the just-uploaded
  // object must be deleted, never left orphaned. Real fault injection
  // (not a mock): the dog document is deleted WHILE the upload is
  // mid-flight — after the handler's initial existence/ownership read
  // already passed, but before its later `.update()` call, which is
  // exactly the "Storage write already succeeded, Firestore write about
  // to fail" window this finding is about. Admin SDK `.update()` (never
  // `.set()`) genuinely throws NOT_FOUND against a real Firestore
  // (emulator) when the target document no longer exists — a real
  // failure, not a simulated one.
  //
  // Deliberately runs FIRST, before Tests 1-10 below generate their own
  // Storage traffic — during investigation, this exact race was found to
  // become unreliable (the Storage emulator's own file-listing index
  // lagging well behind a delete() that had already completed with no
  // error) specifically when run AFTER substantial prior Storage activity
  // in the same process; run standalone/first, it reproduces cleanly. ──
  {
    const owner = await newUser('m0owner')
    const dogId = `m0dog_${R}`
    await seedDog(owner.uid, dogId)

    const res = mockRes()
    const uploadPromise = uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), res)
    // Small delay so the handler's own initial dogSnap.get() (existence +
    // ownership check) has already completed before the doc disappears —
    // this must race the WRITE, not the initial read.
    await new Promise(resolve => setTimeout(resolve, 20))
    await seedDb.collection('dogs').doc(dogId).delete()
    await uploadPromise

    check('0', 'The request surfaces the genuine Firestore write failure as a 500, not a false 200', res.statusCode === 500, JSON.stringify(res.body))
    const after = await bucket.getFiles({ prefix: `dogs/${owner.uid}/${dogId}/` })
    check('0', 'The Storage object that was successfully uploaded moments earlier is deleted, not left orphaned', after[0].length === 0)
  }

  // ── Test 1: authorized owner uploads a real JPEG photo ──
  {
    const owner = await newUser('m1owner')
    const dogId = `m1dog_${R}`
    await seedDog(owner.uid, dogId)

    const res = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), res)
    check('1', 'Upload succeeds (200)', res.statusCode === 200, JSON.stringify(res.body))
    check('1', 'The response includes a new mediaId', typeof res.body?.mediaId === 'string' && res.body.mediaId.length > 0)
    check('1', 'photos[] now contains exactly one signed {id,url} entry', res.body?.photos?.length === 1 && typeof res.body.photos[0].id === 'string' && typeof res.body.photos[0].url === 'string')
    check('1', 'The returned photo id matches the returned mediaId', res.body.photos[0].id === res.body.mediaId)
    check('1', 'videos[] is untouched (still empty)', res.body?.videos?.length === 0)
    // NOTE: a valid GCS signed URL necessarily embeds the object's path
    // as part of the URL itself (that's how the signature resolves to a
    // specific object) — asserting the path is absent from the URL would
    // be asserting something structurally impossible for a signed URL,
    // not a real security property. What actually matters (and IS
    // asserted below): the path is never usable withOUT that signature,
    // and no separate, standalone/reusable path is ever returned.

    const dogAfter = (await seedDb.collection('dogs').doc(dogId).get()).data()
    check('1', 'dog.photos in Firestore stores exactly one {id, path} MediaItem', dogAfter.photos.length === 1 && dogAfter.photos[0].id === res.body.mediaId && typeof dogAfter.photos[0].path === 'string')
    check('1', 'The stored Storage path is private (under dogs/{uid}/{dogId}/photos/)', dogAfter.photos[0].path.startsWith(`dogs/${owner.uid}/${dogId}/photos/`))
    const [exists] = await bucket.file(dogAfter.photos[0].path).exists()
    check('1', 'The file actually exists in Storage (real write, not just a Firestore field)', exists === true)

    // Codex fix-round ("Revocable media delivery") — the file was never
    // made public; the only way to obtain a usable URL for it is a fresh
    // call to signMediaItems() (a real, working codepath — confirmed here
    // by calling it directly against the stored path).
    const { signMediaItems } = await import('../api/_lib/showcase-media-access.js')
    const [reSigned] = await signMediaItems(bucket, [{ id: res.body.mediaId, path: dogAfter.photos[0].path }])
    check('1', 'The stored private path can only be turned into a URL via signMediaItems() — confirmed it actually produces one', typeof reSigned?.url === 'string')
  }

  // ── Test 1b: get-showcase-media-urls.js — the breeder's own
  // authenticated view of an already-uploaded gallery ──
  {
    const owner = await newUser('m1bowner')
    const stranger = await newUser('m1bstranger')
    const dogId = `m1bdog_${R}`
    await seedDog(owner.uid, dogId)
    const uploadRes = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), uploadRes)

    const ownerRes = mockRes()
    await getMediaUrlsHandler(mockReq({ dogId }, owner.idToken), ownerRes)
    check('1b', 'The owning breeder can fetch signed URLs for their own puppy\'s gallery', ownerRes.statusCode === 200)
    check('1b', 'The response includes the uploaded photo', ownerRes.body?.photos?.length === 1 && ownerRes.body.photos[0].id === uploadRes.body.mediaId)

    const strangerRes = mockRes()
    await getMediaUrlsHandler(mockReq({ dogId }, stranger.idToken), strangerRes)
    check('1b', 'An unrelated stranger is denied (403)', strangerRes.statusCode === 403)

    const noAuthRes = mockRes()
    await getMediaUrlsHandler(mockReq({ dogId }, undefined), noAuthRes)
    check('1b', 'An unauthenticated request is denied (401)', noAuthRes.statusCode === 401)
  }

  // ── Test 2: a garbage/invalid file is rejected before any Storage write ──
  {
    const owner = await newUser('m2owner')
    const dogId = `m2dog_${R}`
    await seedDog(owner.uid, dogId)
    const res = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: Buffer.from('not a real image').toString('base64'), kind: 'photo' }, owner.idToken), res)
    check('2', 'A non-image file is rejected with 400', res.statusCode === 400)
    check('2', 'photos[] stays empty after the rejected attempt', (await seedDb.collection('dogs').doc(dogId).get()).data().photos.length === 0)
  }

  // ── Test 3: an unrelated stranger cannot upload media for someone
  // else's puppy (tenant isolation / IDOR) ──
  {
    const owner = await newUser('m3owner')
    const stranger = await newUser('m3stranger')
    const dogId = `m3dog_${R}`
    await seedDog(owner.uid, dogId)
    const res = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, stranger.idToken), res)
    check('3', 'An unrelated stranger is denied (403)', res.statusCode === 403)
    check('3', 'No photo was added', (await seedDb.collection('dogs').doc(dogId).get()).data().photos.length === 0)
  }

  // ── Test 4: a restricted puppy denies new media (matches the exact
  // same canAddDogRecord() gate every other dog-content upload uses) ──
  {
    const owner = await newUser('m4owner')
    const dogId = `m4dog_${R}`
    await seedDog(owner.uid, dogId, { status: 'restricted' })
    const res = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), res)
    check('4', 'A restricted puppy denies new media uploads (403)', res.statusCode === 403)
  }

  // ── Test 5: video upload ──
  {
    const owner = await newUser('m5owner')
    const dogId = `m5dog_${R}`
    await seedDog(owner.uid, dogId)
    const res = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: fakeMp4Base64(), kind: 'video' }, owner.idToken), res)
    check('5', 'A recognized video type uploads successfully', res.statusCode === 200, JSON.stringify(res.body))
    check('5', 'videos[] now has one signed {id,url} entry', res.body?.videos?.length === 1 && res.body.videos[0].id === res.body.mediaId)
    const dogAfter = (await seedDb.collection('dogs').doc(dogId).get()).data()
    check('5', 'The stored path is under dogs/{uid}/{dogId}/videos/', dogAfter.videos[0].path.startsWith(`dogs/${owner.uid}/${dogId}/videos/`))
  }

  // ── Test 6: reorder via update-showcase-media.js (id-based, never URL-based) ──
  // Uses two DIFFERENT images (not the same fixture twice) — Test 11
  // below adds duplicate-content rejection, so this setup must reflect a
  // realistic two-distinct-photos gallery, which is what reordering is
  // actually for anyway.
  {
    const owner = await newUser('m6owner')
    const dogId = `m6dog_${R}`
    await seedDog(owner.uid, dogId)
    const secondJpegBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'green' } }).jpeg().toBuffer()
    const first = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), first)
    const second = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: secondJpegBuffer.toString('base64'), kind: 'photo' }, owner.idToken), second)
    const [idA, idB] = second.body.photos.map(p => p.id)
    check('6', 'Sanity: two photos exist before reordering', second.body.photos.length === 2)

    const reorderRes = mockRes()
    await updateMediaHandler(mockReq({ dogId, kind: 'photo', order: [idB, idA] }, owner.idToken), reorderRes)
    check('6', 'Reorder succeeds', reorderRes.statusCode === 200)
    check('6', 'The new cover (index 0) is what was previously second', reorderRes.body.photos[0].id === idB)
    const dogAfter = (await seedDb.collection('dogs').doc(dogId).get()).data()
    const pathById = new Map(dogAfter.photos.map(p => [p.id, p.path]))
    check('6', 'Both original files still exist in Storage — a reorder must never delete anything',
      (await bucket.file(pathById.get(idA)).exists())[0] === true &&
      (await bucket.file(pathById.get(idB)).exists())[0] === true)
  }

  // ── Test 7: delete via update-showcase-media.js — Firestore array
  // shrinks AND the underlying Storage object is actually removed
  // (orphan-file prevention) ──
  {
    const owner = await newUser('m7owner')
    const dogId = `m7dog_${R}`
    await seedDog(owner.uid, dogId)
    const m7SecondJpegBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'yellow' } }).jpeg().toBuffer()
    const first = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), first)
    const second = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: m7SecondJpegBuffer.toString('base64'), kind: 'photo' }, owner.idToken), second)
    const [idA, idB] = second.body.photos.map(p => p.id)
    const beforeDelete = (await seedDb.collection('dogs').doc(dogId).get()).data()
    const pathA = beforeDelete.photos.find(p => p.id === idA).path

    const deleteRes = mockRes()
    await updateMediaHandler(mockReq({ dogId, kind: 'photo', order: [idB] }, owner.idToken), deleteRes)
    check('7', 'Delete succeeds', deleteRes.statusCode === 200)
    check('7', 'photos[] now has exactly the one remaining item', deleteRes.body.photos.length === 1 && deleteRes.body.photos[0].id === idB)
    const [stillExists] = await bucket.file(pathA).exists()
    check('7', 'The deleted photo\'s Storage object is actually gone (no orphaned file)', stillExists === false)
  }

  // ── Test 8: IDOR — order[] cannot contain an id that was never part
  // of this puppy's own media (proves reorder/delete can never be used
  // to inject an arbitrary new item) ──
  {
    const owner = await newUser('m8owner')
    const dogId = `m8dog_${R}`
    await seedDog(owner.uid, dogId)
    const uploadRes = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), uploadRes)
    const legitId = uploadRes.body.mediaId

    const injectRes = mockRes()
    await updateMediaHandler(mockReq({ dogId, kind: 'photo', order: [legitId, 'attacker-supplied-fake-id'] }, owner.idToken), injectRes)
    check('8', 'An order[] containing an unknown id is rejected outright (400)', injectRes.statusCode === 400 && injectRes.body?.reason === 'UNKNOWN_MEDIA_ITEM')
    check('8', 'The original photos array is unchanged after the rejected attempt', (await seedDb.collection('dogs').doc(dogId).get()).data().photos.length === 1)
  }

  // ── Test 9: update-showcase-media.js also enforces ownership ──
  {
    const owner = await newUser('m9owner')
    const stranger = await newUser('m9stranger')
    const dogId = `m9dog_${R}`
    await seedDog(owner.uid, dogId)
    const uploadRes = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), uploadRes)

    const res = mockRes()
    await updateMediaHandler(mockReq({ dogId, kind: 'photo', order: [] }, stranger.idToken), res)
    check('9', 'A stranger cannot reorder/delete another breeder\'s puppy media (403)', res.statusCode === 403)
  }

  // ── Test 10 (Codex fix-round, "Upload consistency"): a REJECTED upload
  // (fails before any Storage write is even attempted) must never leave
  // an orphaned Storage object behind either — the simpler of the two
  // "no orphan" guarantees, confirmed here by listing the dog's own
  // Storage prefix directly (not just trusting the Firestore field). ──
  {
    const owner = await newUser('m10owner')
    const dogId = `m10dog_${R}`
    await seedDog(owner.uid, dogId)
    const before = await bucket.getFiles({ prefix: `dogs/${owner.uid}/${dogId}/` })
    check('10', 'Sanity: no files exist yet for this dog', before[0].length === 0)

    const res = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: Buffer.from('not a real image').toString('base64'), kind: 'photo' }, owner.idToken), res)
    check('10', 'A rejected (invalid-file) upload attempt is a 400, not a partial success', res.statusCode === 400)

    const after = await bucket.getFiles({ prefix: `dogs/${owner.uid}/${dogId}/` })
    check('10', 'No Storage object was created for a request that never reached a successful Storage write (no orphan)', after[0].length === 0)
  }

  // ── Test 11 (Tony live-staging fix round, "Prevent duplicate
  // upload"): re-uploading the exact same file content for the same
  // puppy is rejected — content is hashed AFTER processing, so it
  // survives an identical re-upload rather than needing byte-identical
  // input. A DIFFERENT file must still upload fine. ──
  {
    const owner = await newUser('m11owner')
    const dogId = `m11dog_${R}`
    await seedDog(owner.uid, dogId)

    const first = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), first)
    check('11', 'Sanity: the first upload succeeds', first.statusCode === 200)

    const dupe = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), dupe)
    check('11', 'Re-uploading the exact same photo content for the same puppy is rejected (409)', dupe.statusCode === 409 && dupe.body?.reason === 'DUPLICATE_MEDIA')
    check('11', 'The duplicate rejection left the gallery unchanged (still exactly 1 photo)', (await seedDb.collection('dogs').doc(dogId).get()).data().photos.length === 1)

    const differentJpegBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'blue' } }).jpeg().toBuffer()
    const different = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: differentJpegBuffer.toString('base64'), kind: 'photo' }, owner.idToken), different)
    check('11', 'A genuinely different photo still uploads fine for the same puppy', different.statusCode === 200 && different.body.photos.length === 2)
  }

  await summary()
} else {
  skip('Section 2 emulator end-to-end (Litter Showcase media pipeline)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST/FIREBASE_STORAGE_EMULATOR_HOST and start the emulators to run them')
  summary()
}
