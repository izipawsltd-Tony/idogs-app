export const MAX_HEIC_DECODE_DIMENSION: number
export const MAX_HEIC_DECODE_PIXELS: number
export function validateHeicDecodeDimensions(width: number, height: number):
  | { ok: true; pixels: number; rgbaBytes: number }
  | { ok: false; reason: 'invalid' | 'oversized' }
