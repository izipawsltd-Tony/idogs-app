// Upload benchmark: a 12 MP (4032x3024) phone-like JPEG through the document
// pipeline (canvas resize 2400px, JPEG 0.88) vs. the old raw base64 upload.
// Upload time is computed for a 4G uplink (750 kbps, 150 ms RTT) and Wi-Fi
// (15 Mbps, 28 ms). Prep time is measured in Chromium with 4x CPU throttle.
import { chromium } from 'playwright'
const b = await chromium.launch(process.env.PERF_CHROME ? { executablePath: process.env.PERF_CHROME } : {})
const ctx = await b.newContext(); const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
await page.setContent('<html><body></body></html>')
const r = await page.evaluate(async () => {
  const W = 4032, H = 3024, c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#c9b38a'); grad.addColorStop(0.5, '#6b4f2a'); grad.addColorStop(1, '#e8e1d4'); g.fillStyle = grad; g.fillRect(0, 0, W, H)
  const img = g.getImageData(0, 0, W, H); let seed = 7
  for (let i = 0; i < img.data.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const n = (seed % 41) - 20; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n }
  g.putImageData(img, 0, 0); g.fillStyle = '#111'; g.font = '64px serif'; for (let y = 200; y < H; y += 120) g.fillText('VACCINATION CERTIFICATE — Microchip 956000012345678 — DHPP C5', 120, y)
  const original = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.95))
  const t0 = performance.now()
  const bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(original) })
  const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height)); const cc = document.createElement('canvas'); cc.width = Math.round(bmp.width * s); cc.height = Math.round(bmp.height * s)
  cc.getContext('2d').drawImage(bmp, 0, 0, cc.width, cc.height)
  const b64 = cc.toDataURL('image/jpeg', 0.88).split(',')[1]
  const prepMs = performance.now() - t0
  return { originalBytes: original.size, compressedBytes: Math.ceil(b64.length * 3 / 4), prepMs: Math.round(prepMs), dims: [cc.width, cc.height] }
})
await b.close()
const up = (bytes, kbps, rtt) => Math.round((bytes * 4 / 3) * 8 / (kbps * 1000) * 1000 + rtt * 3)
const out = {
  ...r,
  before_4g_ms: up(r.originalBytes, 750, 150), after_4g_ms: up(r.compressedBytes, 750, 150) + r.prepMs,
  before_wifi_ms: up(r.originalBytes, 15000, 28), after_wifi_ms: up(r.compressedBytes, 15000, 28) + r.prepMs,
  before_over_vercel_limit: r.originalBytes * 4 / 3 > 4.5e6,
}
console.log(JSON.stringify(out))
