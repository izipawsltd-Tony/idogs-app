export const MAX_HEIC_DECODE_DIMENSION = 16384
export const MAX_HEIC_DECODE_PIXELS = 64_000_000

export function validateHeicDecodeDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: 'invalid' }
  }
  if (width > MAX_HEIC_DECODE_DIMENSION || height > MAX_HEIC_DECODE_DIMENSION) {
    return { ok: false, reason: 'oversized' }
  }
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels > MAX_HEIC_DECODE_PIXELS || pixels > Math.floor(Number.MAX_SAFE_INTEGER / 4)) {
    return { ok: false, reason: 'oversized' }
  }
  return { ok: true, pixels, rgbaBytes: pixels * 4 }
}
