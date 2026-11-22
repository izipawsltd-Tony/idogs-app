import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { QA_A, QA_B, createFixtureDogViaForm, type QaAccount } from '../support/qaFixtures'

// Proves, without any backend, that the staging QA-SYNTH fixture provisioning drives the REAL
// Add Dog form correctly: the exact helper CI runs (createFixtureDogViaForm) against the real
// DogNewPage + app CSS, Firebase modules stubbed. Checks the payload reaching createDog() and
// that nothing else is written.

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ORIGIN = 'https://dog-new-harness.test'
const STUB = `${ROOT}e2e/local/harness/dog-new-stubs.ts`

let bundle = ''
test.beforeAll(async () => {
  const out = await build({
    entryPoints: [`${ROOT}e2e/local/harness/dog-new-page.harness.tsx`],
    bundle: true, write: false, format: 'iife', jsx: 'automatic', target: 'es2020',
    define: { 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'stub-firebase-modules', setup(b) { b.onResolve({ filter: /(\/lib\/db|\/hooks\/useAuth|\/lib\/firebase)$/ }, () => ({ path: STUB })) } }],
    logLevel: 'silent',
  })
  bundle = out.outputFiles[0].text
})

const html = () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${readFileSync(`${ROOT}src/index.css`, 'utf8')}</style></head><body><main></main><script src="/harness.js"></script></body></html>`

for (const [who, role] of [[QA_A, 'owner'], [QA_B, 'breeder']] as Array<[QaAccount, string]>) {
  test(`fixture form for account ${who.name} (${role}) creates exactly the synthetic dog`, async ({ page }) => {
    await page.addInitScript(r => { (window as any).__harness = { dogs: [], created: [], extraWrites: [], toasts: [], profile: { role: r, plan: 'free', state: 'SA' } } }, role)
    await page.route(`${ORIGIN}/**`, route => new URL(route.request().url()).pathname === '/harness.js'
      ? route.fulfill({ contentType: 'text/javascript', body: bundle })
      : route.fulfill({ contentType: 'text/html', body: html() }))
    await page.goto(`${ORIGIN}/`)
    page.goto = ((url: string) => page.evaluate(u => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')) }, url).then(() => null)) as any
    await createFixtureDogViaForm(page, who)
    const h = await page.evaluate(() => (window as any).__harness)
    expect(h.created).toHaveLength(1)
    expect(h.created[0]).toMatchObject({ name: who.fixture.dogName, microchip: who.fixture.microchip, notes: who.fixture.notes, dateOfBirth: '2024-01-15', pedigreeRegister: who.fixture.pedigree })
    expect(String(h.created[0].breed).length > 0, 'breed selected').toBe(true)
    expect(h.extraWrites, 'no vaccine/health/document writes').toEqual([])
    expect(new URL(page.url()).pathname).toBe('/app/dogs/harness-dog-1')
  })
}
