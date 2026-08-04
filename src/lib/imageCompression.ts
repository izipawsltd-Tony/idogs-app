// src/lib/imageCompression.ts — client-side image compression for the
// Litter Showcase media queue (Tony live-staging fix round: "large-image
// upload 413").
//
// ROOT CAUSE: Vercel's Serverless Functions (this project's api/*.js are
// "Other" framework preset, not Next.js) reject any request body over
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
// HEIC/HEIF: browsers cannot decode HEIC into an <img>/canvas at all
// (only Safari; img.onload never fires in Chrome/Firefox/Edge — see
// lib/heic.ts's own header comment) — client-side compression is not
// possible for it. Sent raw, exactly as PhotoUpload.tsx already does;
// api/_lib/image-pipeline.js's server-side heic-convert decode+resize is
// the only place HEIC can be shrunk. A HEIC file is capped separately
// (MAX_HEIC_UPLOAD_BYTES) since it skips this module's own compression
// and goes over the wire at its original size.

import { isHeicFile } from './heic'

const MAX_GALLERY_DIMENSION = 1600
const JPEG_QUALITY = 0.85

// Comfortably under Vercel's ~4.5MB Serverless Function body ceiling
// even after this file is base64-encoded (~33% larger) and combined with
// the rest of a small JSON request body. A HEIC file skips compression
// entirely (see header comment) and travels at its original size, so it
// needs its own, much stricter pre-flight ceiling — everything else is
// compressed by this module first and essentially never approaches this
// limit regardless of the original file's size.
export const MAX_HEIC_UPLOAD_BYTES = 3 * 1024 * 1024

// Videos are never compressed client-side (no safe, dependency-free way
// to transcode video in-browser) — the only lever available is refusing
// a video that would blow the request body ceiling with a clear,
// actionable message instead of a cryptic platform 413.
export const MAX_VIDEO_UPLOAD_BYTES = 3 * 1024 * 1024

export class ImageCompressionError extends Error {
  code: 'UNREADABLE' | 'TIMEOUT'
  constructor(code: 'UNREADABLE' | 'TIMEOUT', message: string) {
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
      let { width, height } = img
      if (width > maxDimension || height > maxDimension) {
        if (width > height) { height = Math.round(height * maxDimension / width); width = maxDimension }
        else { width = Math.round(width * maxDimension / height); height = maxDimension }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
    }
    img.onerror = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      reject(new ImageCompressionError('UNREADABLE', 'This image could not be read — it may be corrupt or an unsupported format'))
    }
    img.src = url
  })
}

// The one entry point Showcase media upload should call for a PHOTO
// file: compresses everything client-side CAN compress, and passes HEIC
// through untouched for the server's own pipeline to handle — mirrors
// PhotoUpload.tsx's own handleFile() branch exactly, just extracted so
// it isn't duplicated a third time.
export async function prepareImageForUpload(file: File): Promise<{ base64: string; mediaType: string }> {
  if (isHeicFile(file)) {
    const base64 = await readFileAsBase64(file)
    return { base64, mediaType: file.type || 'image/heic' }
  }
  return compressImageFile(file)
}
