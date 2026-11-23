import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { teardownDocs } from '../support/docTeardown'

// Synthetic regression for the QA document teardown (no credentials, real DocumentsPage).
// Proves: exact titles only, confirmed absence is distinct from a failed lookup, ambiguity and
// delete failures are errors, and a failed list load is never read as "nothing to delete".

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ORIGIN = 'https://doc-teardown.test'
const STUB = `${ROOT}e2e/local/harness/stubs.ts`

let bundle = ''
test.beforeAll(async () => {
  const out = await build({
    entryPoints: [`${ROOT}e2e/local/harness/documents-page.harness.tsx`],
    bundle: true, write: false, format: 'iife', jsx: 'automatic', target: 'es2020',
    define: { 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'stub-firebase-modules', setup(b) { b.onResolve({ filter: /(\/lib\/db|\/hooks\/useAuth|\/lib\/firebase)$/ }, () => ({ path: STUB })) } }],
    logLevel: 'silent',
  })
  bundle = out.outputFiles[0].text
})

async function open(page: Page, flags: { failLoad?: boolean; failDelete?: boolean } = {}, cards = 5) {
  await page.addInitScript((f) => {
    const mk = (id: string, title: string, extra: object = {}) => ({ id, dogId: 'dog-1', title, documentType: 'vet_record', fileType: 'pdf', filePath: `synthetic/${id}.pdf`, ...extra })
    const docs = [mk('d-base', 'QA doc 1'), mk('d-renamed', 'QA doc 1 renamed'), mk('d-other', 'Vet letter', { notes: 'mentions QA doc 1' }), mk('d-dup-a', 'Twin'), mk('d-dup-b', 'Twin')]
    ;(window as any).__harness = { docs, dogs: [{ id: 'dog-1', name: 'QA Dog' }], deleted: [], updated: [], signed: [], ...f }
  }, flags)
  await page.route(`${ORIGIN}/**`, async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/harness.js') return route.fulfill({ contentType: 'text/javascript', body: bundle })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"><main></main></div><script src="/harness.js"></script></body></html>' })
  })
  await page.goto(`${ORIGIN}/app/documents`)
  if (cards) await expect(page.getByTestId('doc-card')).toHaveCount(cards)
}
// teardownDocs navigates with a relative URL; baseURL comes from the page's current origin.
test.use({ baseURL: ORIGIN })
const deleted = (page: Page) => page.evaluate(() => (window as any).__harness.deleted)

test.describe('QA document teardown (synthetic)', () => {
  test('deletes only the exact titles; look-alikes are untouched', async ({ page }) => {
    await open(page)
    const r = await teardownDocs(page, ['QA doc 1 renamed', 'QA doc 1'])
    expect(r).toEqual({ deleted: ['QA doc 1 renamed', 'QA doc 1'], absent: [] })
    expect(await deleted(page)).toEqual(['d-renamed', 'd-base'])
    await expect(page.getByTestId('doc-card')).toHaveCount(3)
  })

  test('a title that is not present is CONFIRMED absent (not an error), nothing else deleted', async ({ page }) => {
    await open(page)
    const r = await teardownDocs(page, ['QA doc 1 renamed gone', 'QA doc'])
    expect(r).toEqual({ deleted: [], absent: ['QA doc 1 renamed gone', 'QA doc'] })
    expect(await deleted(page)).toEqual([])
  })

  test('ambiguous duplicate titles fail the teardown and delete nothing', async ({ page }) => {
    await open(page)
    await expect(teardownDocs(page, ['Twin'])).rejects.toThrow(/teardown refused: 2 documents/)
    expect(await deleted(page)).toEqual([])
  })

  test('a failed list load is a lookup error, never "confirmed absent"', async ({ page }) => {
    await open(page, { failLoad: true }, 0)
    await expect(teardownDocs(page, ['QA doc 1'])).rejects.toThrow()
    expect(await deleted(page)).toEqual([])
  })

  test('a delete that does not take effect fails the teardown', async ({ page }) => {
    await open(page, { failDelete: true })
    await expect(teardownDocs(page, ['Vet letter'], { deleteTimeoutMs: 2_000 })).rejects.toThrow()
    expect(await deleted(page)).toEqual([])
    await expect(page.getByTestId('doc-card')).toHaveCount(5)
  })
})
