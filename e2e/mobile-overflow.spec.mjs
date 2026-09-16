import { test, expect } from '@playwright/test'

const baseURL = process.env.BASE_URL
const email = process.env.IDOGS_QA_EMAIL
const password = process.env.IDOGS_QA_PASSWORD
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

if (!baseURL || !email || !password) {
  throw new Error('BASE_URL, IDOGS_QA_EMAIL and IDOGS_QA_PASSWORD are required')
}

const viewports = [
  { width: 320, height: 780 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 414, height: 896 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
]

test.use({
  baseURL,
  extraHTTPHeaders: bypass
    ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' }
    : {},
})

function collectRuntimeFailures(page) {
  const failures = []
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })
  page.on('requestfailed', request => {
    if (['document', 'script', 'xhr', 'fetch'].includes(request.resourceType())) {
      failures.push(`network: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`)
    }
  })
  return failures
}

async function login(page, next) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => url.pathname === next, { timeout: 30_000 })
  await page.waitForLoadState('networkidle')
}

async function expectNoHorizontalOverflow(page, selector) {
  const metrics = await page.evaluate(target => {
    const root = document.documentElement
    const nodes = [...document.querySelectorAll(target)]
    return {
      viewport: window.innerWidth,
      documentWidth: root.scrollWidth,
      nodes: nodes.map(node => {
        const rect = node.getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: rect.width }
      }),
    }
  }, selector)

  expect(metrics.documentWidth, `document overflow at ${metrics.viewport}px`).toBeLessThanOrEqual(metrics.viewport + 1)
  expect(metrics.nodes.length, `${selector} must exist for meaningful QA`).toBeGreaterThan(0)
  for (const rect of metrics.nodes) {
    expect(rect.left, `${selector} left edge`).toBeGreaterThanOrEqual(-1)
    expect(rect.right, `${selector} right edge`).toBeLessThanOrEqual(metrics.viewport + 1)
    expect(rect.width, `${selector} width`).toBeLessThanOrEqual(metrics.viewport + 1)
  }
}

for (const viewport of viewports) {
  test(`Dogs and Litters contain content at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const failures = collectRuntimeFailures(page)

    await login(page, '/app/dogs')
    await page.locator('.dog-list-card').first().waitFor({ state: 'visible', timeout: 20_000 })
    await expectNoHorizontalOverflow(page, '.dog-list-card, .dog-card-meta-row, .dog-card-badges')

    await page.goto('/app/litters', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')
    const showcaseCard = page.locator('.showcase-puppy-card').first()
    if (!(await showcaseCard.isVisible().catch(() => false))) {
      const possibleExpanders = page.getByRole('button', { name: /view|manage|details|open/i })
      const count = await possibleExpanders.count()
      for (let index = 0; index < count && !(await showcaseCard.isVisible().catch(() => false)); index += 1) {
        await possibleExpanders.nth(index).click().catch(() => {})
      }
    }
    await showcaseCard.waitFor({ state: 'visible', timeout: 20_000 })
    await expectNoHorizontalOverflow(page, '.showcase-puppy-card, .showcase-puppy-summary, .showcase-puppy-fields, .showcase-puppy-availability')

    expect(failures, `runtime failures at ${viewport.width}px`).toEqual([])
  })
}
