import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { docCard } from '../support/documentRow'

// Regression: Delete must act on the document the test named, never on a different one.
// The old staging helper matched any div whose text CONTAINED the name and took `.last()`, so
// with documents named "QA doc 1" and "QA doc 1 renamed" it could press the other row's Delete.
// Renders the REAL DocumentsPage (Firebase stubbed, as in documents-mobile-layout.spec.ts) with
// look-alike titles and checks which document id the page actually deletes.

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ORIGIN = 'https://doc-delete.test'
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

async function open(page: Page) {
  await page.addInitScript(() => {
    const dogs = [{ id: 'dog-1', name: 'QA Dog' }]
    const mk = (id: string, title: string, extra: object = {}) => ({ id, dogId: 'dog-1', title, documentType: 'vet_record', fileType: 'pdf', filePath: `synthetic/${id}.pdf`, ...extra })
    const docs = [
      mk('d-base', 'QA doc 1'),
      mk('d-renamed', 'QA doc 1 renamed'),
      mk('d-other', 'Vet letter', { notes: 'mentions QA doc 1 in the notes' }),
      mk('d-dup-a', 'Twin'),
      mk('d-dup-b', 'Twin'),
    ]
    ;(window as any).__harness = { docs, dogs, deleted: [], updated: [], signed: [] }
  })
  await page.route(`${ORIGIN}/**`, async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/harness.js') return route.fulfill({ contentType: 'text/javascript', body: bundle })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"><main></main></div><script src="/harness.js"></script></body></html>' })
  })
  await page.goto(`${ORIGIN}/app/documents`)
  await expect(page.getByTestId('doc-card')).toHaveCount(5)
}
const deleted = (page: Page) => page.evaluate(() => (window as any).__harness.deleted)

test.describe('Documents Delete selects exactly the named document', () => {
  test('deleting "QA doc 1" removes only that document, not the look-alike "QA doc 1 renamed"', async ({ page }) => {
    await open(page)
    page.once('dialog', d => d.accept())
    await docCard(page, 'QA doc 1').getByRole('button', { name: /Delete/ }).click()
    await expect.poll(() => deleted(page)).toEqual(['d-base'])
    await expect(page.getByText('QA doc 1 renamed', { exact: true })).toBeVisible()
    await expect(page.getByTestId('doc-card')).toHaveCount(4)
  })

  test('deleting "QA doc 1 renamed" removes only that document', async ({ page }) => {
    await open(page)
    page.once('dialog', d => d.accept())
    await docCard(page, 'QA doc 1 renamed').getByRole('button', { name: /Delete/ }).click()
    await expect.poll(() => deleted(page)).toEqual(['d-renamed'])
    await expect(page.getByText('QA doc 1', { exact: true })).toBeVisible()
  })

  test('a name that only appears in another document\'s notes selects nothing', async ({ page }) => {
    await open(page)
    // "mentions QA doc 1 in the notes" is notes text, not a title.
    await expect(docCard(page, 'mentions QA doc 1 in the notes')).toHaveCount(0)
    await expect(docCard(page, 'QA doc')).toHaveCount(0) // prefix of two titles, exact title of none
  })

  test('ambiguous duplicate titles are refused (strict mode), never resolved by position', async ({ page }) => {
    await open(page)
    const twin = docCard(page, 'Twin')
    await expect(twin).toHaveCount(2)
    page.once('dialog', d => d.accept())
    await expect(twin.getByRole('button', { name: /Delete/ }).click({ timeout: 2_000 })).rejects.toThrow(/strict mode violation/)
    expect(await deleted(page)).toEqual([])
  })

  test('cancelling the confirmation deletes nothing', async ({ page }) => {
    await open(page)
    page.once('dialog', d => d.dismiss())
    await docCard(page, 'Vet letter').getByRole('button', { name: /Delete/ }).click()
    expect(await deleted(page)).toEqual([])
    await expect(page.getByTestId('doc-card')).toHaveCount(5)
  })

  test('the OLD helper picks the wrong row (proves the regression is real)', async ({ page }) => {
    await open(page)
    const oldRow = page.locator('div').filter({ hasText: 'QA doc 1' }).filter({ has: page.getByRole('button', { name: /Delete/ }) }).last()
    page.once('dialog', d => d.accept())
    await oldRow.getByRole('button', { name: /Delete/ }).click()
    await expect.poll(() => deleted(page)).not.toEqual(['d-base'])
  })
})
