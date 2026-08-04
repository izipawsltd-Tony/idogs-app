// src/lib/imageCompression.ts — client-side image compression for the
// Litter Showcase media queue (Tony live-staging fix round: "large-image
// upload 413"; HEIC/HEIF decode added in a later fix round — see below).
//
// ROOT CAUSE (413): Vercel's Serverless Functions (this project's api/*.js
// are "Other" framework preset, not Next.js) reject any request body over
// ~4.5MB with a platform-level 413 BEFORE the function ever runs — no
// vercel.json override exists in this repo (confirmed: no
// `functions`/`api` body-size config anywhere). A real phone photo,
// base64-encoded (~33% larger than raw), routinely exceeds that on its
// own, long before api/_lib/image-pipeline.js's own much more generous
// MAX_IMAGE_INPUT_BYTES (30MB) check ever gets a chance to run. The fix
// is client-side: shrink the image comfortably under that ceiling BEFORE
// it's ever base64-encoded and sent.
//
// Reuses the exact resize technique PhotoUpload.tsx's own resizeImage()
// already established (canvas draw + toDataURL) — not a call to that
// function (its 800px cap is tuned for a small avatar; a Showcase gallery
// photo is shown much larger — puppy card cover, full-width dialog image
// — and needs more resolution), extracted here as a general, reusable
// utility instead of a second inline copy.
//
// Orientation: modern browsers (Chrome/Firefox/Safari, all current
// versions) apply EXIF orientation automatically when decoding an <img>
// for display/drawImage() — this has been standard browser behavior for
// years (CSS `image-orientation: from-image` is the default), so the
// canvas this function draws into is already correctly oriented with no
// extra EXIF-reading code needed, matching PhotoUpload.tsx's own
// (already-approved) assumption.
//
// HEIC/HEIF (Tony live-staging fix round: "HEIC upload fails"): browsers
// cannot decode HEIC into an <img>/canvas at all (only Safari; img.onload
// never fires in Chrome/Firefox/Edge — see lib/heic.ts's own header
// comment). The PREVIOUS version of this module worked around that by
// sending a HEIC file raw (uncompressed, at its original size) and
// capping it at a small MAX_HEIC_UPLOAD_BYTES (3MB) so it would still fit
// under Vercel's ~4.5MB body ceiling after base64 inflation — but a real
// iPhone HEIC photo routinely runs 3-8MB, so that ceiling silently
// rejected most ordinary photos. This is fixed properly now: HEIC/HEIF is
// decoded IN THE BROWSER via libheif-js's WASM build (an already-declared
// transitive dependency of this project's `heic-convert` package — no new
// npm dependency added), painted onto a canvas, and run through the exact
// same resize/re-encode pipeline every other photo uses — so a HEIC photo
// of any realistic size ends up as a small compressed JPEG before it's
// ever sent, exactly like JPEG/PNG/WebP already are. Dynamically imported
// (`import('libheif-js/wasm-bundle')`) so the ~1.4MB WASM bundle is only
// ever downloaded when a HEIC/HEIF file is actually selected — zero
// bundle-size cost for every other upload. WebAssembly itself has been
// supported in every browser this app targets (Chrome/Firefox/Safari/
// Edge) for years, so no additional browser-compatibility gate is needed
// beyond what decodeHeicToCanvas() already handles (a failure to load or
// instantiate the WASM module is caught and surfaced the same way as any
// other decode failure, never left to crash silently).
//
// Server-side, api/_lib/image-pipeline.js's own heic-convert-based HEIC
// decode is left completely untouched by this change — it remains the
// authoritative fallback for any other upload path in this codebase that
// might still send a raw HEIC file (e.g. api/upload.js's dog-avatar
// upload, which does not go through this module).

import { isHeicFile } from './heic'

const MAX_GALLERY_DIMENSION = 1600
const JPEG_QUALITY = 0.85

// Videos are never compressed client-side (no safe, dependency-free way
// to transcode video in-browser) — the only lever available is refusing
// a video that would blow the request body ceiling with a clear,
// actionable message instead of a cryptic platform 413.
export const MAX_VIDEO_UPLOAD_BYTES = 3 * 1024 * 1024

export class ImageCompressionError extends Error {
  code: 'UNREADABLE' | 'TIMEOUT' | 'HEIC_DECODE_FAILED'
  constructor(code: 'UNREADABLE' | 'TIMEOUT' | 'HEIC_DECODE_FAILED', message: string) {
    super(message)
    this.code = code
  }
}

export function readFileAsBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(new ImageCompressionError('UNREADABLE', 'This file could not be read'))
    reader.readAsDataURL(file)
  })
}

// Shared resize math, extracted so both the <img>-based path (JPEG/PNG/
// WebP/already-decoded-HEIC) below can use the exact same box-fit/
// re-encode logic instead of two copies of it.
function resizeAndEncodeJpeg(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
  quality: number
): { base64: string; mediaType: string } {
  let width = sourceWidth
  let height = sourceHeight
  if (width > maxDimension || height > maxDimension) {
    if (width > height) { height = Math.round(height * maxDimension / width); width = maxDimension }
    else { width = Math.round(width * maxDimension / height); height = maxDimension }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(source, 0, 0, width, height)
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' }
}

// Generalized version of PhotoUpload.tsx's resizeImage() — same
// technique (draw into a canvas at a capped dimension, re-encode as
// JPEG), parameterized so the Showcase gallery can use a larger target
// than a small avatar needs.
export function compressImageFile(file: File | Blob, maxDimension = MAX_GALLERY_DIMENSION, quality = JPEG_QUALITY): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    // Same safety net as PhotoUpload.tsx's resizeImage(): some
    // unsupported/corrupt formats never fire onload OR onerror in every
    // browser — fail after 10s instead of leaving the caller stuck
    // forever with no feedback.
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url)
      reject(new ImageCompressionError('TIMEOUT', 'This image could not be processed — it may be an unsupported format'))
    }, 10000)
    img.onload = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      resolve(resizeAndEncodeJpeg(img, img.width, img.height, maxDimension, quality))
    }
    img.onerror = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      reject(new ImageCompressionError('UNREADABLE', 'This image could not be read — it may be corrupt or an unsupported format'))
    }
    img.src = url
  })
}

// Cached across calls within the same page session — the WASM module only
// ever needs to be fetched/instantiated once, even if the breeder queues
// several HEIC photos in one Showcase session.
let libheifModulePromise: Promise<any> | null = null
function loadLibheif(): Promise<any> {
  if (!libheifModulePromise) {
    libheifModulePromise = import('libheif-js/wasm-bundle').then(mod => {
      const exported: any = (mod as any).default ?? mod
      // libheif-js's wasm-bundle entry point synchronously invokes its
      // Emscripten factory and exports whatever that call returns —
      // depending on the exact build, that can be either the ready
      // module object or a Promise that resolves to it. `await`-ing a
      // non-thenable value is a documented no-op that just resolves
      // immediately to that same value, so this line is correct for
      // either shape without needing to know which one this bundle
      // actually produces.
      return exported
    }).catch(err => {
      libheifModulePromise = null // allow a retry on the NEXT HEIC file rather than caching a permanent failure
      throw err
    })
  }
  return libheifModulePromise
}

// Decodes a HEIC/HEIF file's ACTUAL pixel content via libheif-js (never
// trusts the .heic/.heif extension alone — a file that merely looks like
// HEIC by name but isn't real/decodable content fails here with a clear
// error, exactly like a corrupt JPEG already fails compressImageFile's
// own onerror/timeout path above) and returns a canvas ready to feed into
// resizeAndEncodeJpeg. HEIF's rotation/mirror transformative properties
// (irot/imir) are, per the HEIF spec, mandatorily-applied derivations —
// unlike a JPEG's separate EXIF orientation tag (a hint a consumer must
// apply manually), libheif's own decoded pixel output is already
// correctly oriented, so no extra orientation-correction step is needed
// here (matching this module's existing JPEG-path assumption above).
async function decodeHeicToCanvas(file: File): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  let libheif: any
  try {
    libheif = await loadLibheif()
  } catch {
    throw new ImageCompressionError('HEIC_DECODE_FAILED', 'Could not load the HEIC image decoder — check your connection and try again, or convert this photo to JPEG first')
  }

  const buffer = new Uint8Array(await file.arrayBuffer())

  let images: any[]
  try {
    const decoder = new libheif.HeifDecoder()
    images = decoder.decode(buffer)
  } catch {
    throw new ImageCompressionError('HEIC_DECODE_FAILED', 'This HEIC/HEIF file could not be read — it may be corrupted or an unsupported variant')
  }
  // Validates DECODED CONTENT, not just the file extension/MIME type — a
  // file merely named "*.heic" that isn't real HEIC/HEIF content decodes
  // to zero images here rather than being trusted on name alone.
  if (!Array.isArray(images) || images.length === 0) {
    throw new ImageCompressionError('HEIC_DECODE_FAILED', 'This file could not be read as a HEIC/HEIF image')
  }

  const image = images[0]
  const width = typeof image?.get_width === 'function' ? image.get_width() : NaN
  const height = typeof image?.get_height === 'function' ? image.get_height() : NaN
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ImageCompressionError('HEIC_DECODE_FAILED', 'This HEIC/HEIF file has invalid image dimensions')
  }

  // Same 10s safety-net pattern as compressImageFile's img.onload/onerror
  // above — image.display()'s callback is not guaranteed to fire for
  // every malformed input.
  const pixels: Uint8ClampedArray = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new ImageCompressionError('HEIC_DECODE_FAILED', 'This HEIC/HEIF file took too long to decode'))
    }, 15000)
    try {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (displayData: { data: Uint8ClampedArray } | null) => {
        clearTimeout(timeout)
        if (!displayData) {
          reject(new ImageCompressionError('HEIC_DECODE_FAILED', 'This HEIC/HEIF file could not be decoded into an image'))
          return
        }
        resolve(displayData.data)
      })
    } catch {
      clearTimeout(timeout)
      reject(new ImageCompressionError('HEIC_DECODE_FAILED', 'This HEIC/HEIF file could not be decoded into an image'))
    }
  })

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  // The `pixels` buffer was allocated by this function itself (a plain
  // ArrayBuffer, never SharedArrayBuffer) just above — this cast only
  // narrows TS DOM lib's overly-generic Uint8ClampedArray<ArrayBufferLike>
  // inference back to what the ImageData constructor's types expect.
  canvas.getContext('2d')!.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
  return { canvas, width, height }
}

// The one entry point Showcase media upload should call for a PHOTO
// file: HEIC/HEIF is now decoded and compressed exactly like every other
// format (see this module's own header comment for why sending it raw
// was the actual root cause of "HEIC upload fails"); everything else
// mirrors PhotoUpload.tsx's own handleFile() branch, extracted so it
// isn't duplicated a third time.
export async function prepareImageForUpload(file: File): Promise<{ base64: string; mediaType: string }> {
  if (isHeicFile(file)) {
    const { canvas, width, height } = await decodeHeicToCanvas(file)
    return resizeAndEncodeJpeg(canvas, width, height, MAX_GALLERY_DIMENSION, JPEG_QUALITY)
  }
  return compressImageFile(file)
}
