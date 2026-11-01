// Encodes the passport QR exactly as DogDetailPage does, then decodes it with an
// independent decoder (jsQR) to prove the printed code yields the canonical link.
import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { PNG } from 'pngjs'
import jsQR from 'jsqr'

async function roundTrip(text) {
  const buffer = await QRCode.toBuffer(text, { width: 200, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#1A3A2A', light: '#FFFFFF' } })
  const png = PNG.sync.read(buffer)
  return { decoded: jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, width: png.width }
}

describe('QR passport encode → decode', () => {
  it('decodes to the canonical HTTPS passport URL at the app size and colours', async () => {
    const url = 'https://idogs.com.au/p/PIN-2026-NS3V'
    const { decoded, width } = await roundTrip(url)
    expect(width).toBe(200)
    expect(decoded).toBe(url)
  })
  it('long passport ids still decode at 200px with high error correction', async () => {
    const url = 'https://idogs.com.au/p/NNG-2023-LM3W-EXTRA-LONG-IDENTIFIER-0001'
    expect((await roundTrip(url)).decoded).toBe(url)
  })
  it('brand colours keep strong contrast for phone cameras', () => {
    const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    const ratio = (lum('#FFFFFF') + 0.05) / (lum('#1A3A2A') + 0.05)
    expect(ratio).toBeGreaterThan(7)
  })
})
