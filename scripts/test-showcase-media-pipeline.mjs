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
    /try \{\s*\n\s*await bucket\.file\(path\)\.delete\(\)/.test(updateMediaSrc))

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
  check('Dog.photos remains an ordered string[] (index 0 = cover — no separate isCover flag needed)', /photos: string\[\]/.test(typesSrc))
  check('Dog declares an optional videos?: string[] field, same ordered-array convention', /videos\?: string\[\]/.test(typesSrc))
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
  function extractStoragePath(fileUrl, bucketName) {
    const prefix = `https://storage.googleapis.com/${bucketName}/`
    return fileUrl.startsWith(prefix) ? fileUrl.slice(prefix.length) : null
  }

  // ── Test 1: authorized owner uploads a real JPEG photo ──
  {
    const owner = await newUser('m1owner')
    const dogId = `m1dog_${R}`
    await seedDog(owner.uid, dogId)

    const res = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), res)
    check('1', 'Upload succeeds (200)', res.statusCode === 200, JSON.stringify(res.body))
    check('1', 'The response includes the new fileUrl', typeof res.body?.fileUrl === 'string')
    check('1', 'photos[] now contains exactly one entry', res.body?.photos?.length === 1)
    check('1', 'videos[] is untouched (still empty)', res.body?.videos?.length === 0)

    const path = extractStoragePath(res.body.fileUrl, bucket.name)
    check('1', 'The stored file path is under dogs/{uid}/{dogId}/photos/', path?.startsWith(`dogs/${owner.uid}/${dogId}/photos/`))
    const [exists] = await bucket.file(path).exists()
    check('1', 'The file actually exists in Storage (real write, not just a Firestore field)', exists === true)

    const dogAfter = (await seedDb.collection('dogs').doc(dogId).get()).data()
    check('1', 'dog.photos in Firestore matches the returned array', JSON.stringify(dogAfter.photos) === JSON.stringify(res.body.photos))
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
    check('5', 'videos[] now has one entry', res.body?.videos?.length === 1)
    const path = extractStoragePath(res.body.fileUrl, bucket.name)
    check('5', 'The stored path is under dogs/{uid}/{dogId}/videos/', path?.startsWith(`dogs/${owner.uid}/${dogId}/videos/`))
  }

  // ── Test 6: reorder via update-showcase-media.js ──
  {
    const owner = await newUser('m6owner')
    const dogId = `m6dog_${R}`
    await seedDog(owner.uid, dogId)
    const first = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), first)
    const second = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), second)
    const [urlA, urlB] = second.body.photos
    check('6', 'Sanity: two photos exist before reordering', second.body.photos.length === 2)

    const reorderRes = mockRes()
    await updateMediaHandler(mockReq({ dogId, kind: 'photo', order: [urlB, urlA] }, owner.idToken), reorderRes)
    check('6', 'Reorder succeeds', reorderRes.statusCode === 200)
    check('6', 'The new cover (index 0) is what was previously second', reorderRes.body.photos[0] === urlB)
    check('6', 'Both original files still exist in Storage — a reorder must never delete anything',
      (await bucket.file(extractStoragePath(urlA, bucket.name)).exists())[0] === true &&
      (await bucket.file(extractStoragePath(urlB, bucket.name)).exists())[0] === true)
  }

  // ── Test 7: delete via update-showcase-media.js — Firestore array
  // shrinks AND the underlying Storage object is actually removed
  // (orphan-file prevention) ──
  {
    const owner = await newUser('m7owner')
    const dogId = `m7dog_${R}`
    await seedDog(owner.uid, dogId)
    const first = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), first)
    const second = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), second)
    const [urlA, urlB] = second.body.photos
    const pathA = extractStoragePath(urlA, bucket.name)

    const deleteRes = mockRes()
    await updateMediaHandler(mockReq({ dogId, kind: 'photo', order: [urlB] }, owner.idToken), deleteRes)
    check('7', 'Delete succeeds', deleteRes.statusCode === 200)
    check('7', 'photos[] now has exactly the one remaining item', deleteRes.body.photos.length === 1 && deleteRes.body.photos[0] === urlB)
    const [stillExists] = await bucket.file(pathA).exists()
    check('7', 'The deleted photo\'s Storage object is actually gone (no orphaned file)', stillExists === false)
  }

  // ── Test 8: IDOR — order[] cannot contain a URL that was never part
  // of this puppy's own media (proves reorder/delete can never be used
  // to inject an arbitrary new URL) ──
  {
    const owner = await newUser('m8owner')
    const dogId = `m8dog_${R}`
    await seedDog(owner.uid, dogId)
    const uploadRes = mockRes()
    await uploadMediaHandler(mockReq({ dogId, base64: jpegBase64, kind: 'photo' }, owner.idToken), uploadRes)
    const legitUrl = uploadRes.body.photos[0]

    const injectRes = mockRes()
    await updateMediaHandler(mockReq({ dogId, kind: 'photo', order: [legitUrl, 'https://storage.googleapis.com/attacker-bucket/evil.jpg'] }, owner.idToken), injectRes)
    check('8', 'An order[] containing an unknown URL is rejected outright (400)', injectRes.statusCode === 400 && injectRes.body?.reason === 'UNKNOWN_MEDIA_ITEM')
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

  await summary()
} else {
  skip('Section 2 emulator end-to-end (Litter Showcase media pipeline)', 'set FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST/FIREBASE_STORAGE_EMULATOR_HOST and start the emulators to run them')
  summary()
}
