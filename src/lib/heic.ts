// src/lib/heic.ts — shared client-side HEIC/HEIF detection (Slice 2).
//
// Previously duplicated verbatim in PhotoUpload.tsx and DogDetailPage.tsx
// (the note-photo upload flow) — consolidated here so both share one
// implementation. iPhone .heic/.heif photos can't be decoded by <img> in
// Chrome/Firefox/Edge (only Safari supports it natively) — img.onload
// never fires for these, so a canvas-resize attempt would hang forever
// with no error. Callers detect HEIC up front via this function and skip
// straight to sending the raw file to the server, where
// api/_lib/image-pipeline.js does the actual decode/convert.
//
// Checks BOTH the browser-reported MIME type and the filename extension
// — Slice 2 requirement ("blank/wrong MIME and uppercase .HEIC"): some
// browsers/OS file pickers report an empty or generic `file.type` for
// HEIC (a known gap, not universal), and a case-sensitive extension
// check alone would miss "IMG_1234.HEIC" (the exact filename shape
// iOS's Files app / some sharing flows produce).
export function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  return type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif')
}
