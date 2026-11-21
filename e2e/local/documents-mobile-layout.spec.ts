import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// DOC-MOBILE-01 (Owner iPhone QA, 21 Nov 2026): on the Documents page the
// file name, dog label and View/Edit/Delete collided on narrow phones.
// Renders the REAL DocumentsPage + REAL app CSS in the AppLayout mobile shell
// with synthetic data (Firebase modules stubbed at bundle time), then checks
// geometry across the local projects (320/375/390/430, landscape, Pixel 7).

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ORIGIN = 'https://doc-harness.test'
const STUB = `${ROOT}e2e/local/harness/stubs.ts`
const CSS = ['src/index.css', 'src/mobile.css', 'src/mobile-dog-detail-route.css', 'src/mobile-native-qa-polish.css', 'src/components/supportChat.css']

let bundle = ''
test.beforeAll(async () => {
  const out = await build({
    entryPoints: [`${ROOT}e2e/local/harness/documents-page.harness.tsx`],
    bundle: true, write: false, format: 'iife', jsx: 'automatic', target: 'es2020',
    define: { 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'stub-firebase-modules',
      setup(b) {
        b.onResolve({ filter: /(\/lib\/db|\/hooks\/useAuth|\/lib\/firebase)$/ }, () => ({ path: STUB }))
      },
    }],
    logLevel: 'silent',
  })
  bundle = out.outputFiles[0].text
})

const html = () => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<style>${CSS.map(f => readFileSync(`${ROOT}${f}`, 'utf8')).join('\n')}</style></head>
<body><div id="root"><div style="display:flex;min-height:100vh">
  <div class="main-area" style="flex:1;min-width:0;display:flex;flex-direction:column">
    <div class="mobile-topbar" style="display:none;padding:12px 16px;position:sticky;top:0;z-index:40;background:#fff">iDogs</div>
    <main style="flex:1"></main>
  </div>
  <nav class="bottom-nav">${['Home', 'Dogs', 'Reminders', 'Documents', 'Sign out'].map(l => `<a class="bottom-nav-item" href="#"><span>•</span><span>${l}</span></a>`).join('')}</nav>
</div></div><script src="/harness.js"></script></body></html>`

async function open(page: Page, safeAreaBottom = 0) {
  await page.addInitScript(() => {
    const day = (iso: string) => ({ toDate: () => new Date(iso) })
    const dogs = [
      { id: 'dog-qa39', name: 'QA39 Synthetic' },
      { id: 'dog-long', name: 'Synthetic Champion Golden Sunrise Of The Long Name Kennels' },
    ]
    const docs = [
      { id: 'd1', dogId: 'dog-qa39', title: "Mum's pedigree", documentType: 'pedigree', fileType: 'jpg', source: 'manual', filePath: 'synthetic/d1.jpg', uploadedAt: day('2026-11-20') },
      { id: 'd2', dogId: 'dog-long', title: 'Annual vaccination card — C5 booster and kennel cough, synthetic record', documentType: 'vaccine_card', fileType: 'pdf', filePath: 'synthetic/d2.pdf', notes: 'Synthetic note: brought to vet in the second-floor clinic, follow-up due.', extractedData: { vaccines: 3 }, uploadedAt: day('2026-10-02') },
      { id: 'd3', dogId: 'dog-qa39', title: 'Microchip', documentType: 'microchip_cert', fileType: 'png', source: 'manual', filePath: 'synthetic/d3.png', uploadedAt: day('2026-09-15') },
      { id: 'd4', dogId: 'dog-qa39', title: 'HipElbowScoreSheetWithoutAnySpacesSyntheticFileName', documentType: 'health_test', fileType: 'heic', filePath: 'synthetic/d4.heic', uploadedAt: day('2026-08-01') },
      { id: 'd5', dogId: 'dog-long', title: 'Sale contract', documentType: 'contract', fileType: 'pdf', source: 'manual', filePath: 'synthetic/d5.pdf' },
      { id: 'd6', dogId: 'dog-qa39', title: 'Vet record (last)', documentType: 'vet_record', fileType: 'jpg', source: 'manual', filePath: 'synthetic/d6.jpg', uploadedAt: day('2026-07-07') },
    ]
    ;(window as any).__harness = { docs, dogs, deleted: [], updated: [], signed: [] }
  })
  await page.route(`${ORIGIN}/**`, async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/harness.js') return route.fulfill({ contentType: 'text/javascript', body: bundle })
    if (url.pathname === '/api/get-signed-url') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: `${ORIGIN}/synthetic-file` }) })
    if (url.pathname === '/synthetic-file') return route.fulfill({ contentType: 'text/plain', body: 'synthetic' })
    return route.fulfill({ contentType: 'text/html', body: html() })
  })
  if (safeAreaBottom) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride' as any, { insets: { bottom: safeAreaBottom, bottomMax: safeAreaBottom } } as any)
  }
  await page.goto(`${ORIGIN}/app/documents`)
  await expect(page.getByTestId('doc-card')).toHaveCount(6)
}

type Box = { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5
const inside = (a: Box, o: Box) => a.x >= o.x - 0.5 && a.y >= o.y - 0.5 && a.x + a.w <= o.x + o.w + 0.5 && a.y + a.h <= o.y + o.h + 0.5

async function geometry(page: Page) {
  return page.$$eval('[data-testid="doc-card"]', cards => cards.map(card => {
    const r = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }
    const body = card.querySelector('[data-testid="doc-card-body"]')!
    const actions = card.querySelector('[data-testid="doc-card-actions"]')!
    const texts = [...body.querySelectorAll('span, a, div')].filter(e => !e.children.length && (e.textContent || '').trim())
    return {
      card: r(card), body: r(body), actions: r(actions), icon: r(card.firstElementChild!),
      buttons: [...actions.querySelectorAll('button')].map(b => ({ label: (b.textContent || '').trim(), ...r(b) })),
      texts: texts.map(r),
      clipped: card.scrollWidth - card.clientWidth,
    }
  }))
}

test.describe('DOC-MOBILE-01 — Documents cards on phones', () => {
  test('metadata, dog details and View/Edit/Delete never overlap or clip', async ({ page }) => {
    await open(page)
    const vw = page.viewportSize()!.width
    const narrow = vw <= 600
    for (const [i, g] of (await geometry(page)).entries()) {
      const at = `card ${i + 1} @${vw}px`
      expect(g.clipped, `${at}: card content wider than card (hidden by overflow-x)`).toBeLessThanOrEqual(1)
      expect(g.card.x + g.card.w, `${at}: card exceeds viewport`).toBeLessThanOrEqual(vw + 0.5)
      expect(overlaps(g.body, g.actions), `${at}: details overlap actions`).toBe(false)
      expect(overlaps(g.icon, g.actions), `${at}: icon overlaps actions`).toBe(false)
      expect(g.body.w, `${at}: details column crushed`).toBeGreaterThanOrEqual(narrow ? 150 : 180)
      for (const t of g.texts) {
        expect(inside(t, g.body), `${at}: text escapes details column`).toBe(true)
        for (const b of g.buttons) expect(overlaps(t, b), `${at}: text collides with ${b.label}`).toBe(false)
      }
      expect(g.buttons.map(b => b.label.replace(/[^A-Za-z]/g, ''))).toEqual(['View', 'Edit', 'Delete'])
      for (const b of g.buttons) {
        expect(inside(b, g.card), `${at}: ${b.label} outside card`).toBe(true)
        if (narrow) expect(b.h, `${at}: ${b.label} tap target < 44px`).toBeGreaterThanOrEqual(44)
      }
      for (let j = 1; j < g.buttons.length; j++) expect(overlaps(g.buttons[j - 1], g.buttons[j]), `${at}: buttons overlap`).toBe(false)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  })

  for (const inset of [0, 34]) {
    test(`every button is tappable, incl. last card above bottom nav (safe-area ${inset}px)`, async ({ page }) => {
      await open(page, inset)
      if (inset) {
        const applied = await page.evaluate(() => { const d = document.createElement('div'); d.style.paddingBottom = 'env(safe-area-inset-bottom)'; document.body.append(d); const v = getComputedStyle(d).paddingBottom; d.remove(); return parseFloat(v) })
        test.skip(applied !== inset, 'safe-area emulation not supported by this Chromium')
      }
      const buttons = page.getByTestId('doc-card-actions').getByRole('button')
      const n = await buttons.count()
      expect(n).toBe(18)
      for (let k = 0; k < n; k++) {
        const b = buttons.nth(k)
        // Centre it the way a user scrolls to a control (scrollIntoViewIfNeeded
        // stops at the viewport edge, i.e. under the fixed nav by design).
        await b.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }))
        const hit = await b.evaluate(el => {
          const r = el.getBoundingClientRect()
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return !!top && (top === el || el.contains(top)) ? true : `${top?.tagName}.${(top as HTMLElement)?.className} text=${(top?.textContent||'').slice(0,40)} y=${r.top|0} vh=${innerHeight}`
        })
        expect(hit, `button ${k} (${await b.innerText()}) covered by another element`).toBe(true)
      }
      // Scrolled fully down: the last card's actions sit above the fixed nav.
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior }))
      const nav = await page.locator('.bottom-nav').boundingBox()
      const last = await page.getByTestId('doc-card-actions').last().boundingBox()
      if (nav && (await page.locator('.bottom-nav').isVisible())) {
        expect(last!.y + last!.height, 'last card actions hidden under bottom nav').toBeLessThanOrEqual(nav.y + 0.5)
      }
    })
  }

  test('View / Edit / Delete behaviour unchanged', async ({ page }) => {
    await open(page)
    const card = page.getByTestId('doc-card').filter({ hasText: "Mum's pedigree" })
    const signed = page.waitForRequest(r => r.url().endsWith('/api/get-signed-url'))
    const popup = page.context().waitForEvent('page')
    await card.getByRole('button', { name: /View/ }).click()
    const req = await signed
    expect(req.headers()['authorization']).toBe('Bearer synthetic-token')
    expect(JSON.parse(req.postData() || '{}')).toEqual({ filePath: 'synthetic/d1.jpg' })
    await (await popup).close()

    await card.getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('#document-edit-name')).toHaveValue("Mum's pedigree")
    await page.getByRole('dialog', { name: 'Edit document' }).getByRole('button', { name: 'Cancel' }).click()

    page.once('dialog', d => d.dismiss())
    await card.getByRole('button', { name: /Delete/ }).click()
    await expect(card).toHaveCount(1)
    page.once('dialog', d => d.accept())
    await card.getByRole('button', { name: /Delete/ }).click()
    await expect(card).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__harness.deleted)).toEqual(['d1'])
  })

  test('desktop keeps the one-row card layout', async ({ page }, info) => {
    test.skip(info.project.name !== 'iphone-390', 'desktop check runs once')
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page)
    for (const g of await geometry(page)) {
      expect(g.actions.x, 'actions should sit to the right of details').toBeGreaterThanOrEqual(g.body.x + g.body.w)
      const mid = g.actions.y + g.actions.h / 2
      expect(mid).toBeGreaterThan(g.card.y)
      expect(mid).toBeLessThan(g.card.y + g.card.h)
      expect(g.icon.y + g.icon.h / 2).toBeCloseTo(g.card.y + g.card.h / 2, -1)
    }
  })
})
