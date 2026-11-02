// Lab Web Vitals for a built dist/ (vite preview). Same conditions for
// before/after. Profiles: slow4g (Lighthouse mobile: 150 ms RTT, 1.6 Mbps,
// 4x CPU) and wifi (28 ms, 30 Mbps, 1x CPU). External hosts (Google Fonts,
// Firebase, Meta) are not reachable from CI: fonts CSS is answered with an
// empty stylesheet after 3 RTTs (models DNS+TLS+request of a render-blocking
// third-party stylesheet); everything else external is aborted.
import { chromium } from 'playwright'
const base = process.env.PERF_BASE || 'http://127.0.0.1:4173'
const paths = (process.env.PERF_PATHS || '/,/signup').split(',')
const runs = Number(process.env.PERF_RUNS || 3)
const profiles = {
  slow4g: { latency: 150, down: 1.6e6 / 8, up: 750e3 / 8, cpu: 4 },
  wifi: { latency: 28, down: 30e6 / 8, up: 15e6 / 8, cpu: 1 },
}
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const browser = await chromium.launch(process.env.PERF_CHROME ? { executablePath: process.env.PERF_CHROME } : {})
const out = {}
for (const [name, p] of Object.entries(profiles)) {
  for (const path of paths) {
    const samples = []
    for (let i = 0; i < runs; i++) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]' })
      const page = await ctx.newPage()
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async route => {
        const u = route.request().url()
        if (/fonts\.googleapis\.com/.test(u)) { await new Promise(r => setTimeout(r, p.latency * 3)); return route.fulfill({ status: 200, contentType: 'text/css', body: '' }) }
        return route.abort()
      })
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up })
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu })
      let bytes = 0
      cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength })
      await page.addInitScript(() => {
        window.__v = { lcp: 0, cls: 0 }
        new PerformanceObserver(l => { for (const e of l.getEntries()) window.__v.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
        new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
      })
      const t0 = Date.now()
      await page.goto(base + path, { waitUntil: 'load', timeout: 120000 })
      const load = Date.now() - t0
      await page.waitForTimeout(1500)
      // INP proxy: time from a tap to the next paint on the first visible button/link.
      const inp = await page.evaluate(async () => {
        const el = [...document.querySelectorAll('button, a')].find(e => e.getBoundingClientRect().height > 0 && !e.getAttribute('href')?.startsWith('http'))
        if (!el) return null
        const t = performance.now()
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
        return performance.now() - t
      })
      const v = await page.evaluate(() => ({ ...window.__v, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0 }))
      samples.push({ ...v, load, inp, kb: bytes / 1024 })
      await ctx.close()
    }
    out[`${name} ${path}`] = Object.fromEntries(['fcp', 'lcp', 'cls', 'load', 'inp', 'kb'].map(k => [k, Math.round(median(samples.map(s => s[k] ?? 0)) * (k === 'cls' ? 1000 : 1)) / (k === 'cls' ? 1000 : 1)]))
  }
}
await browser.close()
console.table(out)
console.log(JSON.stringify(out))
